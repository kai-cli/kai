#!/usr/bin/env bun
/**
 * ReadActivity.hook.ts — Unified PostToolUse:Read tracker (W5a merge).
 *
 * Replaces two hooks that each parsed the same Read payload independently:
 *   - ReadTracker          → MEMORY/STATE/read-log.jsonl (routing-candidate signal; PAI-internal, non-MEMORY reads)
 *   - MemoryAccessTracker  → memory-meta.jsonl reference_count (eviction scoring; MEMORY/*.md reads)
 *
 * The two are complementary by path (routing signal explicitly SKIPS MEMORY/; eviction signal is ONLY
 * MEMORY/*.md), so one hook reads stdin once and dispatches to the correct ledger. Behavior of each
 * branch is preserved byte-for-byte from the originals.
 *
 * TRIGGER: PostToolUse:Read (async). Never blocks — any error exits 0.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { getPaiDir, paiPath } from './lib/paths';
import { recordDetailRead } from './lib/memory-disclosure';

// ── Routing-signal ledger (from ReadTracker) ────────────────────────────────
const LOG_RETENTION_DAYS = 90;
const LOG_MAX_BYTES = 1024 * 1024; // 1MB
const LOG_FILE = paiPath('MEMORY', 'STATE', 'read-log.jsonl');
const SESSION_CACHE_FILE = paiPath('MEMORY', 'STATE', 'read-tracker-session.json');

interface ReadLogEntry { timestamp: string; session_id: string; path: string; project_dir: string; }
interface HookInput { session_id?: string; tool_name?: string; tool_input?: { file_path?: string }; }

function readSessionCache(): Set<string> {
  try {
    const raw = JSON.parse(readFileSync(SESSION_CACHE_FILE, 'utf-8'));
    return new Set(Array.isArray(raw.paths) ? raw.paths : []);
  } catch {
    return new Set();
  }
}

function writeSessionCache(sessionId: string, paths: Set<string>): void {
  try {
    mkdirSync(join(LOG_FILE, '..'), { recursive: true });
    writeFileSync(SESSION_CACHE_FILE, JSON.stringify({
      session_id: sessionId,
      paths: Array.from(paths),
      updated: new Date().toISOString(),
    }));
  } catch { /* non-fatal */ }
}

function trimLog(): void {
  if (!existsSync(LOG_FILE)) return;
  try {
    const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const lines = readFileSync(LOG_FILE, 'utf-8').split('\n').filter(l => l.trim());
    const kept = lines.filter(line => {
      try {
        const entry = JSON.parse(line) as ReadLogEntry;
        return new Date(entry.timestamp).getTime() >= cutoff;
      } catch { return false; }
    });
    const joined = kept.join('\n') + '\n';
    if (Buffer.byteLength(joined) > LOG_MAX_BYTES) {
      const dropCount = Math.ceil(kept.length * 0.25);
      writeFileSync(LOG_FILE, kept.slice(dropCount).join('\n') + '\n');
    } else if (kept.length < lines.length) {
      writeFileSync(LOG_FILE, joined);
    }
  } catch { /* non-fatal */ }
}

/** Routing-signal branch: PAI-internal reads OUTSIDE MEMORY/ → read-log.jsonl (dedup per session). */
function trackRoutingRead(input: HookInput, filePath: string, paiDir: string): void {
  const sessionId = input.session_id ?? '';
  if (!sessionId) return;
  if (!isRoutingRead(filePath, paiDir)) return;
  const relPath = filePath.slice(paiDir.length + 1);

  const sessionPaths = readSessionCache();
  if (sessionPaths.has(filePath)) return;
  sessionPaths.add(filePath);
  writeSessionCache(sessionId, sessionPaths);

  try { mkdirSync(join(LOG_FILE, '..'), { recursive: true }); } catch { /* non-fatal */ }
  trimLog();
  const entry: ReadLogEntry = {
    timestamp: new Date().toISOString(),
    session_id: sessionId,
    path: relPath,
    project_dir: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
  };
  appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
}

/** Eviction-signal branch: MEMORY/*.md detail reads → reference_count in memory-meta.jsonl. */
export function trackMemoryRead(filePath: string, paiDir: string): void {
  if (!isMemoryRead(filePath)) return;
  recordDetailRead(paiDir, filePath);
}

/**
 * Pure dispatch predicate (exported for tests): does this path feed the routing-signal ledger?
 * Routing tracks PAI-internal NON-memory/session/project reads under paiDir. Mirrors trackRoutingRead's gate.
 */
export function isRoutingRead(filePath: string, paiDir: string): boolean {
  if (!filePath.startsWith(paiDir)) return false;
  const relPath = filePath.slice(paiDir.length + 1);
  if (relPath.startsWith('MEMORY/') || relPath.startsWith('sessions/') || relPath.startsWith('projects/')) return false;
  return true;
}

/** Pure dispatch predicate (exported for tests): does this path feed the memory eviction signal? */
export function isMemoryRead(filePath: string): boolean {
  return (filePath.includes('/memory/') || filePath.includes('/MEMORY/')) && filePath.endsWith('.md');
}

async function main(): Promise<void> {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf-8').trim();
    if (!raw) process.exit(0);

    const input: HookInput = JSON.parse(raw);
    const filePath = input.tool_input?.file_path ?? '';
    if (!filePath) process.exit(0);

    const paiDir = getPaiDir();

    // Dispatch to both ledgers (branches are path-disjoint — each no-ops for the other's paths).
    try { trackMemoryRead(filePath, paiDir); } catch { /* non-fatal */ }
    try { trackRoutingRead(input, filePath, paiDir); } catch { /* non-fatal */ }

    process.exit(0);
  } catch {
    process.exit(0);
  }
}

if (import.meta.main) { main(); }
