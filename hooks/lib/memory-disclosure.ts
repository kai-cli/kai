/**
 * memory-disclosure.ts — 3-layer progressive disclosure for MEMORY.md
 *
 * Layer 1: INDEX (≤50 lines, always loaded)
 * Layer 2: TIMELINE (user-requested, timeline.jsonl)
 * Layer 3: DETAIL (on-demand, individual topic files)
 *
 * Eviction scoring: (days_since_last_access × -1) + (reference_count × 5)
 * P2→P3 aging: >30 days old AND reference_count = 0
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { encodeProjectDir } from './paths';

const MAX_INDEX_LINES = 50;

export interface MemoryMetaEntry {
  file: string;
  last_accessed: string;
  reference_count: number;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
}

type Priority = 'P0' | 'P1' | 'P2' | 'P3';

const PRIORITY_ORDER: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

function metaPath(paiDir: string): string {
  return join(paiDir, 'MEMORY', 'STATE', 'memory-meta.jsonl');
}

function timelinePath(paiDir: string): string {
  return join(paiDir, 'MEMORY', 'STATE', 'timeline.jsonl');
}

function currentProjectMemoryPath(paiDir: string, filename: string): string {
  const claudeProjectDir = process.env.CLAUDE_PROJECT_DIR || '';
  if (claudeProjectDir) {
    const encoded = encodeProjectDir(claudeProjectDir);
    const projectPath = join(paiDir, 'projects', encoded, 'memory', filename);
    if (existsSync(projectPath)) return projectPath;
  }
  return join(paiDir, filename);
}

export function loadMeta(paiDir: string): MemoryMetaEntry[] {
  const path = metaPath(paiDir);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, 'utf-8')
      .trim()
      .split('\n')
      .filter(l => l.trim())
      .map(l => JSON.parse(l) as MemoryMetaEntry);
  } catch {
    return [];
  }
}

export function saveMeta(paiDir: string, entries: MemoryMetaEntry[]): void {
  const path = metaPath(paiDir);
  mkdirSync(join(paiDir, 'MEMORY', 'STATE'), { recursive: true });
  writeFileSync(path, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
}

export function evictionScore(entry: MemoryMetaEntry): number {
  const daysSince = Math.floor(
    (Date.now() - new Date(entry.last_accessed).getTime()) / 86_400_000
  );
  return (daysSince * -1) + (entry.reference_count * 5);
}

/**
 * Apply P2→P3 aging: entries >30 days old with reference_count = 0 become P3.
 */
export function applyAging(entries: MemoryMetaEntry[]): MemoryMetaEntry[] {
  const now = Date.now();
  return entries.map(e => {
    if (e.priority !== 'P2') return e;
    const ageDays = (now - new Date(e.last_accessed).getTime()) / 86_400_000;
    if (ageDays > 30 && e.reference_count === 0) {
      return { ...e, priority: 'P3' as Priority };
    }
    return e;
  });
}

/**
 * Load index lines from MEMORY.md — returns at most MAX_INDEX_LINES lines.
 * Updates last_accessed in metadata for every surfaced entry.
 */
export function loadIndexMemory(paiDir: string): string {
  const mdPath = currentProjectMemoryPath(paiDir, 'MEMORY.md');
  if (!existsSync(mdPath)) return '';

  try {
    const lines = readFileSync(mdPath, 'utf-8').split('\n');
    const indexLines = lines.slice(0, MAX_INDEX_LINES);

    // Update last_accessed for all entries in this batch
    updateIndexAccess(paiDir, indexLines);

    return indexLines.join('\n');
  } catch {
    return '';
  }
}

/**
 * Load the latest promoted insight sections for the current project.
 *
 * These are consolidated lessons written by `pai curate promote`; they are not
 * guaranteed to fit in the first 50 lines of MEMORY.md, so they get a compact
 * recall path here.
 */
export function loadPromotedInsights(paiDir: string, maxSections = 3): string {
  const path = currentProjectMemoryPath(paiDir, 'insights_promoted.md');
  if (!existsSync(path)) return '';

  try {
    const content = readFileSync(path, 'utf-8');
    const sections = content
      .split(/\n(?=## )/)
      .filter(section => section.startsWith('## '))
      .slice(-maxSections)
      .map(section => section.trim());

    if (sections.length === 0) return '';
    return `## Promoted Insights (recent)\n\n${sections.join('\n\n')}`;
  } catch {
    return '';
  }
}

function updateIndexAccess(paiDir: string, indexLines: string[]): void {
  try {
    let entries = loadMeta(paiDir);
    const today = new Date().toISOString().split('T')[0];
    const entryFiles = new Set(entries.map(e => e.file));

    for (const line of indexLines) {
      const match = line.match(/\[.*?\]\((.+?\.md)\)/);
      if (!match) continue;
      const file = match[1];
      if (entryFiles.has(file)) {
        entries = entries.map(e =>
          e.file === file ? { ...e, last_accessed: today } : e
        );
      } else {
        // New entry not yet in meta — add with P2 defaults
        entries.push({
          file,
          last_accessed: today,
          reference_count: 0,
          priority: 'P2',
        });
        entryFiles.add(file);
      }
    }

    saveMeta(paiDir, entries);
  } catch { /* non-fatal */ }
}

/**
 * Record a detail-file read: increment reference_count + update last_accessed.
 */
export function recordDetailRead(paiDir: string, filePath: string): void {
  const relPath = filePath.replace(paiDir + '/', '');
  try {
    let entries = loadMeta(paiDir);
    const today = new Date().toISOString().split('T')[0];
    const idx = entries.findIndex(e => e.file === relPath || filePath.endsWith(e.file));
    if (idx >= 0) {
      entries[idx] = {
        ...entries[idx],
        last_accessed: today,
        reference_count: entries[idx].reference_count + 1,
      };
    } else {
      entries.push({ file: relPath, last_accessed: today, reference_count: 1, priority: 'P2' });
    }
    saveMeta(paiDir, entries);
  } catch { /* non-fatal */ }
}

/**
 * Prune index to MAX_INDEX_LINES by evicting lowest-scoring P3 entries.
 * Returns the new set of entries (does NOT modify MEMORY.md — that's user territory).
 * If no P3 entries exist and index is full, returns entries unchanged + logs warning.
 *
 * P0+P1 cap behavior: If P0+P1 entries alone exceed MAX_INDEX_LINES, this function
 * cannot evict any of them. The returned set will be over-cap and the caller receives
 * the warning "Index full, no P3 entries to evict — manual review needed".
 * In practice, hitting P0+P1 > 50 requires deliberate over-classification by the user.
 */
export function pruneIndex(entries: MemoryMetaEntry[]): { pruned: MemoryMetaEntry[]; evicted: MemoryMetaEntry[] } {
  if (entries.length <= MAX_INDEX_LINES) return { pruned: entries, evicted: [] };

  const aged = applyAging(entries);
  const p3 = aged.filter(e => e.priority === 'P3').sort((a, b) => evictionScore(a) - evictionScore(b));
  const overflow = entries.length - MAX_INDEX_LINES;

  if (p3.length === 0) {
    console.error('[memory-disclosure] Index full, no P3 entries to evict — manual review needed');
    return { pruned: aged, evicted: [] };
  }

  const toEvict = new Set(p3.slice(0, overflow).map(e => e.file));
  return {
    pruned: aged.filter(e => !toEvict.has(e.file)),
    evicted: aged.filter(e => toEvict.has(e.file)),
  };
}

/**
 * Initialize memory-meta.jsonl from existing MEMORY.md on first run.
 * Parses section headers for priority classification.
 * P0: under "## Active References", P1: under "## Feedback", P2: everything else.
 */
export function initializeMeta(paiDir: string, memoryMdContent: string): void {
  const today = new Date().toISOString().split('T')[0];
  const lines = memoryMdContent.split('\n');
  const entries: MemoryMetaEntry[] = [];
  let currentPriority: Priority = 'P2';

  for (const line of lines) {
    if (line.startsWith('## Active References')) { currentPriority = 'P0'; continue; }
    if (line.startsWith('## Feedback')) { currentPriority = 'P1'; continue; }
    if (line.startsWith('## ')) { currentPriority = 'P2'; continue; }

    const match = line.match(/\[.*?\]\((.+?\.md)\)/);
    if (match) {
      entries.push({
        file: match[1],
        last_accessed: today,
        reference_count: 0,
        priority: currentPriority,
      });
    }
  }

  saveMeta(paiDir, entries);
}

export const MAX_TIMELINE_ENTRIES = 500;

/**
 * Append an entry to timeline.jsonl, trimming head if over MAX_TIMELINE_ENTRIES.
 */
export function appendTimeline(paiDir: string, event: Record<string, unknown>): void {
  const path = timelinePath(paiDir);
  mkdirSync(join(paiDir, 'MEMORY', 'STATE'), { recursive: true });

  let existing: string[] = [];
  if (existsSync(path)) {
    existing = readFileSync(path, 'utf-8').trim().split('\n').filter(l => l.trim());
  }

  existing.push(JSON.stringify(event));

  if (existing.length > MAX_TIMELINE_ENTRIES) {
    existing = existing.slice(existing.length - MAX_TIMELINE_ENTRIES);
  }

  writeFileSync(path, existing.join('\n') + '\n');
}
