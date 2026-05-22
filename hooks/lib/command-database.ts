/**
 * command-database.ts — PATH binary scanner with session-scoped cache
 *
 * Scans PATH directories to build a set of known shell commands.
 * Cache is written to /tmp/pai-hooks/path-cache.json and is session-scoped
 * (lives as long as /tmp, no explicit TTL needed).
 */

import { existsSync, readdirSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const CACHE_PATH = '/tmp/pai-hooks/path-cache.json';

interface PathCache {
  commands: string[];
  scanTime: number;
}

let _cache: Set<string> | null = null;

function buildCommandSet(): Set<string> {
  const pathEnv = process.env.PATH ?? '';
  const dirs = pathEnv.split(':').filter(Boolean);
  const commands = new Set<string>();

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        commands.add(entry);
      }
    } catch {
      // Skip unreadable directories
    }
  }

  return commands;
}

function loadCache(): Set<string> | null {
  if (!existsSync(CACHE_PATH)) return null;
  try {
    const raw = readFileSync(CACHE_PATH, 'utf8');
    const parsed: PathCache = JSON.parse(raw);
    if (!Array.isArray(parsed.commands)) return null;
    return new Set(parsed.commands);
  } catch {
    return null;
  }
}

function saveCache(commands: Set<string>): void {
  try {
    const dir = '/tmp/pai-hooks';
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const payload: PathCache = { commands: Array.from(commands), scanTime: Date.now() };
    writeFileSync(CACHE_PATH, JSON.stringify(payload));
  } catch {
    // Cache save failure is non-fatal
  }
}

/** Returns the set of known shell binaries from PATH (cached). */
export function getKnownCommands(): Set<string> {
  if (_cache) return _cache;

  const fromDisk = loadCache();
  if (fromDisk) {
    _cache = fromDisk;
    return _cache;
  }

  const built = buildCommandSet();
  saveCache(built);
  _cache = built;
  return _cache;
}

/** Returns true if `token` is a known binary in PATH. */
export function isKnownCommand(token: string): boolean {
  return getKnownCommands().has(token);
}

/** Clears in-memory cache (used in tests). */
export function clearCommandCache(): void {
  _cache = null;
}
