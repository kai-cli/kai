#!/usr/bin/env bun
/**
 * CrossProjectIndex.ts — Generate keyword→project index for cross-project memory recall
 *
 * Scans all project memory MEMORY.md files, extracts keywords per entry,
 * and builds a compact lookup: keyword → [project-slug, ...].
 *
 * Output: ~/.claude/MEMORY/STATE/cross-project-index.json
 *
 * Usage:
 *   bun PAI/Tools/CrossProjectIndex.ts          # Generate/refresh index
 *   bun PAI/Tools/CrossProjectIndex.ts --dry    # Show what would be generated
 *
 * Designed to run periodically (e.g., after session end) or on-demand.
 * Fast: no LLM, no network — just file reads and regex.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join, basename } from 'path';

const HOME = process.env.HOME || '/tmp';
const PROJECTS_BASE = join(HOME, '.claude', 'projects');
const OUTPUT_PATH = join(HOME, '.claude', 'MEMORY', 'STATE', 'cross-project-index.json');

interface IndexEntry {
  projects: string[];
  entries: string[];  // entry titles for context
}

type CrossProjectIndex = Record<string, IndexEntry>;

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'must', 'ought',
  'for', 'and', 'nor', 'but', 'or', 'yet', 'so', 'in', 'on', 'at',
  'to', 'from', 'by', 'with', 'about', 'against', 'between', 'through',
  'during', 'before', 'after', 'above', 'below', 'up', 'down', 'out',
  'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here',
  'there', 'when', 'where', 'why', 'how', 'all', 'each', 'every',
  'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'not',
  'only', 'own', 'same', 'than', 'too', 'very', 'just', 'because',
  'as', 'until', 'while', 'of', 'if', 'that', 'this', 'it', 'its',
  'use', 'check', 'always', 'never', 'don', 'what', 'which',
  'into', 'our', 'your', 'their', 'his', 'her', 'ran', 'got',
  'went', 'came', 'let', 'get', 'put', 'run', 'say', 'also',
  'like', 'know', 'think', 'want', 'look', 'make', 'going',
  // Domain-generic terms that would match everything
  'project', 'memory', 'file', 'code', 'fix', 'bug', 'issue',
  'update', 'add', 'change', 'new', 'old', 'set', 'config',
]);

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !STOP_WORDS.has(w));
}

function projectSlug(dirName: string): string {
  // -Users-your.name-Projects-feed-bbf → feed-bbf
  const parts = dirName.split('-Projects-');
  if (parts.length > 1) return parts[1];
  // Fallback: last meaningful segment
  const segments = dirName.split('-').filter(s => s.length > 0);
  return segments.slice(-2).join('-');
}

function parseMemoryEntries(content: string): Array<{ title: string; keywords: string[] }> {
  const entries: Array<{ title: string; keywords: string[] }> = [];

  for (const line of content.split('\n')) {
    const match = line.match(/^-\s+\[(.+?)\]\(.+?\)\s*[-—–]\s*(.+)/);
    if (match) {
      const [, title, description] = match;
      const keywords = extractKeywords(`${title} ${description}`);
      if (keywords.length > 0) {
        entries.push({ title, keywords: [...new Set(keywords)] });
      }
    }
  }

  return entries;
}

function buildIndex(): CrossProjectIndex {
  const index: CrossProjectIndex = {};

  if (!existsSync(PROJECTS_BASE)) {
    console.error('No projects directory found');
    return index;
  }

  const dirs = readdirSync(PROJECTS_BASE, { withFileTypes: true })
    .filter(d => d.isDirectory());

  let projectCount = 0;
  let entryCount = 0;

  for (const dir of dirs) {
    const memoryPath = join(PROJECTS_BASE, dir.name, 'memory', 'MEMORY.md');
    if (!existsSync(memoryPath)) continue;

    let content: string;
    try {
      content = readFileSync(memoryPath, 'utf-8');
    } catch { continue; }

    const slug = projectSlug(dir.name);
    const entries = parseMemoryEntries(content);
    if (entries.length === 0) continue;

    projectCount++;
    entryCount += entries.length;

    for (const entry of entries) {
      for (const kw of entry.keywords) {
        if (!index[kw]) {
          index[kw] = { projects: [], entries: [] };
        }
        if (!index[kw].projects.includes(slug)) {
          index[kw].projects.push(slug);
        }
        if (!index[kw].entries.includes(entry.title) && index[kw].entries.length < 3) {
          index[kw].entries.push(entry.title);
        }
      }
    }
  }

  // Prune: remove keywords that only appear in one project (no cross-project value)
  // or that appear in too many projects (not discriminating)
  const pruned: CrossProjectIndex = {};
  for (const [kw, data] of Object.entries(index)) {
    if (data.projects.length >= 2 && data.projects.length <= 8) {
      pruned[kw] = data;
    }
  }

  console.error(`Scanned ${projectCount} projects, ${entryCount} entries`);
  console.error(`Index: ${Object.keys(index).length} keywords → ${Object.keys(pruned).length} cross-project (pruned single-project and ubiquitous)`);

  return pruned;
}

function main() {
  const isDry = process.argv.includes('--dry');
  const index = buildIndex();

  if (isDry) {
    console.log(JSON.stringify(index, null, 2));
    return;
  }

  // Ensure output directory exists
  const stateDir = join(HOME, '.claude', 'MEMORY', 'STATE');
  mkdirSync(stateDir, { recursive: true });

  const output = {
    generated: new Date().toISOString(),
    keyword_count: Object.keys(index).length,
    index,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Written: ${OUTPUT_PATH}`);
  console.log(`Keywords: ${Object.keys(index).length}`);

  // Show top keywords by project coverage
  const sorted = Object.entries(index)
    .sort((a, b) => b[1].projects.length - a[1].projects.length)
    .slice(0, 15);

  console.log('\nTop cross-project keywords:');
  for (const [kw, data] of sorted) {
    console.log(`  ${kw}: ${data.projects.join(', ')}`);
  }
}

main();
