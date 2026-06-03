#!/usr/bin/env bun
/**
 * WorktreeSetup.hook.ts - PAI Worktree Creation Logger
 *
 * Claude Code fires WorktreeCreate when an agent uses `isolation: worktree`.
 *
 * CRITICAL: This hook must NOT write to stdout. Claude Code interprets any
 * stdout from WorktreeCreate hooks as the worktree directory path. Outputting
 * anything (even "{}") causes "path is not a directory" errors.
 *
 * This hook only logs the event to stderr (captured by run-hook.sh).
 * Context injection is deferred — the worktree path is not available in the
 * hook input as of Claude Code v2.x.
 */

import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const PAI_DIR = process.env.PAI_DIR || join(homedir(), '.claude');

async function readStdin(): Promise<Record<string, any> | null> {
  try {
    const decoder = new TextDecoder();
    const reader = Bun.stdin.stream().getReader();
    let input = '';

    const timeoutPromise = new Promise<void>(resolve => setTimeout(resolve, 500));
    const readPromise = (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        input += decoder.decode(value, { stream: true });
      }
    })();

    await Promise.race([readPromise, timeoutPromise]);
    if (input.trim()) return JSON.parse(input);
  } catch {
    // Ignore parse errors
  }
  return null;
}

async function main() {
  const input = await readStdin();

  if (!input) {
    console.error(`[WorktreeSetup] No stdin input received`);
    process.exit(0);
  }

  const sessionId = (input.session_id || input.sessionId || 'unknown').slice(0, 8);
  const agentName = input.name || 'unnamed';
  const cwd = input.cwd || '';

  console.error(`[WorktreeSetup] WorktreeCreate for ${agentName} (session: ${sessionId}..., cwd: ${cwd})`);

  // Log to worktree-log.jsonl for audit trail
  try {
    const stateDir = join(PAI_DIR, 'MEMORY', 'STATE');
    if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });

    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      session_id: input.session_id || input.sessionId,
      agent_name: agentName,
      cwd,
      event: 'WorktreeCreate',
    }) + '\n';

    appendFileSync(join(stateDir, 'worktree-log.jsonl'), entry);
  } catch {
    // Silent fail — logging shouldn't block agent work
  }

  // NO stdout output — this is critical
  process.exit(0);
}

main().catch(err => {
  console.error('[WorktreeSetup] Fatal error:', err);
  process.exit(0);
});
