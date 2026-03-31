#!/usr/bin/env bun
/**
 * WorktreeRemove.hook.ts - PAI Context Cleanup on Worktree Removal
 *
 * PURPOSE:
 * Fires when Claude Code removes a sandboxed agent worktree.
 * Cleans up the .claude/ context that WorktreeSetup.hook.ts injected,
 * and logs the removal event.
 *
 * TRIGGER: WorktreeRemove (claude-code v2.1.50+)
 *
 * INPUT (from Claude Code stdin):
 *   { session_id, worktree_path, hook_event_name }
 *
 * ACTIONS:
 *   1. Log worktree removal to MEMORY/STATE/worktree-log.jsonl
 *   2. Remove .claude/CLAUDE.md and .claude/current-work.json if present
 *      (only files injected by WorktreeSetup — not user's own .claude/ files)
 */

import { existsSync, rmSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

interface WorktreeRemoveInput {
  session_id: string;
  worktree_path?: string;
  hook_event_name: string;
}

const PAI_DIR = process.env.PAI_DIR || join(homedir(), '.claude');

// Files injected by WorktreeSetup — safe to remove
const INJECTED_FILES = ['CLAUDE.md', 'current-work.json'];

function logWorktreeRemoval(sessionId: string, worktreePath: string): void {
  try {
    const logPath = join(PAI_DIR, 'MEMORY', 'STATE', 'worktree-log.jsonl');
    const stateDir = join(PAI_DIR, 'MEMORY', 'STATE');
    if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });

    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      worktree_path: worktreePath,
      event: 'WorktreeRemove',
    }) + '\n';

    appendFileSync(logPath, entry);
  } catch {
    // Silent fail — logging shouldn't block
  }
}

function cleanupContext(worktreePath: string): void {
  const claudeDir = join(worktreePath, '.claude');
  if (!existsSync(claudeDir)) return;

  for (const filename of INJECTED_FILES) {
    const filePath = join(claudeDir, filename);
    if (existsSync(filePath)) {
      try {
        rmSync(filePath);
        console.error(`[WorktreeRemove] Removed ${filename} from ${worktreePath}`);
      } catch {
        // Silent fail
      }
    }
  }
}

async function readStdin(): Promise<WorktreeRemoveInput | null> {
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
    if (input.trim()) return JSON.parse(input) as WorktreeRemoveInput;
  } catch {
    // Ignore parse errors
  }
  return null;
}

async function main() {
  const input = await readStdin();

  if (!input) {
    process.exit(0);
  }

  const worktreePath = input.worktree_path || '';
  const sessionId = input.session_id || 'unknown';

  console.error(`[WorktreeRemove] WorktreeRemove: ${worktreePath || '(no path)'} (session: ${sessionId.slice(0, 8)}...)`);

  if (worktreePath) logWorktreeRemoval(sessionId, worktreePath);

  if (worktreePath && existsSync(worktreePath)) {
    cleanupContext(worktreePath);
    console.error(`[WorktreeRemove] Cleanup complete`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('[WorktreeRemove] Fatal error:', err);
  process.exit(0);
});
