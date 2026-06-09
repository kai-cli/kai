#!/usr/bin/env bun
/**
 * WeeklyMaintenance.hook.ts - Nudge weekly maintenance when overdue (SessionStart)
 *
 * Checks if 7+ days have passed since last maintenance run.
 * If overdue, injects a context reminder so the DA triggers the run.
 *
 * TRIGGER: SessionStart
 * OUTPUT: additionalContext (maintenance reminder) or silent exit
 * PERFORMANCE: <5ms (single file read)
 */

import { readJSON } from './lib/atomic';
import { join } from 'path';
import { getPaiDir } from './lib/paths';

const STATE_FILE = join(getPaiDir(), 'MEMORY', 'STATE', '.weekly-maintenance.json');
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

interface MaintenanceState {
  lastRun: number;
  lastRunDate: string;
}

function readState(): MaintenanceState | null {
  return readJSON<MaintenanceState | null>(STATE_FILE, null);
}

async function main() {
  try {
    const stdinText = await Bun.stdin.text();
    if (stdinText.trim()) {
      const hookInput = JSON.parse(stdinText);
      if (hookInput.source === 'compact') process.exit(0);
    }
  } catch { /* proceed */ }

  if (process.env.CLAUDE_AGENT_TYPE !== undefined) process.exit(0);

  const state = readState();
  const now = Date.now();

  if (state && (now - state.lastRun) < SEVEN_DAYS_MS) {
    process.exit(0);
  }

  const daysSince = state ? Math.floor((now - state.lastRun) / (24 * 60 * 60 * 1000)) : null;
  const overdue = daysSince ? `${daysSince} days since last run (${state!.lastRunDate})` : 'never run';

  console.log(JSON.stringify({
    additionalContext: `⚠️ **Weekly maintenance overdue** (${overdue}). Run: \`bun scripts/weekly-maintenance.ts\` — or say "run weekly maintenance" to execute automatically.`
  }));
  process.exit(0);
}

main().catch(() => process.exit(0));
