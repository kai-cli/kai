#!/usr/bin/env bun
/**
 * ReadTracker.hook.ts — Track PAI-internal file reads for routing candidates
 *
 * PURPOSE:
 * Logs every Read tool call that targets a file inside PAI_DIR to
 * MEMORY/STATE/read-log.jsonl. After several sessions, RoutingCandidates.ts
 * surfaces frequently-read files that have no routing entry — routing proposals.
 *
 * TRIGGER: PostToolUse:Read (async)
 *
 * INPUT: stdin hook JSON (tool_name, tool_input.file_path, session_id)
 * OUTPUT: none (async, no stdout)
 *
 * SIDE EFFECTS:
 * - Appends to MEMORY/STATE/read-log.jsonl (one JSON line per unique path per session)
 * - Trims entries older than LOG_RETENTION_DAYS on each write
 * - Caps file at LOG_MAX_BYTES; drops oldest 25% if exceeded
 *
 * DESIGN:
 * - Deduplicates within a session (same path multiple times = 1 entry)
 * - Skips paths outside PAI_DIR (external files, project files, etc.)
 * - Never blocks — any error exits silently with code 0
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync, statSync } from 'fs';
import { join } from 'path';
import { getPaiDir, paiPath } from './lib/paths';

const LOG_RETENTION_DAYS = 90;
const LOG_MAX_BYTES = 1024 * 1024; // 1MB
const LOG_FILE = paiPath('MEMORY', 'STATE', 'read-log.jsonl');
const SESSION_CACHE_FILE = paiPath('MEMORY', 'STATE', 'read-tracker-session.json');

interface ReadLogEntry {
  timestamp: string;
  session_id: string;
  path: string;
  project_dir: string;
}

interface HookInput {
  session_id?: string;
  tool_name?: string;
  tool_input?: { file_path?: string };
}

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

    // Drop entries older than retention window
    const kept = lines.filter(line => {
      try {
        const entry = JSON.parse(line) as ReadLogEntry;
        return new Date(entry.timestamp).getTime() >= cutoff;
      } catch { return false; }
    });

    // If still over size cap, drop oldest 25%
    const joined = kept.join('\n') + '\n';
    if (Buffer.byteLength(joined) > LOG_MAX_BYTES) {
      const dropCount = Math.ceil(kept.length * 0.25);
      const trimmed = kept.slice(dropCount).join('\n') + '\n';
      writeFileSync(LOG_FILE, trimmed);
    } else if (kept.length < lines.length) {
      writeFileSync(LOG_FILE, joined);
    }
  } catch { /* non-fatal */ }
}

function ensureLogDir(): void {
  try {
    mkdirSync(join(LOG_FILE, '..'), { recursive: true });
  } catch { /* non-fatal */ }
}

async function main(): Promise<void> {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf-8').trim();
    if (!raw) process.exit(0);

    const input: HookInput = JSON.parse(raw);
    const sessionId = input.session_id ?? '';
    const filePath = input.tool_input?.file_path ?? '';

    if (!sessionId || !filePath) process.exit(0);

    const paiDir = getPaiDir();

    // Only track reads of files inside PAI_DIR
    if (!filePath.startsWith(paiDir)) process.exit(0);

    // Skip MEMORY/ internals — tracking those creates noise, not routing signals
    const relPath = filePath.slice(paiDir.length + 1);
    if (relPath.startsWith('MEMORY/') || relPath.startsWith('sessions/') || relPath.startsWith('projects/')) {
      process.exit(0);
    }

    // Deduplicate within session
    const sessionPaths = readSessionCache();
    if (sessionPaths.has(filePath)) process.exit(0);

    sessionPaths.add(filePath);
    writeSessionCache(sessionId, sessionPaths);

    // Append entry to log
    ensureLogDir();
    trimLog();

    const entry: ReadLogEntry = {
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      path: relPath,
      project_dir: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
    };

    appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
    process.exit(0);
  } catch {
    process.exit(0);
  }
}

if (import.meta.main) { main(); }
