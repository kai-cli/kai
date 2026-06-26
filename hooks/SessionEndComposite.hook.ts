#!/usr/bin/env bun
/**
 * SessionEndComposite.hook.ts - Consolidated SessionEnd Hook Orchestrator
 *
 * PURPOSE:
 * Replaces 9 individual SessionEnd hooks with one composite that applies
 * a heuristic gate to skip expensive inference hooks on trivial sessions.
 *
 * TRIGGER: SessionEnd
 *
 * INPUT: stdin hook JSON (session_id, transcript_path)
 *
 * HEURISTIC GATE:
 * - Trivial session: messages < 6 AND totalTokens < 2000
 * - Bypass gate if transcript contains "/feedback"
 * - Always run: SessionCleanup, UpdateCounts, MemoryTimeline, IntegrityCheck
 * - Conditionally run: InsightExtractor, KnowledgeSync, WorkCompletionLearning, SessionSummary, RelationshipMemory
 *
 * ARCHITECTURE:
 * - Spawns sub-hooks as separate processes
 * - Runs all in parallel with Promise.allSettled()
 * - Each sub-handler wrapped with sentinel tracking (markStarted/markComplete)
 * - One failed sub-handler doesn't block others
 * - Non-blocking: exits(0) always
 */

import { existsSync, readFileSync } from 'fs';
import { spawn } from 'child_process';
import { join } from 'path';
import { markStarted, markComplete, cleanupSession } from './lib/session-end-tracker';
import { readHookInput, type HookInput } from './lib/hook-io';
import { paiPath } from './lib/paths';
import { emitMemoryTelemetry } from './lib/memory-telemetry';

const TRIVIAL_MESSAGE_THRESHOLD = 6;
const TRIVIAL_TOKEN_THRESHOLD = 2000;
const RUN_HOOK_SH = paiPath('hooks', 'lib', 'run-hook.sh');

/**
 * W4: read the composite feature flag from config/settings.json (PAI flags file,
 * same one W2/W3 use — NOT the generated root settings.json).
 * sessionEnd.useComposite default true. When false, the trivial-session gate is
 * disabled so ALL hooks run unconditionally (== pre-W4 behavior).
 */
function isCompositeGateEnabled(): boolean {
  try {
    const path = paiPath('config', 'settings.json');
    if (!existsSync(path)) return true;
    const cfg = JSON.parse(readFileSync(path, 'utf-8'));
    return cfg?.sessionEnd?.useComposite !== false;
  } catch {
    return true;
  }
}

interface SessionMetrics {
  messageCount: number;
  estimatedTokens: number;
  hasFeedback: boolean;
}

/**
 * Extract session metrics from transcript for gate decision
 */
function analyzeTranscript(transcriptPath: string): SessionMetrics {
  const metrics: SessionMetrics = {
    messageCount: 0,
    estimatedTokens: 0,
    hasFeedback: false,
  };

  if (!existsSync(transcriptPath)) {
    return metrics;
  }

  try {
    const content = readFileSync(transcriptPath, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.trim());

    metrics.messageCount = lines.length;

    // Rough token estimate: ~4 chars per token
    metrics.estimatedTokens = Math.floor(content.length / 4);

    // Check for /feedback command
    metrics.hasFeedback = content.includes('/feedback');
  } catch (error) {
    console.error(`[SessionEndComposite] Failed to analyze transcript: ${error}`);
  }

  return metrics;
}

/**
 * Determine if this is a trivial session that should skip inference hooks
 */
function isTrivialSession(metrics: SessionMetrics): boolean {
  // /feedback always bypasses the gate
  if (metrics.hasFeedback) {
    return false;
  }

  return metrics.messageCount < TRIVIAL_MESSAGE_THRESHOLD &&
         metrics.estimatedTokens < TRIVIAL_TOKEN_THRESHOLD;
}

function emitCompositeTelemetry(fields: Record<string, unknown>): void {
  emitMemoryTelemetry('session_end.composite', {
    hook: 'SessionEndComposite',
    ...fields,
  });
}

/** Always-run SessionEnd hooks (fast, no LLM inference). MemCapture included (W4). */
export const ALWAYS_RUN_HOOKS = [
  'SessionCleanup',
  'UpdateCounts',
  'MemoryTimeline',
  'MemCapture',
  'IntegrityCheck',
] as const;

/** Inference hooks — skipped on trivial sessions (LLM cost). */
export const INFERENCE_HOOKS = [
  'InsightExtractor',
  'KnowledgeSync',
  'WorkCompletionLearning',
  'SessionSummary',
  'RelationshipMemory',
] as const;

/**
 * Pure hook-set selection (no I/O) — exported for deterministic unit testing.
 * trivial sessions run only the always-run set; substantial/feedback run all.
 */
export function selectSessionEndHooks(trivial: boolean): string[] {
  return trivial ? [...ALWAYS_RUN_HOOKS] : [...ALWAYS_RUN_HOOKS, ...INFERENCE_HOOKS];
}

/**
 * Run a hook as a subprocess with sentinel tracking
 */
function runHook(
  hookName: string,
  sessionId: string,
  input: HookInput
): Promise<{ hookName: string; success: boolean; error?: string }> {
  return new Promise((resolve) => {
    markStarted(hookName, sessionId);

    // W4: spawn through run-hook.sh (by hook NAME) to preserve per-hook timeout
    // enforcement (KnowledgeSync 180s, etc.) — bare `bun` lost that protection.
    const hookProcess = spawn(RUN_HOOK_SH, [`${hookName}.hook.ts`], {
      stdio: ['pipe', 'inherit', 'inherit'],
      env: { ...process.env },
    });

    // Pass input to hook via stdin
    hookProcess.stdin.write(JSON.stringify(input));
    hookProcess.stdin.end();

    hookProcess.on('exit', (code) => {
      if (code === 0) {
        markComplete(hookName, sessionId);
        resolve({ hookName, success: true });
      } else {
        resolve({ hookName, success: false, error: `Exit code ${code}` });
      }
    });

    hookProcess.on('error', (error) => {
      resolve({ hookName, success: false, error: error.message });
    });
  });
}

/**
 * Main composite handler
 */
async function main() {
  const startedAt = Date.now();
  let sessionId = 'unknown';
  try {
    // Read hook input with timeout
    const input = await readHookInput();

    if (!input || !input.session_id) {
      console.error('[SessionEndComposite] No valid input, exiting');
      emitCompositeTelemetry({
        phase: 'complete',
        status: 'skipped',
        reason: 'invalid_input',
        ms: Date.now() - startedAt,
      });
      process.exit(0);
    }

    const { session_id, transcript_path } = input;
    sessionId = session_id;
    console.error(`[SessionEndComposite] Starting for session ${session_id}`);

    // Analyze transcript to determine if we should gate inference hooks.
    // W4: the trivial-session gate is itself flag-gated. With the flag OFF, trivial
    // is forced false → every hook runs unconditionally (matches pre-W4 behavior).
    const metrics = analyzeTranscript(transcript_path || '');
    const gateEnabled = isCompositeGateEnabled();
    const trivial = gateEnabled ? isTrivialSession(metrics) : false;
    if (!gateEnabled) {
      console.error('[SessionEndComposite] Trivial-gate disabled (sessionEnd.useComposite=false) — running all hooks');
    }

    if (trivial) {
      console.error(
        `[SessionEndComposite] Trivial session detected (msgs=${metrics.messageCount}, tokens~${metrics.estimatedTokens}) - skipping inference hooks`
      );
    } else {
      console.error(
        `[SessionEndComposite] Substantial session (msgs=${metrics.messageCount}, tokens~${metrics.estimatedTokens}${metrics.hasFeedback ? ', has /feedback' : ''}) - running all hooks`
      );
    }

    // Regenerate cross-project memory index (fast, no LLM, no stdin needed)
    const indexScript = join(paiPath('PAI', 'Tools'), 'CrossProjectIndex.ts');
    if (existsSync(indexScript)) {
      const cp = spawn('bun', [indexScript], { stdio: 'ignore', detached: true });
      cp.unref();
      console.error('[SessionEndComposite] CrossProjectIndex regeneration spawned');
    }

    // Build array of hooks to run (pure selection — see selectSessionEndHooks).
    // W4: MemCapture is in ALWAYS_RUN_HOOKS (Memcarry resume-state, F1-gated/mechanical) —
    // it was missing from the composite but present in the live wiring; omitting it would
    // silently stop Memcarry.
    const hooksToRun = selectSessionEndHooks(trivial);
    const skippedHooks = trivial ? [...INFERENCE_HOOKS] : [];

    emitCompositeTelemetry({
      phase: 'decision',
      session_id,
      status: 'selected',
      gate_enabled: gateEnabled,
      trivial,
      message_count: metrics.messageCount,
      estimated_tokens: metrics.estimatedTokens,
      has_feedback: metrics.hasFeedback,
      selected_hooks: hooksToRun,
      skipped_hooks: skippedHooks,
      selected_count: hooksToRun.length,
      skipped_count: skippedHooks.length,
    });

    console.error(`[SessionEndComposite] Running ${hooksToRun.length} hooks in parallel`);

    // Run all hooks in parallel with Promise.allSettled
    const results = await Promise.allSettled(
      hooksToRun.map((name) => runHook(name, session_id, input))
    );

    // Report results
    let succeeded = 0;
    let failed = 0;

    for (const result of results) {
      if (result.status === 'fulfilled') {
        if (result.value.success) {
          succeeded++;
        } else {
          failed++;
          console.error(`[SessionEndComposite] ❌ ${result.value.hookName}: ${result.value.error}`);
        }
      } else {
        failed++;
        console.error(`[SessionEndComposite] ❌ Hook crashed: ${result.reason}`);
      }
    }

    console.error(`[SessionEndComposite] Complete: ${succeeded} succeeded, ${failed} failed`);

    emitCompositeTelemetry({
      phase: 'complete',
      session_id,
      status: failed > 0 ? 'partial' : 'complete',
      gate_enabled: gateEnabled,
      trivial,
      message_count: metrics.messageCount,
      estimated_tokens: metrics.estimatedTokens,
      has_feedback: metrics.hasFeedback,
      selected_count: hooksToRun.length,
      skipped_count: skippedHooks.length,
      succeeded,
      failed,
      ms: Date.now() - startedAt,
    });

    // Clean up sentinel files for this session
    cleanupSession(session_id);

    process.exit(0);
  } catch (error) {
    console.error(`[SessionEndComposite] Fatal error: ${error}`);
    emitCompositeTelemetry({
      phase: 'complete',
      session_id: sessionId,
      status: 'error',
      error_class: error instanceof Error ? error.name : typeof error,
      ms: Date.now() - startedAt,
    });
    process.exit(0); // Non-blocking even on fatal error
  }
}

if (import.meta.main) {
  main().catch(() => process.exit(1));
}

// Export for testing
export { analyzeTranscript, isTrivialSession, runHook, main };
