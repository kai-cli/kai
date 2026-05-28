/**
 * hook-perf.ts - Hook performance monitoring
 *
 * PURPOSE: Track hook execution timing for performance analysis.
 * Writes timing data to MEMORY/STATE/hook-perf.jsonl (append-only).
 *
 * USAGE:
 *   import { startTimer, endTimer } from './lib/hook-perf';
 *
 *   const timer = startTimer('MyHook');
 *   // ... hook work ...
 *   endTimer(timer);
 *
 * OUTPUT FORMAT (JSONL):
 *   {"hook":"LoadContext","duration_ms":45,"timestamp":"2026-05-27T10:30:00Z"}
 */

import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { getPaiDir } from './paths';

export interface PerfTimer {
  hookName: string;
  startTime: number;
}

export interface PerfEntry {
  hook: string;
  duration_ms: number;
  timestamp: string;
}

export function startTimer(hookName: string): PerfTimer {
  return {
    hookName,
    startTime: performance.now(),
  };
}

export function endTimer(timer: PerfTimer): void {
  const duration = performance.now() - timer.startTime;
  const entry: PerfEntry = {
    hook: timer.hookName,
    duration_ms: Math.round(duration * 10) / 10,
    timestamp: new Date().toISOString(),
  };

  try {
    const paiDir = getPaiDir();
    const stateDir = join(paiDir, 'MEMORY', 'STATE');
    const perfLog = join(stateDir, 'hook-perf.jsonl');

    if (!existsSync(stateDir)) {
      mkdirSync(stateDir, { recursive: true });
    }

    appendFileSync(perfLog, JSON.stringify(entry) + '\n', 'utf-8');
  } catch (err) {
    console.error(`[hook-perf] Failed to write timing: ${err}`);
  }
}
