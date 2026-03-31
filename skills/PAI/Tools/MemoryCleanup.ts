#!/usr/bin/env bun
/**
 * MemoryCleanup.ts - Prevent unbounded growth of MEMORY directories
 *
 * PURPOSE:
 * Runs on a weekly cadence (gated by last-run timestamp). Trims events.jsonl
 * at 10MB, removes session files older than 30 days, and cleans stale
 * prompt-analysis-cache files older than 1 hour.
 *
 * USAGE:
 *   bun ~/.claude/skills/PAI/Tools/MemoryCleanup.ts
 *   bun ~/.claude/skills/PAI/Tools/MemoryCleanup.ts --force
 *
 * SAFE: Never deletes WORK sessions, PRDs, or LEARNING files — only STATE files.
 */

import { existsSync, readFileSync, writeFileSync, statSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

function paiPath(...segments: string[]): string {
  const base = process.env.PAI_DIR || join(homedir(), '.claude');
  return join(base, ...segments);
}

const FORCE = process.argv.includes('--force');
const DRY_RUN = process.argv.includes('--dry-run');

const LAST_RUN_FILE = paiPath('MEMORY', 'STATE', 'memory-cleanup-last-run.txt');
const EVENTS_FILE = paiPath('MEMORY', 'STATE', 'events.jsonl');
const SESSION_STATE_DIR = paiPath('MEMORY', 'STATE');
const PROMPT_CACHE_DIR = paiPath('MEMORY', 'STATE', 'prompt-analysis-cache');
const ALGO_STATE_DIR = paiPath('MEMORY', 'STATE', 'algorithms');

const MAX_EVENTS_BYTES = 10 * 1024 * 1024; // 10MB
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const CACHE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour
const RUN_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function log(msg: string) {
  const prefix = DRY_RUN ? '[DRY-RUN] ' : '';
  console.error(`[MemoryCleanup] ${prefix}${msg}`);
}

function shouldRun(): boolean {
  if (FORCE) return true;
  try {
    if (!existsSync(LAST_RUN_FILE)) return true;
    const lastRun = parseInt(readFileSync(LAST_RUN_FILE, 'utf-8').trim(), 10);
    return Date.now() - lastRun > RUN_INTERVAL_MS;
  } catch {
    return true;
  }
}

function trimEventsJsonl(): { removed: number; sizeBefore: number; sizeAfter: number } {
  if (!existsSync(EVENTS_FILE)) return { removed: 0, sizeBefore: 0, sizeAfter: 0 };

  const sizeBefore = statSync(EVENTS_FILE).size;
  if (sizeBefore <= MAX_EVENTS_BYTES) {
    log(`events.jsonl is ${(sizeBefore / 1024 / 1024).toFixed(1)}MB — within limit, skipping`);
    return { removed: 0, sizeBefore, sizeAfter: sizeBefore };
  }

  log(`events.jsonl is ${(sizeBefore / 1024 / 1024).toFixed(1)}MB — trimming to ${MAX_EVENTS_BYTES / 1024 / 1024}MB`);

  const content = readFileSync(EVENTS_FILE, 'utf-8');
  const lines = content.trim().split('\n').filter(l => l.trim());
  const totalLines = lines.length;

  // Keep newest lines that fit within MAX_EVENTS_BYTES
  let kept = 0;
  let size = 0;
  const keepLines: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const lineSize = Buffer.byteLength(lines[i] + '\n', 'utf-8');
    if (size + lineSize > MAX_EVENTS_BYTES) break;
    keepLines.unshift(lines[i]);
    size += lineSize;
    kept++;
  }

  const removed = totalLines - kept;
  if (!DRY_RUN) {
    writeFileSync(EVENTS_FILE, keepLines.join('\n') + '\n', 'utf-8');
  }

  const sizeAfter = Buffer.byteLength(keepLines.join('\n') + '\n', 'utf-8');
  log(`Trimmed events.jsonl: removed ${removed} old lines, kept ${kept} lines (${(sizeAfter / 1024 / 1024).toFixed(1)}MB)`);
  return { removed, sizeBefore, sizeAfter };
}

function cleanPromptAnalysisCache(): number {
  if (!existsSync(PROMPT_CACHE_DIR)) return 0;

  let cleaned = 0;
  const now = Date.now();

  try {
    for (const file of readdirSync(PROMPT_CACHE_DIR)) {
      if (!file.endsWith('.json')) continue;
      const filePath = join(PROMPT_CACHE_DIR, file);
      const age = now - statSync(filePath).mtimeMs;
      if (age > CACHE_MAX_AGE_MS) {
        if (!DRY_RUN) unlinkSync(filePath);
        cleaned++;
        log(`Removed stale cache: ${file} (age: ${Math.round(age / 60000)}min)`);
      }
    }
  } catch (err) {
    log(`Cache cleanup error: ${err}`);
  }

  return cleaned;
}

function cleanStaleAlgorithmState(): number {
  if (!existsSync(ALGO_STATE_DIR)) return 0;

  let cleaned = 0;
  const now = Date.now();

  try {
    for (const file of readdirSync(ALGO_STATE_DIR)) {
      if (!file.endsWith('.json')) continue;
      const filePath = join(ALGO_STATE_DIR, file);
      const age = now - statSync(filePath).mtimeMs;
      if (age > SESSION_MAX_AGE_MS) {
        if (!DRY_RUN) unlinkSync(filePath);
        cleaned++;
        log(`Removed old algorithm state: ${file} (age: ${Math.round(age / 86400000)}d)`);
      }
    }
  } catch (err) {
    log(`Algorithm state cleanup error: ${err}`);
  }

  return cleaned;
}

async function main() {
  if (!shouldRun()) {
    log('Last run was within 7 days — skipping (use --force to override)');
    process.exit(0);
  }

  log('Starting memory cleanup...');

  const { removed: eventsRemoved, sizeBefore, sizeAfter } = trimEventsJsonl();
  const cachesCleaned = cleanPromptAnalysisCache();
  const algoStateCleaned = cleanStaleAlgorithmState();

  const summary = [
    `events.jsonl: removed ${eventsRemoved} lines (${(sizeBefore / 1024 / 1024).toFixed(1)}MB → ${(sizeAfter / 1024 / 1024).toFixed(1)}MB)`,
    `prompt-analysis-cache: removed ${cachesCleaned} stale files`,
    `algorithm-state: removed ${algoStateCleaned} old session files`,
  ].join(', ');

  log(`Complete: ${summary}`);

  if (!DRY_RUN) {
    writeFileSync(LAST_RUN_FILE, Date.now().toString(), 'utf-8');
  }

  console.log(JSON.stringify({ success: true, summary, dryRun: DRY_RUN }));
  process.exit(0);
}

main().catch(err => {
  console.error(`[MemoryCleanup] Fatal: ${err}`);
  process.exit(1);
});
