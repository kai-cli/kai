#!/usr/bin/env bun
/**
 * Compare a verified staged KAI artifact against the live KAI checkout after
 * apply. This catches partial copies and unexpected live-only drift while
 * ignoring repo/runtime surfaces that sync intentionally excludes.
 */

import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

export interface FidelityResult {
  ok: boolean;
  missing: string[];
  extra: string[];
  different: string[];
}

const DEFAULT_EXCLUDES = [
  '.git/',
  'node_modules/',
  '.DS_Store',
  'settings.json',
  'settings.json.backup*',
  'sessions/',
  'projects/',
  'file-history/',
  'debug/',
  'todos/',
  'tasks/',
  'session-env/',
  'shell-snapshots/',
  'paste-cache/',
  'chrome/',
  'history.jsonl',
  'telemetry/',
  'backups/',
  'cache/',
  'plugins/',
  'daemon/',
  '.last-update-result.json',
  'stats-cache.json',
  '.env',
  '.env.local',
  '.env.*.local',
];

function isExcluded(rel: string, excludes = DEFAULT_EXCLUDES): boolean {
  return excludes.some((pattern) => {
    if (pattern.endsWith('/')) {
      const dir = pattern.slice(0, -1);
      return rel === dir || rel.startsWith(`${dir}/`) || rel.endsWith(`/${dir}`) || rel.includes(`/${dir}/`);
    }
    if (pattern.endsWith('*')) return rel.startsWith(pattern.slice(0, -1));
    return rel === pattern || rel.startsWith(`${pattern}.`);
  });
}

function walk(root: string, rel = '', out: string[] = []): string[] {
  if (rel && isExcluded(rel)) return out;
  const full = join(root, rel);
  if (!existsSync(full)) return out;
  const stat = statSync(full);
  if (stat.isFile()) {
    out.push(rel);
    return out;
  }
  if (!stat.isDirectory()) return out;

  for (const entry of readdirSync(full)) {
    const next = rel ? `${rel}/${entry}` : entry;
    if (!isExcluded(next)) walk(root, next, out);
  }
  return out;
}

function hash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function compareKaiArtifacts(expectedDir: string, actualDir: string): FidelityResult {
  const expected = new Set(walk(expectedDir).sort());
  const actual = new Set(walk(actualDir).sort());
  const missing = [...expected].filter((file) => !actual.has(file));
  const extra = [...actual].filter((file) => !expected.has(file));
  const different: string[] = [];

  for (const file of expected) {
    if (!actual.has(file)) continue;
    if (hash(join(expectedDir, file)) !== hash(join(actualDir, file))) different.push(file);
  }

  return { ok: missing.length === 0 && extra.length === 0 && different.length === 0, missing, extra, different };
}

function usage(): never {
  console.error('Usage: bun scripts/kai-artifact-fidelity.ts --expected <stage-kai> --actual <live-kai>');
  process.exit(2);
}

function arg(name: string): string {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] ?? '' : '';
}

if (import.meta.main) {
  const expected = arg('--expected');
  const actual = arg('--actual');
  if (!expected || !actual) usage();
  const result = compareKaiArtifacts(expected, actual);

  if (result.ok) {
    console.log('KAI artifact fidelity passed');
    process.exit(0);
  }

  console.error('KAI artifact fidelity failed');
  for (const [label, files] of Object.entries({ missing: result.missing, extra: result.extra, different: result.different })) {
    if (files.length === 0) continue;
    console.error(`  ${label}: ${files.length}`);
    for (const file of files.slice(0, 20)) console.error(`    ${file}`);
    if (files.length > 20) console.error(`    ... and ${files.length - 20} more`);
  }
  process.exit(1);
}
