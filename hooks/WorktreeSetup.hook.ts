#!/usr/bin/env bun
/**
 * WorktreeSetup.hook.ts - PAI Context Injection on Worktree Creation
 *
 * PURPOSE:
 * When an agent runs with `isolation: worktree`, Claude Code creates a sandboxed
 * git worktree and fires WorktreeCreate. This hook injects minimal PAI context
 * into the worktree so the agent knows:
 *   1. It's operating in a PAI-managed worktree
 *   2. What active work exists (current-work.json, if any)
 *   3. Where to find PAI documentation
 *
 * TRIGGER: WorktreeCreate (claude-code v2.1.50+)
 *
 * INPUT (from Claude Code stdin):
 *   { session_id, worktree_path, hook_event_name }
 *
 * ACTIONS:
 *   1. Create .claude/ dir in worktree (if missing)
 *   2. Write .claude/CLAUDE.md with PAI context pointer
 *   3. Copy current-work.json into .claude/ (active task context)
 *   4. Log worktree creation to MEMORY/STATE/worktree-log.jsonl
 *
 * NOTE: Agents in worktrees still have full access to ~/.claude/ (hooks, settings,
 * skills) via PAI_DIR env var. This hook adds task-specific context to the worktree
 * working directory itself.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

interface WorktreeCreateInput {
  session_id: string;
  worktree_path?: string;
  hook_event_name: string;
}

const PAI_DIR = process.env.PAI_DIR || join(homedir(), '.claude');

const PAI_CLAUDE_MD = `# PAI Worktree Context

This is a sandboxed worktree created by the PAI agent isolation system.

## PAI System Access
- Skills and hooks: \`${PAI_DIR}/skills/PAI/\`
- User context: \`${PAI_DIR}/skills/PAI/USER/\`
- System docs: \`${PAI_DIR}/skills/PAI/SYSTEM/\`

## Working in This Worktree
- You have isolated access to the project files in this directory
- Changes here don't affect the main branch until merged
- Use git to inspect what branch you're on and what has changed

## Active Work Context
See \`.claude/current-work.json\` if present for the active task context.
`;

function logWorktreeCreation(sessionId: string, worktreePath: string): void {
  try {
    const logPath = join(PAI_DIR, 'MEMORY', 'STATE', 'worktree-log.jsonl');
    const stateDir = join(PAI_DIR, 'MEMORY', 'STATE');
    if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });

    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      worktree_path: worktreePath,
      event: 'WorktreeCreate',
    }) + '\n';

    appendFileSync(logPath, entry);
  } catch {
    // Silent fail — logging shouldn't block
  }
}

function injectContext(worktreePath: string): void {
  const claudeDir = join(worktreePath, '.claude');

  // Ensure .claude/ dir exists
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true });
  }

  // Write CLAUDE.md if one doesn't already exist in worktree
  const claudeMdPath = join(claudeDir, 'CLAUDE.md');
  if (!existsSync(claudeMdPath)) {
    writeFileSync(claudeMdPath, PAI_CLAUDE_MD);
    console.error(`[WorktreeSetup] Wrote .claude/CLAUDE.md to ${worktreePath}`);
  }

  // Copy current-work.json if active work exists
  const currentWorkSrc = join(PAI_DIR, 'MEMORY', 'STATE', 'current-work.json');
  if (existsSync(currentWorkSrc)) {
    try {
      const content = readFileSync(currentWorkSrc, 'utf-8');
      writeFileSync(join(claudeDir, 'current-work.json'), content);
      console.error(`[WorktreeSetup] Copied current-work.json to worktree`);
    } catch {
      // Silent fail
    }
  }
}

async function readStdin(): Promise<WorktreeCreateInput | null> {
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
    if (input.trim()) return JSON.parse(input) as WorktreeCreateInput;
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

  console.error(`[WorktreeSetup] WorktreeCreate: ${worktreePath || '(no path)'} (session: ${sessionId.slice(0, 8)}...)`);

  // Log the event
  if (worktreePath) logWorktreeCreation(sessionId, worktreePath);

  // Inject PAI context into the worktree
  if (worktreePath && existsSync(worktreePath)) {
    injectContext(worktreePath);
    console.error(`[WorktreeSetup] Context injected successfully`);
  } else if (worktreePath) {
    console.error(`[WorktreeSetup] Worktree path not found: ${worktreePath}`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('[WorktreeSetup] Fatal error:', err);
  process.exit(0);
});
