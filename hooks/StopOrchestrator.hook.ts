#!/usr/bin/env bun
/**
 * StopOrchestrator.hook.ts - Single Entry Point for Stop Hooks
 *
 * PURPOSE:
 * Orchestrates all Stop event handlers by reading and parsing the transcript
 * ONCE, then distributing the parsed data to isolated handlers.
 *
 * TRIGGER: Stop (fires after Claude generates a response)
 *
 * HANDLERS (in hooks/handlers/):
 * - TabState.ts: Resets Kitty tab to default UL blue
 * - RebuildSkill.ts: Auto-rebuilds SKILL.md from Components/ if modified
 * - DocCrossRefIntegrity.ts: Checks if system docs/hooks were modified, updates cross-refs if so
 *
 * ERROR HANDLING:
 * - Handler failures: Isolated via Promise.allSettled
 *
 * PERFORMANCE:
 * - Non-blocking, typical execution: <100ms
 */

import { extractCompletionPlain, extractStructuredSections } from './lib/transcript-parser';
import type { ParsedTranscript } from './lib/transcript-parser';
import { getCachedTranscript } from './lib/transcript-cache';
import { handleTabState } from './handlers/TabState';
import { handleRebuildSkill } from './handlers/RebuildSkill';
import { handleAlgorithmEnrichment } from './handlers/AlgorithmEnrichment';
import { handleDocCrossRefIntegrity } from './handlers/DocCrossRefIntegrity';
import { handlePlanDetection } from './handlers/PlanDetection';

interface HookInput {
  session_id: string;
  transcript_path: string;
  hook_event_name: string;
  /** Available in claude-code v2.1.47+. Eliminates transcript file I/O when present. */
  last_assistant_message?: string;
}


/**
 * Graceful-shutdown deadline for the handler fan-out. DocCrossRefIntegrity runs an inference()
 * call with a 15s internal timeout; this orchestrator-level deadline (20s, 5s margin) is the
 * BACKSTOP for the case where a handler's own timeout fails to fire (network/subprocess/SDK stall).
 * Without it, Promise.allSettled never resolves and the Stop hook hangs the session forever.
 */
export const HANDLER_DEADLINE_MS = 20000;

/**
 * Run handlers with an overall deadline. On the happy path this behaves exactly like
 * Promise.allSettled (all handlers awaited). If the deadline fires first, it returns the names of
 * the handlers that had NOT yet completed so the caller can log them, then exit gracefully.
 * Pure + exported for testing — the regression guard for the "Stop hook hangs forever" bug.
 */
export async function runHandlersWithDeadline(
  handlers: Promise<void>[],
  names: string[],
  deadlineMs: number = HANDLER_DEADLINE_MS,
): Promise<{ timedOut: boolean; unfinished: string[]; rejected: string[] }> {
  const done = new Array(handlers.length).fill(false);
  const rejected: string[] = [];

  // Wrap each handler so we know which ones finished (and which rejected) even if the deadline wins.
  const tracked = handlers.map((h, i) =>
    h.then(
      () => { done[i] = true; },
      (reason) => { done[i] = true; rejected.push(names[i]); console.error(`[StopOrchestrator] ${names[i]} handler failed:`, reason); },
    ),
  );

  const TIMEOUT = Symbol('timeout');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), deadlineMs);
  });

  const result = await Promise.race([Promise.all(tracked).then(() => 'ALL_DONE' as const), deadline]);
  if (timer) clearTimeout(timer);

  if (result === TIMEOUT) {
    const unfinished = names.filter((_, i) => !done[i]);
    return { timedOut: true, unfinished, rejected };
  }
  return { timedOut: false, unfinished: [], rejected };
}

async function readStdin(): Promise<HookInput | null> {
  try {
    const decoder = new TextDecoder();
    const reader = Bun.stdin.stream().getReader();
    let input = '';

    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 500);
    });

    const readPromise = (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        input += decoder.decode(value, { stream: true });
      }
    })();

    await Promise.race([readPromise, timeoutPromise]);

    if (input.trim()) {
      return JSON.parse(input) as HookInput;
    }
  } catch (error) {
    console.error('[StopOrchestrator] Error reading stdin:', error);
  }
  return null;
}

async function main() {
  const hookInput = await readStdin();

  if (!hookInput || !hookInput.transcript_path) {
    console.error('[StopOrchestrator] No transcript path provided');
    process.exit(0);
  }

  // FAST PATH: use last_assistant_message directly (claude-code v2.1.47+)
  // Skips transcript file I/O and full JSONL parse — eliminates the main bottleneck.
  // SLOW PATH: fall back to parseTranscript() when field is absent (older claude-code).
  let parsed: ParsedTranscript;
  if (hookInput.last_assistant_message) {
    const text = hookInput.last_assistant_message;
    parsed = {
      raw: '',
      lastMessage: text,
      currentResponseText: text,
      userPrompt: '', // fast path has no transcript → no user prompt available
      completionSummary: '', // Deprecated — kept for ParsedTranscript type compatibility
      plainCompletion: extractCompletionPlain(text),
      structured: extractStructuredSections(text),
      responseState: 'completed', // AskUserQuestion state handled by SetQuestionTab PreToolUse hook
    };
    console.error(`[StopOrchestrator] Fast path (last_assistant_message): ${text.slice(0, 50)}...`);
  } else {
    // Wait for transcript to be fully written to disk
    await new Promise(resolve => setTimeout(resolve, 150));
    // SINGLE READ, SINGLE PARSE
    parsed = getCachedTranscript(hookInput.transcript_path);
    console.error(`[StopOrchestrator] Slow path (transcript parse): ${parsed.plainCompletion.slice(0, 50)}...`);
  }

  // Run handlers
  const handlers: Promise<void>[] = [
    handleTabState(parsed, hookInput.session_id),
    handleRebuildSkill(),
    handleAlgorithmEnrichment(parsed, hookInput.session_id),
    handleDocCrossRefIntegrity(parsed, hookInput),
    handlePlanDetection(parsed, hookInput.session_id),
  ];
  const handlerNames = ['TabState', 'RebuildSkill', 'AlgorithmEnrichment', 'DocCrossRefIntegrity', 'PlanDetection'];

  // Graceful shutdown: race the fan-out against an overall deadline so a hung handler can never
  // wedge the Stop hook indefinitely. Per-handler failures are still isolated + logged.
  const { timedOut, unfinished } = await runHandlersWithDeadline(handlers, handlerNames);
  if (timedOut) {
    console.error(`[StopOrchestrator] Deadline (${HANDLER_DEADLINE_MS}ms) hit — exiting gracefully; unfinished: ${unfinished.join(', ') || 'none'}`);
  }

  process.exit(0);
}

// Only run as the standalone hook — not when imported by tests for the exported helpers.
if (import.meta.main) {
  main().catch((error) => {
    console.error('[StopOrchestrator] Fatal error:', error);
    process.exit(0);
  });
}
