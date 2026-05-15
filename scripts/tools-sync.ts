#!/usr/bin/env bun
/**
 * tools-sync.ts — Scan project CLAUDE.md files for tool/service declarations
 * and report anything not yet in the global TOOLS.md registry.
 *
 * Usage:
 *   bun scripts/tools-sync.ts          # dry-run: show what's new
 *   bun scripts/tools-sync.ts --apply  # append new items to TOOLS.md
 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'fs';
import { join, basename } from 'path';

const PAI_DIR = process.env.PAI_DIR || join(process.env.HOME!, '.claude');
const PROJECTS_DIR = process.env.PROJECTS_DIR || join(process.env.HOME!, 'Projects');
const TOOLS_PATH = join(PAI_DIR, 'TOOLS.md');
const APPLY = process.argv.includes('--apply');

const SECTION_HEADER = /^##\s*Tools\s*[&+]\s*(Access|Services)/i;
const SECTION_END = /^##\s/;

function findProjectClaudeMds(): { project: string; path: string }[] {
  const results: { project: string; path: string }[] = [];

  if (!existsSync(PROJECTS_DIR)) return results;

  for (const entry of readdirSync(PROJECTS_DIR)) {
    if (entry.startsWith('.') || entry.startsWith('_')) continue;
    const projectDir = join(PROJECTS_DIR, entry);
    if (!statSync(projectDir).isDirectory()) continue;

    // Check root CLAUDE.md
    const rootMd = join(projectDir, 'CLAUDE.md');
    if (existsSync(rootMd)) {
      results.push({ project: entry, path: rootMd });
    }
    // Check .claude/CLAUDE.md
    const dotClaudeMd = join(projectDir, '.claude', 'CLAUDE.md');
    if (existsSync(dotClaudeMd)) {
      results.push({ project: entry, path: dotClaudeMd });
    }
  }
  return results;
}

function extractToolsSection(filePath: string): string[] {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const extracted: string[] = [];
  let inSection = false;

  for (const line of lines) {
    if (SECTION_HEADER.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && SECTION_END.test(line)) {
      break;
    }
    if (inSection && line.trim()) {
      extracted.push(line);
    }
  }
  return extracted;
}

function loadExistingTools(): string {
  if (!existsSync(TOOLS_PATH)) return '';
  return readFileSync(TOOLS_PATH, 'utf-8');
}

function isAlreadyListed(toolsContent: string, item: string): boolean {
  // Normalize: strip markdown formatting for comparison
  const normalized = item.replace(/[*_`|]/g, '').toLowerCase().trim();
  // Check if any meaningful keyword from the item is in TOOLS.md
  const keywords = normalized.split(/[\s—\-:,]+/).filter(w => w.length > 3);
  // If 2+ keywords appear on the same line, consider it already listed
  const toolsLines = toolsContent.toLowerCase().split('\n');
  for (const toolLine of toolsLines) {
    const matches = keywords.filter(k => toolLine.includes(k));
    if (matches.length >= 2) return true;
  }
  return false;
}

// Main
const claudeMds = findProjectClaudeMds();
const existingTools = loadExistingTools();
const newItems: { project: string; items: string[] }[] = [];

for (const { project, path } of claudeMds) {
  const items = extractToolsSection(path);
  if (items.length === 0) continue;

  const novel = items.filter(item => !isAlreadyListed(existingTools, item));
  if (novel.length > 0) {
    newItems.push({ project, items: novel });
  }
}

if (newItems.length === 0) {
  console.log('✅ TOOLS.md is up to date. No new items found across projects.');
  process.exit(0);
}

console.log(`\n📋 Found new tools/services in ${newItems.length} project(s):\n`);

let appendBlock = '\n\n## Project-Specific (auto-collected)\n\n';

for (const { project, items } of newItems) {
  console.log(`  ${project}:`);
  appendBlock += `### ${project}\n`;
  for (const item of items) {
    console.log(`    ${item}`);
    appendBlock += `${item}\n`;
  }
  appendBlock += '\n';
  console.log('');
}

if (APPLY) {
  const current = readFileSync(TOOLS_PATH, 'utf-8');
  // Remove old auto-collected section if present
  const autoHeader = '## Project-Specific (auto-collected)';
  const cleanedContent = current.includes(autoHeader)
    ? current.slice(0, current.indexOf(autoHeader)).trimEnd()
    : current.trimEnd();

  writeFileSync(TOOLS_PATH, cleanedContent + appendBlock);
  console.log(`✅ Appended to ${TOOLS_PATH}`);
} else {
  console.log('Run with --apply to append these to TOOLS.md');
}
