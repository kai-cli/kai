#!/usr/bin/env bun
/**
 * state-cleanup.ts - Clean up old STATE files with TTL enforcement
 *
 * PURPOSE: Remove stale files from MEMORY/STATE/ older than 7 days.
 * Preserves files with .pinned extension or frontmatter pinned: true.
 *
 * USAGE:
 *   bun scripts/state-cleanup.ts [--dry-run]
 *   bun scripts/state-cleanup.ts --apply
 *
 * DESIGN:
 * - Default mode: dry-run (shows what would be deleted)
 * - Scans MEMORY/STATE/ recursively
 * - Checks file mtime (modification time)
 * - Preserves .pinned files and files with pinned: true frontmatter
 * - Logs summary to stdout
 *
 * EXIT CODES:
 *   0 - Success
 *   1 - Error (missing directory, permission issues)
 */

import { readFileSync, readdirSync, statSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { getPaiDir } from '../hooks/lib/paths';

const TTL_DAYS = 7;
const TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000;

interface CleanupResult {
  scanned: number;
  deleted: number;
  preserved: number;
  errors: number;
  deletedFiles: Array<{ path: string; ageMs: number }>;
  preservedReasons: Record<string, string>;
}

function isPinned(filePath: string): boolean {
  // Check extension
  if (filePath.endsWith('.pinned')) return true;

  // Check frontmatter for text files
  if (!filePath.match(/\.(md|json|jsonl|yaml|yml|txt)$/)) return false;

  try {
    const content = readFileSync(filePath, 'utf-8');
    const firstLines = content.split('\n').slice(0, 20).join('\n');

    // YAML frontmatter
    if (firstLines.match(/^---\s*\n[\s\S]*?pinned:\s*true/m)) return true;

    // JSON field
    if (firstLines.match(/"pinned":\s*true/)) return true;

    // JSONL first line
    if (content.split('\n')[0]?.includes('"pinned":true')) return true;
  } catch {
    // If we can't read it, don't assume it's pinned
  }

  return false;
}

function scanDirectory(dir: string, now: number, apply: boolean, result: CleanupResult): void {
  if (!existsSync(dir)) return;

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        scanDirectory(fullPath, now, apply, result);
        continue;
      }

      if (!entry.isFile()) continue;

      result.scanned++;

      try {
        const stats = statSync(fullPath);
        const age = now - stats.mtimeMs;

        // Check TTL
        if (age < TTL_MS) {
          result.preserved++;
          result.preservedReasons[fullPath] = 'age < TTL';
          continue;
        }

        // Check pinned
        if (isPinned(fullPath)) {
          result.preserved++;
          result.preservedReasons[fullPath] = 'pinned';
          continue;
        }

        // Delete
        result.deleted++;
        result.deletedFiles.push({ path: fullPath, ageMs: age });
        if (apply) {
          unlinkSync(fullPath);
        }
      } catch (err) {
        console.error(`Error processing ${fullPath}: ${err}`);
        result.errors++;
      }
    }
  } catch (err) {
    console.error(`Error scanning directory ${dir}: ${err}`);
    result.errors++;
  }
}

function formatAge(ms: number): string {
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days === 0) return 'today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const mode = apply ? 'APPLY' : 'DRY-RUN';

  console.log(`\n=== STATE Cleanup (${mode}) ===\n`);

  const paiDir = getPaiDir();
  const stateDir = join(paiDir, 'MEMORY', 'STATE');

  if (!existsSync(stateDir)) {
    console.error(`Error: STATE directory not found: ${stateDir}`);
    process.exit(1);
  }

  const now = Date.now();
  const result: CleanupResult = {
    scanned: 0,
    deleted: 0,
    preserved: 0,
    errors: 0,
    deletedFiles: [],
    preservedReasons: {},
  };

  scanDirectory(stateDir, now, apply, result);

  // Summary
  console.log(`Files scanned:   ${result.scanned}`);
  console.log(`Files deleted:   ${result.deleted}`);
  console.log(`Files preserved: ${result.preserved}`);
  console.log(`Errors:          ${result.errors}`);

  // Deleted files
  if (result.deletedFiles.length > 0) {
    console.log(`\n${apply ? 'Deleted' : 'Would delete'} files (older than ${TTL_DAYS} days):`);
    for (const { path, ageMs } of result.deletedFiles) {
      const rel = path.replace(stateDir + '/', '');
      console.log(`  ${rel} (${formatAge(ageMs)} old)`);
    }
  }

  // Preserved samples
  const pinnedCount = Object.values(result.preservedReasons).filter(r => r === 'pinned').length;
  const recentCount = result.preserved - pinnedCount;
  if (pinnedCount > 0) {
    console.log(`\nPreserved: ${pinnedCount} pinned file(s), ${recentCount} recent file(s)`);
  }

  if (!apply && result.deleted > 0) {
    console.log(`\nRun with --apply to actually delete files.`);
  }

  console.log('');
  process.exit(result.errors > 0 ? 1 : 0);
}

if (import.meta.main) {
  main();
}
