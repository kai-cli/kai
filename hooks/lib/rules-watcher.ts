/**
 * rules-watcher.ts — Mtime-based rules file change detection
 *
 * Checks CLAUDE.md and PAI steering rules for changes since the last prompt.
 * Uses a per-session mtime cache written to /tmp/pai-hooks/rules-mtime.json.
 *
 * Performance: ~1ms per file (stat syscall only — no file reads unless changed).
 * Design: no persistent watchers needed — one-shot hook compatible.
 */

import { statSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const PAI_DIR = process.env.PAI_DIR ?? join(homedir(), '.claude');
const MTIME_CACHE_PATH = '/tmp/pai-hooks/rules-mtime.json';

export const WATCHED_FILES = [
  join(PAI_DIR, 'CLAUDE.md'),
  join(PAI_DIR, 'PAI', 'AISTEERINGRULES.md'),
];

interface MtimeCache {
  [path: string]: number;
}

export function readMtimeCache(): MtimeCache {
  try {
    if (!existsSync(MTIME_CACHE_PATH)) return {};
    return JSON.parse(readFileSync(MTIME_CACHE_PATH, 'utf8')) as MtimeCache;
  } catch {
    return {};
  }
}

export function writeMtimeCache(cache: MtimeCache): void {
  try {
    mkdirSync('/tmp/pai-hooks', { recursive: true });
    writeFileSync(MTIME_CACHE_PATH, JSON.stringify(cache), 'utf8');
  } catch {
    // Non-fatal — mtime cache is best-effort
  }
}

export interface RulesChangeResult {
  changed: boolean;
  files: string[];
  summaries: string[];
}

function summarizeChange(filePath: string): string {
  try {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const name = filePath.split('/').pop() ?? filePath;
    // Return first non-empty heading or first line
    const heading = lines.find(l => l.startsWith('# ') || l.startsWith('## '));
    return `${name} updated (${lines.length} lines${heading ? ', ' + heading.trim() : ''})`;
  } catch {
    return filePath.split('/').pop() ?? filePath;
  }
}

/**
 * Check watched files for mtime changes. Returns changed files and their summaries.
 * Also checks for a project-level CLAUDE.md at process.cwd().
 */
export function checkRulesChanges(extraPaths: string[] = []): RulesChangeResult {
  const cache = readMtimeCache();
  const watchList = [...WATCHED_FILES, ...extraPaths];

  // Add project CLAUDE.md if cwd has one
  const projectClaude = join(process.cwd(), 'CLAUDE.md');
  if (existsSync(projectClaude) && !watchList.includes(projectClaude)) {
    watchList.push(projectClaude);
  }

  const changedFiles: string[] = [];
  const summaries: string[] = [];

  for (const file of watchList) {
    const stat = statSync(file, { throwIfNoEntry: false });
    if (!stat) continue;
    const currentMtime = stat.mtimeMs;
    const lastKnown = cache[file] ?? 0;

    if (currentMtime > lastKnown) {
      changedFiles.push(file);
      summaries.push(summarizeChange(file));
      cache[file] = currentMtime;
    }
  }

  if (changedFiles.length > 0) {
    writeMtimeCache(cache);
  }

  return {
    changed: changedFiles.length > 0,
    files: changedFiles,
    summaries,
  };
}
