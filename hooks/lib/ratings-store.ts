/**
 * ratings-store.ts — Shared access layer for MEMORY/LEARNING/SIGNALS/ratings.jsonl (W11).
 *
 * Before this, ~6 readers + 2 writers each opened/parsed the ratings JSONL independently with slightly
 * different logic (count, recent-N-days, low-rating filter, cap-at-500). This centralizes the path, the
 * parse, and the cap so there is one definition of "a rating" and one place to change the format.
 *
 * All functions are defensive: a missing/corrupt file yields empty results (never throws), matching the
 * prior per-caller try/catch behavior. Malformed individual lines are skipped, not fatal.
 */
import { existsSync, readFileSync, appendFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { getPaiDir } from './paths';

export interface RatingEntry {
  rating: number;
  /** ISO timestamp; some legacy entries used `date`. Normalized on read via entryDate(). */
  timestamp?: string;
  date?: string;
  [key: string]: unknown;
}

export const DEFAULT_RATINGS_CAP = 500;

export function ratingsPath(paiDir: string = getPaiDir()): string {
  return join(paiDir, 'MEMORY', 'LEARNING', 'SIGNALS', 'ratings.jsonl');
}

/** Best-effort date for an entry (prefers `timestamp`, falls back to `date`). null if unparseable. */
export function entryDate(e: RatingEntry): Date | null {
  const raw = e.timestamp || e.date;
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

/** Parse all rating entries (newest-last, file order). Skips malformed lines. Empty on missing file. */
export function loadAll(paiDir: string = getPaiDir()): RatingEntry[] {
  const path = ratingsPath(paiDir);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, 'utf-8')
      .trim()
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => { try { return JSON.parse(l) as RatingEntry; } catch { return null; } })
      .filter((e): e is RatingEntry => e !== null);
  } catch {
    return [];
  }
}

/** Total number of rating lines (cheap line count, matches the old GetCounts/UpdateCounts behavior). */
export function count(paiDir: string = getPaiDir()): number {
  const path = ratingsPath(paiDir);
  if (!existsSync(path)) return 0;
  try {
    return readFileSync(path, 'utf-8').split('\n').filter((l) => l.trim()).length;
  } catch {
    return 0;
  }
}

/** The last `n` parsed entries (newest). */
export function loadRecent(n: number, paiDir: string = getPaiDir()): RatingEntry[] {
  const all = loadAll(paiDir);
  return n >= all.length ? all : all.slice(-n);
}

/** Entries within the last `daysBack` days (by entryDate). */
export function loadSince(daysBack: number, paiDir: string = getPaiDir()): RatingEntry[] {
  const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;
  return loadAll(paiDir).filter((e) => {
    const d = entryDate(e);
    return d !== null && d.getTime() >= cutoff;
  });
}

/** Entries whose numeric rating satisfies the predicate (e.g. low-rating bridge: r => r <= 3). */
export function filterByRating(pred: (rating: number) => boolean, paiDir: string = getPaiDir()): RatingEntry[] {
  return loadAll(paiDir).filter((e) => typeof e.rating === 'number' && pred(e.rating));
}

/** Append one rating entry (creates the file + dir if needed). Returns false on failure (never throws). */
export function append(entry: RatingEntry, paiDir: string = getPaiDir()): boolean {
  const path = ratingsPath(paiDir);
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(entry) + '\n', 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/** Trim the file to the last `max` entries. Returns the new count (or current count if no trim needed). */
export function cap(max: number = DEFAULT_RATINGS_CAP, paiDir: string = getPaiDir()): number {
  const path = ratingsPath(paiDir);
  if (!existsSync(path)) return 0;
  try {
    const lines = readFileSync(path, 'utf-8').trim().split('\n').filter((l) => l);
    if (lines.length > max) {
      writeFileSync(path, lines.slice(-max).join('\n') + '\n', 'utf-8');
      return max;
    }
    return lines.length;
  } catch {
    return 0;
  }
}
