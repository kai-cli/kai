#!/usr/bin/env bun
/**
 * StartupGreeting.hook.ts - Session initialization guard (SessionStart)
 *
 * Marks the session as started (once-per-session sentinel) and skips
 * subagent/compaction re-fires. No visible output.
 *
 * TRIGGER: SessionStart
 */

import { alreadyRanForSession, markRanForSession } from './lib/once-per-session';

(async () => {
  try {
    const claudeProjectDir = process.env.CLAUDE_PROJECT_DIR || '';
    if (claudeProjectDir.includes('/.claude/Agents/') || process.env.CLAUDE_AGENT_TYPE !== undefined) {
      process.exit(0);
    }

    let sessionId: string | null = null;
    try {
      const stdinText = await Bun.stdin.text();
      if (stdinText.trim()) {
        const hookInput = JSON.parse(stdinText);
        sessionId = hookInput.session_id || null;
        if (hookInput.source === 'compact') process.exit(0);
      }
    } catch {}

    if (alreadyRanForSession('StartupGreeting', sessionId)) process.exit(0);
    markRanForSession('StartupGreeting', sessionId);

    process.exit(0);
  } catch {
    process.exit(0);
  }
})();
