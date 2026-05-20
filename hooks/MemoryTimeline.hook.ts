#!/usr/bin/env bun
/**
 * MemoryTimeline.hook.ts — Append session summary to timeline.jsonl
 *
 * TRIGGER: SessionEnd
 * PURPOSE: Layer 2 of progressive disclosure memory — activity log.
 * Append-only JSONL; trimmed at 500 entries.
 *
 * OUTPUT: Appends one entry to MEMORY/STATE/timeline.jsonl
 */

import { getPaiDir } from './lib/paths';
import { appendTimeline } from './lib/memory-disclosure';

async function main() {
  try {
    let sessionId: string | null = null;
    let projectDir: string = process.cwd();

    try {
      const stdinText = await Bun.stdin.text();
      if (stdinText.trim()) {
        const input = JSON.parse(stdinText);
        sessionId = input.session_id || null;
        projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
      }
    } catch { /* proceed without stdin */ }

    const paiDir = getPaiDir();
    const timestamp = new Date().toISOString();

    appendTimeline(paiDir, {
      timestamp,
      session_id: sessionId,
      project: projectDir,
      event: 'session_end',
    });

    console.error(`[MemoryTimeline] Appended session end to timeline (${timestamp})`);
    process.exit(0);
  } catch (err) {
    console.error('[MemoryTimeline] Error:', err);
    process.exit(0);
  }
}

if (import.meta.main) main();
