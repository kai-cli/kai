#!/usr/bin/env bun
// audit-memory.ts — Check memory files for stale references
// Scans all memory files for file paths that no longer exist on disk
// and orphaned MEMORY.md index entries (links to missing files).
// Usage: bun scripts/audit-memory.ts [--json]
// Called by: weekly-maintenance.ts, or manually via /audit-memory skill

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { Glob } from 'bun';

const HOME = process.env.HOME!;
const PROJECTS_MEMORY = join(HOME, '.claude/projects');
const JSON_MODE = process.argv.includes('--json');

interface StaleRef {
  memoryFile: string;
  referencedPath: string;
  lineNumber: number;
}

interface OrphanedEntry {
  indexFile: string;
  linkedFile: string;
}

function expandPath(p: string): string {
  return p.replace(/^~/, HOME);
}

function extractFilePaths(content: string): Array<{ path: string; line: number }> {
  const results: Array<{ path: string; line: number }> = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const matches = lines[i].matchAll(/(?:~\/[A-Za-z0-9_./-]+|\/Users\/[A-Za-z0-9_./-]+)/g);
    for (const m of matches) {
      const path = m[0];
      if (path.includes('*') || path.includes('{') || path.includes('...')) continue;
      if (path.match(/https?:\/\//)) continue;
      // Strip trailing punctuation
      const cleaned = path.replace(/[.,;:)}\]]+$/, '');
      if (cleaned.length > 5) {
        results.push({ path: cleaned, line: i + 1 });
      }
    }
  }
  return results;
}

function checkIndexIntegrity(indexPath: string): OrphanedEntry[] {
  const orphans: OrphanedEntry[] = [];
  const content = readFileSync(indexPath, 'utf-8');
  const dir = dirname(indexPath);

  const linkMatches = content.matchAll(/\(([a-zA-Z0-9_.-]+\.md)\)/g);
  for (const m of linkMatches) {
    const linked = m[1];
    if (linked === 'MEMORY.md') continue;
    if (!existsSync(join(dir, linked))) {
      orphans.push({ indexFile: indexPath, linkedFile: linked });
    }
  }
  return orphans;
}

async function main() {
  const staleRefs: StaleRef[] = [];
  const orphanedEntries: OrphanedEntry[] = [];
  let totalFiles = 0;
  let totalRefs = 0;
  let healthyRefs = 0;

  // Find all memory files
  const memoryDirs: string[] = [];
  try {
    const projectDirs = readdirSync(PROJECTS_MEMORY);
    for (const pd of projectDirs) {
      const memDir = join(PROJECTS_MEMORY, pd, 'memory');
      if (existsSync(memDir)) memoryDirs.push(memDir);
    }
  } catch { /* no projects dir */ }

  for (const memDir of memoryDirs) {
    const files = readdirSync(memDir).filter(f => f.endsWith('.md') && !f.startsWith('.'));

    for (const file of files) {
      const filePath = join(memDir, file);
      totalFiles++;

      // Check index integrity for MEMORY.md files
      if (file === 'MEMORY.md') {
        orphanedEntries.push(...checkIndexIntegrity(filePath));
      }

      // Skip archived content
      if (filePath.includes('.archive')) continue;

      const content = readFileSync(filePath, 'utf-8');
      const refs = extractFilePaths(content);

      for (const ref of refs) {
        totalRefs++;
        const expanded = expandPath(ref.path);
        if (!existsSync(expanded)) {
          staleRefs.push({
            memoryFile: filePath.replace(PROJECTS_MEMORY + '/', ''),
            referencedPath: ref.path,
            lineNumber: ref.line,
          });
        } else {
          healthyRefs++;
        }
      }
    }
  }

  if (JSON_MODE) {
    console.log(JSON.stringify({
      totalFiles,
      totalRefs,
      healthyRefs,
      staleRefs: staleRefs.length,
      orphanedEntries: orphanedEntries.length,
      stale: staleRefs,
      orphans: orphanedEntries,
    }, null, 2));
  } else {
    const staleCount = staleRefs.length;
    const status = staleCount === 0 ? 'CLEAN' : staleCount < 5 ? 'MINOR' : 'NEEDS ATTENTION';
    console.log(`Memory audit: ${totalFiles} files, ${totalRefs} refs checked, ${staleCount} stale, ${orphanedEntries.length} orphans [${status}]`);
    if (staleRefs.length > 0) {
      console.log('  Stale:');
      for (const s of staleRefs.slice(0, 10)) {
        console.log(`    ${s.memoryFile}:${s.lineNumber} → ${s.referencedPath}`);
      }
      if (staleRefs.length > 10) console.log(`    ... and ${staleRefs.length - 10} more`);
    }
    if (orphanedEntries.length > 0) {
      console.log('  Orphans:');
      for (const o of orphanedEntries) {
        console.log(`    ${o.indexFile.replace(PROJECTS_MEMORY + '/', '')} → ${o.linkedFile}`);
      }
    }
  }

  process.exit(staleRefs.length > 10 ? 1 : 0);
}

main();
