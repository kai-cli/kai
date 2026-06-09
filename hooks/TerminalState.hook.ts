#!/usr/bin/env bun
/**
 * TerminalState.hook.ts — Consolidated terminal state management
 *
 * Handles all terminal tab state across the session lifecycle.
 * Routes by hook event to the appropriate handler function.
 *
 * Events handled:
 * - SessionStart:   Persist Kitty env variables, reset tab to idle state
 * - UserPromptSubmit: Set tab title from prompt (thinking → working), fire voice
 * - Stop:           Reset tab to completed state after response
 * - PreToolUse (AskUserQuestion): Set tab to question/teal state
 *
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { setTabState, readTabState, persistKittySession, persistItermSession } from './lib/tab-setter';
import { getDAName } from './lib/identity';
import { readHookInput } from './lib/hook-io';
import { paiPath } from './lib/paths';

// ─── Shared types ────────────────────────────────────────────────────────────

interface SessionStartInput {
  session_id?: string;
  hook_event_name: string;
  source?: string;
}

// ─── SessionStart: kitty env + tab reset ─────────────────────────────────────

function handleSessionStart(data: SessionStartInput): void {
  // Skip for subagents
  const claudeProjectDir = process.env.CLAUDE_PROJECT_DIR || '';
  const isSubagent = claudeProjectDir.includes('/.claude/Agents/') ||
                    process.env.CLAUDE_AGENT_TYPE !== undefined;
  if (isSubagent) return;

  const sessionId = data.session_id;

  // Persist Kitty environment per-session (new API — per-session files, no shared state)
  const kittyListenOn = process.env.KITTY_LISTEN_ON;
  const kittyWindowId = process.env.KITTY_WINDOW_ID;
  if (kittyListenOn && kittyWindowId && sessionId) {
    persistKittySession(sessionId, kittyListenOn, kittyWindowId);
  }

  // Persist iTerm2 TTY per-session for tab title updates
  if (process.env.TERM_PROGRAM === 'iTerm.app' && sessionId) {
    try {
      let pid = process.pid;
      for (let i = 0; i < 10; i++) {
        const info = execSync(`ps -p ${pid} -o ppid=,tty=`, { encoding: 'utf-8', timeout: 2000 }).trim();
        const parts = info.split(/\s+/);
        if (parts[1] && parts[1] !== '??' && parts[1] !== '?') {
          persistItermSession(sessionId, `/dev/${parts[1]}`);
          break;
        }
        pid = parseInt(parts[0]);
        if (!pid || pid <= 1) break;
      }
    } catch { /* silent */ }
  }

  // Legacy: also write kitty-env.json for hooks that don't have session ID
  if (kittyListenOn && kittyWindowId) {
    const stateDir = paiPath('MEMORY', 'STATE');
    if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, 'kitty-env.json'),
      JSON.stringify({ KITTY_LISTEN_ON: kittyListenOn, KITTY_WINDOW_ID: kittyWindowId }, null, 2)
    );
  }

  // Reset tab title — prevent stale titles bleeding through
  try {
    const current = readTabState(sessionId);
    if (current && (current.state === 'working' || current.state === 'thinking')) {
      console.error(`🔄 Tab in ${current.state} state — preserving title through compaction`);
    } else {
      setTabState({ title: `${getDAName()} ready…`, state: 'idle', sessionId });
      console.error('🔄 Tab title reset to clean state');
    }
  } catch (err) {
    console.error(`⚠️ Failed to reset tab title: ${err}`);
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

async function main() {
  try {
    const input = await readHookInput();
    if (!input) process.exit(0);

    const event = input.hook_event_name;

    // W10: TerminalState now owns ONLY SessionStart (Kitty/iTerm session persistence + idle reset).
    // Its former UserPromptSubmit / Stop / PreToolUse:AskUserQuestion branches were exact duplicates of
    // UpdateTabTitle / handlers/TabState (via StopOrchestrator) / SetQuestionTab respectively — removed to
    // end the multi-writer race on tab state (and a dead voice-inference call). See findings/w10-terminalui-design.md.
    if (event === 'SessionStart') {
      handleSessionStart(input as unknown as SessionStartInput);
    }
  } catch (err) {
    console.error(`[TerminalState] Error: ${err}`);
  }

  process.exit(0);
}

main().catch((err) => { console.error(`[TerminalState] Error:`, err); process.exit(0); });
