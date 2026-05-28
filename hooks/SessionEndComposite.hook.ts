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

const TRIVIAL_MESSAGE_THRESHOLD = 6;
const TRIVIAL_TOKEN_THRESHOLD = 2000;
const HOOKS_DIR = paiPath('hooks');

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

    const hookPath = join(HOOKS_DIR, `${hookName}.hook.ts`);
    const hookProcess = spawn('bun', [hookPath], {
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
  try {
    // Read hook input with timeout
    const input = await readHookInput();

    if (!input || !input.session_id) {
      console.error('[SessionEndComposite] No valid input, exiting');
      process.exit(0);
    }

    const { session_id, transcript_path } = input;
    console.error(`[SessionEndComposite] Starting for session ${session_id}`);

    // Analyze transcript to determine if we should gate inference hooks
    const metrics = analyzeTranscript(transcript_path || '');
    const trivial = isTrivialSession(metrics);

    if (trivial) {
      console.error(
        `[SessionEndComposite] Trivial session detected (msgs=${metrics.messageCount}, tokens~${metrics.estimatedTokens}) - skipping inference hooks`
      );
    } else {
      console.error(
        `[SessionEndComposite] Substantial session (msgs=${metrics.messageCount}, tokens~${metrics.estimatedTokens}${metrics.hasFeedback ? ', has /feedback' : ''}) - running all hooks`
      );
    }

    // Build array of hooks to run
    const hooksToRun: string[] = [];

    // Always run these (simple, fast hooks)
    hooksToRun.push(
      'SessionCleanup',
      'UpdateCounts',
      'MemoryTimeline',
      'IntegrityCheck'
    );

    // Conditionally run inference hooks
    if (!trivial) {
      hooksToRun.push(
        'InsightExtractor',
        'KnowledgeSync',
        'WorkCompletionLearning',
        'SessionSummary',
        'RelationshipMemory'
      );
    }

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

    // Clean up sentinel files for this session
    cleanupSession(session_id);

    process.exit(0);
  } catch (error) {
    console.error(`[SessionEndComposite] Fatal error: ${error}`);
    process.exit(0); // Non-blocking even on fatal error
  }
}

if (import.meta.main) {
  main();
}

// Export for testing
export { analyzeTranscript, isTrivialSession, runHook, main };
