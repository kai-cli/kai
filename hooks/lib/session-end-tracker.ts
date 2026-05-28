/**
 * session-end-tracker.ts - Coordination tracking for SessionEnd hooks
 *
 * PURPOSE:
 * Provides atomic sentinel file tracking for async SessionEnd hooks.
 * If the process dies during SessionEnd, sentinel files let us detect
 * which hooks started but didn't complete.
 *
 * ARCHITECTURE:
 * - Each hook marks started via markStarted(hookName, sessionId)
 * - On completion, markComplete(hookName, sessionId) renames .started -> .complete
 * - detectStale() finds .started files with no matching .complete
 * - cleanupSession(sessionId) removes all sentinel files for that session
 *
 * FILE FORMAT:
 * - Location: MEMORY/STATE/session-end/
 * - Started: {hook-name}.{session-id}.started
 * - Complete: {hook-name}.{session-id}.complete
 *
 * USAGE:
 * import { markStarted, markComplete, detectStale, cleanupSession } from './lib/session-end-tracker';
 *
 * async function main() {
 *   const sessionId = input.session_id;
 *   const hookName = 'InsightExtractor';
 *   markStarted(hookName, sessionId);
 *   try {
 *     await doWork();
 *     markComplete(hookName, sessionId);
 *   } catch (error) {
 *     // .started file remains, detectStale() will find it
 *     throw error;
 *   }
 * }
 */

import { existsSync, mkdirSync, writeFileSync, renameSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { paiPath } from './paths';

const SENTINEL_DIR = () => paiPath('MEMORY', 'STATE', 'session-end');

function ensureDir(): void {
  const dir = SENTINEL_DIR();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Mark a hook as started.
 * Creates a .started sentinel file.
 */
export function markStarted(hookName: string, sessionId: string): void {
  try {
    ensureDir();
    const startedPath = join(SENTINEL_DIR(), `${hookName}.${sessionId}.started`);
    writeFileSync(startedPath, new Date().toISOString(), 'utf-8');
  } catch (error) {
    // Non-fatal: tracking failure shouldn't block hook execution
    console.error(`[session-end-tracker] Failed to mark started: ${error}`);
  }
}

/**
 * Mark a hook as complete.
 * Renames .started -> .complete (atomic on most filesystems).
 */
export function markComplete(hookName: string, sessionId: string): void {
  try {
    ensureDir();
    const startedPath = join(SENTINEL_DIR(), `${hookName}.${sessionId}.started`);
    const completePath = join(SENTINEL_DIR(), `${hookName}.${sessionId}.complete`);

    if (existsSync(startedPath)) {
      renameSync(startedPath, completePath);
    } else {
      // Hook called markComplete without markStarted - just create .complete
      writeFileSync(completePath, new Date().toISOString(), 'utf-8');
    }
  } catch (error) {
    console.error(`[session-end-tracker] Failed to mark complete: ${error}`);
  }
}

/**
 * Detect stale hooks.
 * Returns array of hook names that have .started but no .complete.
 */
export function detectStale(): string[] {
  try {
    const dir = SENTINEL_DIR();
    if (!existsSync(dir)) return [];

    const files = readdirSync(dir);
    const startedFiles = files.filter(f => f.endsWith('.started'));
    const stale: string[] = [];

    for (const startedFile of startedFiles) {
      const completeFile = startedFile.replace('.started', '.complete');
      if (!files.includes(completeFile)) {
        // Extract hook name from filename: {hook-name}.{session-id}.started
        const hookName = startedFile.split('.').slice(0, -2).join('.');
        stale.push(hookName);
      }
    }

    return stale;
  } catch (error) {
    console.error(`[session-end-tracker] Failed to detect stale: ${error}`);
    return [];
  }
}

/**
 * Clean up all sentinel files for a given session.
 * Should be called after all hooks complete successfully or after
 * processing stale hooks from a previous session.
 */
export function cleanupSession(sessionId: string): void {
  try {
    const dir = SENTINEL_DIR();
    if (!existsSync(dir)) return;

    const files = readdirSync(dir);
    for (const file of files) {
      // Match files with this session ID: {hook-name}.{session-id}.{started|complete}
      if (file.includes(`.${sessionId}.`)) {
        unlinkSync(join(dir, file));
      }
    }
  } catch (error) {
    console.error(`[session-end-tracker] Failed to cleanup session: ${error}`);
  }
}
