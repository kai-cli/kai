/**
 * transcript-cache.ts — Shared per-session transcript parse cache (W3, 2026-06-05)
 *
 * PROBLEM: ~14 hooks reference transcript_path; several independently call
 * parseTranscript() (full file read + JSONL parse) on the SAME session
 * transcript. Because SessionEnd/Stop hooks run as SEPARATE subprocesses
 * (run-hook.sh per entry), an in-process cache shares nothing — so this cache
 * is DISK-based, keyed on transcript_path + file mtime + byte size.
 *
 * Transcripts are append-only during a session, so (mtime,size) changing is a
 * correct invalidation signal: a stale cache entry is never returned.
 *
 * SAFETY: getCachedTranscript NEVER throws. Any cache error (stat failure,
 * corrupt cache JSON, write failure) falls back to a direct parseTranscript().
 * Worst case is exactly today's behavior (a redundant parse) — no correctness loss.
 *
 * FLAG: config/settings.json → transcriptCache.enabled (default true).
 * Disabled → behaves identically to calling parseTranscript() directly.
 */

import { readFileSync, writeFileSync, statSync, mkdirSync, existsSync, renameSync, readdirSync, unlinkSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { parseTranscript, type ParsedTranscript } from './transcript-parser';
import { paiPath } from './paths';

interface CacheRecord {
  key: string;
  parsed: ParsedTranscript;
}

function cacheDir(): string {
  return paiPath('MEMORY', 'STATE', 'transcript-cache');
}

function sha(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 32);
}

/** Cache file path for a given transcript path (one file per transcript, overwritten in place). */
function cacheFileFor(transcriptPath: string): string {
  return join(cacheDir(), `${sha(transcriptPath)}.json`);
}

/** Build the invalidation key from the transcript's current mtime + size. */
function buildKey(transcriptPath: string): string {
  const st = statSync(transcriptPath);
  return `${transcriptPath}:${st.mtimeMs}:${st.size}`;
}

function isEnabled(): boolean {
  try {
    const path = paiPath('config', 'settings.json');
    if (!existsSync(path)) return true; // default ON
    const cfg = JSON.parse(readFileSync(path, 'utf-8'));
    return cfg?.transcriptCache?.enabled !== false;
  } catch {
    return true;
  }
}

/** Atomic write: tmp file + rename (rename is atomic on POSIX). Tolerant of concurrent writers. */
function atomicWrite(file: string, contents: string): void {
  const tmp = `${file}.tmp.${process.pid}`;
  writeFileSync(tmp, contents, 'utf-8');
  renameSync(tmp, file);
}

/**
 * Return a parsed transcript, using the disk cache when the file is unchanged.
 * Drop-in replacement for parseTranscript(path). Never throws.
 */
export function getCachedTranscript(transcriptPath: string): ParsedTranscript {
  if (!isEnabled()) return parseTranscript(transcriptPath);

  let key: string;
  try {
    key = buildKey(transcriptPath);
  } catch {
    // Can't stat (missing file etc.) — let parseTranscript handle it (returns empty parse).
    return parseTranscript(transcriptPath);
  }

  const file = cacheFileFor(transcriptPath);

  // Cache hit path
  try {
    if (existsSync(file)) {
      const rec = JSON.parse(readFileSync(file, 'utf-8')) as CacheRecord;
      if (rec && rec.key === key && rec.parsed) {
        return rec.parsed; // fresh deserialize each call — no shared mutable singleton
      }
    }
  } catch {
    // Corrupt/partial cache file — ignore and re-parse below.
  }

  // Miss / stale / corrupt: parse fresh and write cache
  const parsed = parseTranscript(transcriptPath);
  try {
    mkdirSync(cacheDir(), { recursive: true });
    atomicWrite(file, JSON.stringify({ key, parsed } satisfies CacheRecord));
  } catch (err) {
    // Cache write failed — non-fatal, the parsed result is still correct.
    console.error('[transcript-cache] write failed (non-fatal):', err);
  }
  return parsed;
}

/** Exported for tests/maintenance: where cache files live. */
export function transcriptCacheDir(): string {
  return cacheDir();
}

/**
 * SF-4: prune cache files not modified within maxAgeDays. One file per transcript-hash accumulates as
 * old sessions' transcripts age out; this keeps the dir bounded. Returns the number of files removed.
 * Safe/idempotent — missing dir or unreadable file is skipped, never throws. Run from weekly maintenance.
 */
export function pruneOldCaches(maxAgeDays = 30): number {
  const dir = cacheDir();
  if (!existsSync(dir)) return 0;
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  let removed = 0;
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      const p = join(dir, f);
      try {
        if (statSync(p).mtimeMs < cutoff) { unlinkSync(p); removed++; }
      } catch { /* skip individual file errors */ }
    }
  } catch { /* dir unreadable — nothing to prune */ }
  return removed;
}

// CLI: `bun hooks/lib/transcript-cache.ts --prune [days]` — used by weekly maintenance.
if (import.meta.main) {
  const i = process.argv.indexOf('--prune');
  if (i >= 0) {
    const days = parseInt(process.argv[i + 1]) || 30;
    const n = pruneOldCaches(days);
    console.log(`[transcript-cache] pruned ${n} cache file(s) older than ${days}d`);
  }
}
