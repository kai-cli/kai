#!/usr/bin/env bun
/**
 * StartupGreeting.hook.ts - Session initialization + Kitty persistence (SessionStart)
 *
 * Marks the session as started (once-per-session sentinel), skips
 * subagent/compaction re-fires, and persists Kitty terminal env
 * for hooks that run later without terminal context.
 *
 * TRIGGER: SessionStart
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { getPaiDir } from './lib/paths';
import { persistKittySession } from './lib/tab-setter';
import { alreadyRanForSession, markRanForSession } from './lib/once-per-session';

const paiDir = getPaiDir();

(async () => {
  try {
    const claudeProjectDir = process.env.CLAUDE_PROJECT_DIR || '';
    if (claudeProjectDir.includes('/.claude/Agents/') || process.env.CLAUDE_AGENT_TYPE !== undefined) {
      process.exit(0);
    }

    let sessionId: string | null = null;
    let hookInput: Record<string, unknown> = {};
    try {
      const stdinText = await Bun.stdin.text();
      if (stdinText.trim()) {
        hookInput = JSON.parse(stdinText);
        sessionId = (hookInput.session_id as string) || null;
      }
    } catch {}

    // Skip banner on compaction — PostCompactRecovery handles that case
    if (hookInput.source === 'compact') {
      process.exit(0);
    }

    // Only show banner once per session (prevents re-fire on compaction/resume)
    if (alreadyRanForSession('StartupGreeting', sessionId)) {
      process.exit(0);
    }
    markRanForSession('StartupGreeting', sessionId);

    // Persist Kitty environment for hooks that run later without terminal context.
    // Uses per-session mapping so multiple tabs don't overwrite each other's window IDs.
    const kittyListenOn = process.env.KITTY_LISTEN_ON;
    const kittyWindowId = process.env.KITTY_WINDOW_ID;
    if (kittyListenOn && kittyWindowId) {
      if (sessionId) {
        persistKittySession(sessionId, kittyListenOn, kittyWindowId);
      } else {
        const stateDir = join(paiDir, 'MEMORY', 'STATE');
        if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
        writeFileSync(
          join(stateDir, 'kitty-env.json'),
          JSON.stringify({ KITTY_LISTEN_ON: kittyListenOn, KITTY_WINDOW_ID: kittyWindowId }, null, 2)
        );
      }
    }

    process.exit(0);
  } catch {
    process.exit(0);
  }
})();
