#!/usr/bin/env bun
// memory-census.ts — Ground-truth census of every project memory key.
// Solves the "false counting" failure: distinguishes the LIVE curated pool
// (memory/*.md at depth 1) from already-ARCHIVED content (memory/.archive/**),
// reports recency, and flags whether the source ~/Projects/<name> folder still
// exists. Read-only — never deletes or moves anything.
//
// Why this exists: hand-maintained count tables rot, and relative-path shell
// loops silently return 0 because the SecurityValidator hook resets cwd between
// calls. This script is the single source of truth for "how many memories does
// key X have, and is it safe to purge?". Re-run before any memory cleanup.
//
// Usage:
//   bun scripts/memory-census.ts                 # full table, all keys
//   bun scripts/memory-census.ts --json          # machine-readable
//   bun scripts/memory-census.ts --purge-safe    # only keys safe to purge
//   bun scripts/memory-census.ts NAME [NAME...]  # filter to specific key names

import { readdirSync, existsSync, statSync, readFileSync } from 'fs';
import { join } from 'path';

const HOME = process.env.HOME!;                          // absolute base — never rely on cwd
const PROJECTS_KEYS = join(HOME, '.claude/projects');    // where memory keys live
const PROJECTS_SRC = join(HOME, 'Projects');             // where source folders live
const KEY_PREFIX = '-Users-your-name-Projects-';

const JSON_MODE = process.argv.includes('--json');
const PURGE_SAFE_ONLY = process.argv.includes('--purge-safe');
const NAME_FILTER = process.argv.slice(2).filter(a => !a.startsWith('--'));

interface Census {
  key: string;            // raw key dir name
  name: string;           // decoded project name (best-effort)
  liveCount: number;      // memory/*.md at depth 1 (the real curated pool)
  archiveCount: number;   // memory/.archive/**/*.md (already archived)
  newestLive: string | null;   // YYYY-MM-DD of newest live memory file
  lastSession: string | null;  // YYYY-MM-DD of newest *.jsonl transcript
  folderExists: boolean;  // does ~/Projects/<name> still exist?
  retired: boolean;       // MEMORY.md carries a RETIRED tombstone (content migrated elsewhere)
  purgeSafe: boolean;     // retired, OR live pool empty-or-fully-archived AND no source folder
  reason: string;         // why purgeSafe is what it is
}

function fmtDate(mtimeMs: number): string {
  const d = new Date(mtimeMs);
  // YYYY-MM-DD without locale/timezone surprises
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function countMd(dir: string, opts: { recursive: boolean }): { count: number; newestMs: number } {
  let count = 0;
  let newestMs = 0;
  function walk(d: string, depth: number) {
    let entries: string[];
    try { entries = readdirSync(d); } catch { return; }
    for (const e of entries) {
      const full = join(d, e);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        if (opts.recursive) walk(full, depth + 1);
        continue;
      }
      if (!e.endsWith('.md')) continue;
      count++;
      if (st.mtimeMs > newestMs) newestMs = st.mtimeMs;
    }
  }
  walk(dir, 0);
  return { count, newestMs };
}

function newestJsonl(keyDir: string): number {
  let newestMs = 0;
  let entries: string[];
  try { entries = readdirSync(keyDir); } catch { return 0; }
  for (const e of entries) {
    if (!e.endsWith('.jsonl')) continue;
    try {
      const st = statSync(join(keyDir, e));
      if (st.mtimeMs > newestMs) newestMs = st.mtimeMs;
    } catch { /* skip */ }
  }
  return newestMs;
}

function decodeName(key: string): string {
  return key.startsWith(KEY_PREFIX) ? key.slice(KEY_PREFIX.length) : key;
}

function censusFor(key: string): Census {
  const keyDir = join(PROJECTS_KEYS, key);
  const memDir = join(keyDir, 'memory');
  const archiveDir = join(memDir, '.archive');

  // LIVE pool = depth-1 *.md only (NOT recursive — this is the fix for over-counting)
  const live = countMd(memDir, { recursive: false });
  const archive = countMd(archiveDir, { recursive: true });
  const sessionMs = newestJsonl(keyDir);

  const name = decodeName(key);
  const folderExists = existsSync(join(PROJECTS_SRC, name));

  // A "RETIRED" tombstone in MEMORY.md means the content was verified-migrated to a canonical
  // home and what remains here is cold backup — safe to purge regardless of file count.
  let retired = false;
  try {
    retired = /^#\s*RETIRED\b/m.test(readFileSync(join(memDir, 'MEMORY.md'), 'utf-8'));
  } catch { /* no index */ }

  // Purge-safe ONLY when: retired tombstone present, OR (no live curated pool AND source folder gone).
  // A non-empty, non-retired live pool means the only copy lives here → never silently purge.
  let purgeSafe = false;
  let reason = '';
  if (retired) {
    purgeSafe = true;
    reason = `RETIRED tombstone — ${live.count} file(s) are cold backup, safe`;
  } else if (folderExists) {
    reason = 'source folder still exists — NOT orphaned';
  } else if (live.count > 0) {
    reason = `${live.count} live memory file(s) — only copy, review before purge`;
  } else {
    purgeSafe = true;
    reason = archive.count > 0 ? `0 live, ${archive.count} archived — safe` : '0 live memories — safe';
  }

  return {
    key, name,
    liveCount: live.count,
    archiveCount: archive.count,
    newestLive: live.newestMs ? fmtDate(live.newestMs) : null,
    lastSession: sessionMs ? fmtDate(sessionMs) : null,
    folderExists,
    retired,
    purgeSafe,
    reason,
  };
}

function main() {
  let keys: string[];
  try {
    keys = readdirSync(PROJECTS_KEYS).filter(k => existsSync(join(PROJECTS_KEYS, k, 'memory')));
  } catch {
    console.error(`Cannot read ${PROJECTS_KEYS}`);
    process.exit(2);
  }

  let rows = keys.map(censusFor);
  if (NAME_FILTER.length) {
    rows = rows.filter(r => NAME_FILTER.some(n => r.name.includes(n)));
  }
  if (PURGE_SAFE_ONLY) rows = rows.filter(r => r.purgeSafe);
  rows.sort((a, b) => b.liveCount - a.liveCount);

  if (JSON_MODE) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(pad('PROJECT', 30) + pad('LIVE', 6) + pad('ARCH', 6) + pad('NEWEST', 12) + pad('SESSION', 12) + pad('FOLDER', 8) + 'PURGE?');
  console.log('-'.repeat(94));
  for (const r of rows) {
    console.log(
      pad(r.name.slice(0, 29), 30) +
      pad(String(r.liveCount), 6) +
      pad(String(r.archiveCount), 6) +
      pad(r.newestLive ?? '—', 12) +
      pad(r.lastSession ?? '—', 12) +
      pad(r.retired ? 'retired' : r.folderExists ? 'LIVE' : 'gone', 8) +
      (r.purgeSafe ? `✅ ${r.reason}` : `⛔ ${r.reason}`)
    );
  }
  const safe = rows.filter(r => r.purgeSafe).length;
  console.log('-'.repeat(94));
  console.log(`${rows.length} keys | ${safe} purge-safe | ${rows.length - safe} keep/review`);
}

main();
