/**
 * embeddings-sqlite.ts — derived SQLite index for semantic recall (MEMORY-ARCHITECTURE-PLAN.md Phase 2a).
 *
 * WHY: the legacy path (semantic-fallback.ts) reads the full ~38MB index.jsonl and JSON.parses every
 * line + linear-cosine-scans all ~3,514 chunks on each routing-miss. This builds a derived SQLite
 * cache (FTS5 keyword pre-filter → cosine rerank on candidates only) so recall stops paying the fat
 * file every time.
 *
 * SOURCE-OF-TRUTH DOCTRINE (plan §4 R2 / §6 D2-sub): index.jsonl stays the TRUTH (itself rebuilt from
 * the .md memories by EmbeddingIndex.ts). This .db is a DERIVED, DISPOSABLE cache — regenerable, never
 * authoritative, never the thing we back up. Invalidation: rebuild when index.jsonl is newer than the
 * .db (mtime), or on explicit --rebuild. We NEVER modify or delete index.jsonl (rayhunter-additive).
 *
 * Zero new deps: bun:sqlite (FTS5 + BLOB) is built into the runtime.
 */
import { Database } from 'bun:sqlite';
import { existsSync, statSync, readFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { cosineSimilarity } from './similarity';

export interface IndexChunk { path: string; text: string; embedding: number[]; section?: string }
export interface ScoredChunk { path: string; text: string; score: number }

export function jsonlPath(paiDir: string): string {
  return join(paiDir, 'MEMORY', 'STATE', 'embeddings', 'index.jsonl');
}
export function dbPath(paiDir: string): string {
  return join(paiDir, 'MEMORY', 'STATE', 'embeddings', 'index.sqlite');
}

/** Float32 ↔ BLOB helpers (compact, lossless-enough for cosine). */
function embToBlob(emb: number[]): Buffer {
  const f = new Float32Array(emb);
  return Buffer.from(f.buffer, f.byteOffset, f.byteLength);
}
function blobToEmb(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

/**
 * True if the derived .db is missing or older than the JSONL truth → needs (re)build.
 * Missing JSONL → false (nothing to build from; caller falls back).
 */
export function isStale(paiDir: string): boolean {
  const jsonl = jsonlPath(paiDir);
  const db = dbPath(paiDir);
  if (!existsSync(jsonl)) return false;
  if (!existsSync(db)) return true;
  try {
    return statSync(jsonl).mtimeMs > statSync(db).mtimeMs;
  } catch {
    return true;
  }
}

/**
 * Build (or rebuild) the derived .db from index.jsonl. Atomic-ish: build into a temp path, then
 * replace. Returns chunk count, or -1 on failure (caller falls back to JSONL). Never throws.
 */
export function buildIndex(paiDir: string): number {
  const jsonl = jsonlPath(paiDir);
  if (!existsSync(jsonl)) return -1;
  const finalDb = dbPath(paiDir);
  const tmpDb = finalDb + '.tmp';
  try {
    mkdirSync(dirname(finalDb), { recursive: true });
    try { if (existsSync(tmpDb)) unlinkSync(tmpDb); } catch {}

    const db = new Database(tmpDb, { create: true });
    // NOT WAL: this is a write-once/read-many derived cache built into a temp file then renamed.
    // WAL would require -wal/-shm sidecars that the rename orphans, breaking later readonly opens.
    // DELETE journal keeps the .sqlite a single self-contained file safe to rename + open readonly.
    db.run('PRAGMA journal_mode = DELETE');
    db.run('CREATE TABLE chunks (id INTEGER PRIMARY KEY, path TEXT, text TEXT, emb BLOB)');
    db.run("CREATE VIRTUAL TABLE chunks_fts USING fts5(text, content='chunks', content_rowid='id')");

    const insert = db.prepare('INSERT INTO chunks (id, path, text, emb) VALUES (?,?,?,?)');
    const insertFts = db.prepare('INSERT INTO chunks_fts (rowid, text) VALUES (?,?)');

    let n = 0;
    const lines = readFileSync(jsonl, 'utf-8').split('\n');
    const tx = db.transaction((rows: string[]) => {
      for (const line of rows) {
        if (!line.trim()) continue;
        let c: IndexChunk;
        try { c = JSON.parse(line); } catch { continue; }
        if (!Array.isArray(c.embedding) || !c.text) continue;
        n += 1;
        insert.run(n, c.path ?? '', c.text, embToBlob(c.embedding));
        insertFts.run(n, c.text);
      }
    });
    tx(lines);
    db.close();

    // Replace final atomically (rename within same dir).
    try { if (existsSync(finalDb)) unlinkSync(finalDb); } catch {}
    require('node:fs').renameSync(tmpDb, finalDb);
    // Best-effort WAL sidecar cleanup of the temp name (real WAL belongs to finalDb after rename).
    for (const ext of ['-wal', '-shm']) {
      try { if (existsSync(tmpDb + ext)) unlinkSync(tmpDb + ext); } catch {}
    }
    return n;
  } catch {
    try { if (existsSync(tmpDb)) unlinkSync(tmpDb); } catch {}
    return -1;
  }
}

/**
 * Query the derived index by cosine similarity over the stored BLOB embeddings.
 *
 * IMPORTANT (parity, verified 2026-06-21): we do a FULL cosine scan, NOT an FTS5 keyword pre-filter.
 * For embeddings, keyword-relevant ⊉ semantically-relevant — an FTS prefilter silently drops the
 * semantically-best chunk when it isn't a strong literal keyword match (caught in testing: the legacy
 * path's 0.804 top hit had weak keyword overlap and FTS missed it). The speed win here comes from
 * avoiding JSON.parse of the 38MB JSONL (embeddings are BLOBs, decoded only for the dot product),
 * NOT from prefiltering — so a full scan is both correct AND fast. The chunks_fts table is retained
 * for future keyword/hybrid needs (Opt 5), but recall does not gate on it.
 *
 * Returns [] on any error (caller falls back to JSONL). Never throws.
 */
export function queryIndex(
  paiDir: string,
  queryEmbedding: number[],
  query: string,
  topK = 3,
  threshold = 0.45,
): ScoredChunk[] {
  const db = dbPath(paiDir);
  if (!existsSync(db)) return [];
  let handle: Database | null = null;
  try {
    handle = new Database(db, { readonly: true });
    const rows = handle.query('SELECT path, text, emb FROM chunks').all() as { path: string; text: string; emb: Buffer }[];
    return rows
      .map((r) => ({ path: r.path, text: r.text, score: cosineSimilarity(queryEmbedding, Array.from(blobToEmb(r.emb))) }))
      .filter((s) => s.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  } catch {
    return [];
  } finally {
    try { handle?.close(); } catch {}
  }
}

/** Ensure a fresh derived index exists if the JSONL is present; returns true if a usable .db exists. */
export function ensureIndex(paiDir: string): boolean {
  try {
    if (isStale(paiDir)) buildIndex(paiDir);
    return existsSync(dbPath(paiDir));
  } catch {
    return false;
  }
}
