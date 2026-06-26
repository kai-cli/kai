#!/usr/bin/env bun
/**
 * repo-safety-ci.ts — server-side mirror of local repo safety guards.
 *
 * This is intentionally small and CI-oriented. Local pre-push remains the fast feedback path,
 * but these checks must also run in CI so `git push --no-verify` or missing local hooks cannot
 * bypass incident-class protections.
 *
 * Usage:
 *   bun scripts/repo-safety-ci.ts
 *   bun scripts/repo-safety-ci.ts --range origin/main..HEAD
 *   bun scripts/repo-safety-ci.ts --base origin/main --head HEAD
 */

import { execFileSync } from 'child_process';

const RED = '\x1b[0;31m';
const GREEN = '\x1b[0;32m';
const BLUE = '\x1b[0;34m';
const NC = '\x1b[0m';

function info(msg: string) { console.log(`  ${BLUE}→${NC} ${msg}`); }
function pass(msg: string) { console.log(`  ${GREEN}✓${NC} ${msg}`); }
function fail(msg: string) { console.log(`  ${RED}✗${NC} ${msg}`); }

const AUTHOR_ALLOWLIST = /@(kai-cli\.com|users\.noreply\.github\.com|anthropic\.com|openai\.com)$/i;
const DEFAULT_DELETE_THRESHOLD = 400;

const RUNTIME_PATH_PATTERNS: RegExp[] = [
  /^auto-memory\//,
  /^\.last-update-result\.json$/,
  /^MEMORY\/STATE\//,
  /^MEMORY\/STAGING\//,
  /^MEMORY\/SECURITY\//,
  /^daemon\//,
  /^projects\//,
  /^\.claude\//,
];

function git(args: string[], cwd = process.cwd()): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function gitMaybe(args: string[], cwd = process.cwd()): string {
  try {
    return git(args, cwd);
  } catch {
    return '';
  }
}

function argValue(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function changedRange(): string {
  const explicitRange = argValue('--range');
  if (explicitRange) return explicitRange;

  const baseArg = argValue('--base');
  const headArg = argValue('--head');
  if (baseArg || headArg) return `${baseArg || 'origin/main'}..${headArg || 'HEAD'}`;

  const baseRef = process.env.GITHUB_BASE_REF;
  if (baseRef) {
    const base = `origin/${baseRef}`;
    try {
      git(['rev-parse', '--verify', base]);
      return `${base}..HEAD`;
    } catch {
      return `HEAD^..HEAD`;
    }
  }

  try {
    git(['rev-parse', '--verify', 'origin/main']);
    return 'origin/main..HEAD';
  } catch {
    return 'HEAD^..HEAD';
  }
}

function splitLines(output: string): string[] {
  return output.split('\n').map((line) => line.trim()).filter(Boolean);
}

export function isAllowedAuthor(email: string): boolean {
  return AUTHOR_ALLOWLIST.test(email);
}

export function isRuntimePath(path: string): boolean {
  return RUNTIME_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

function changedFiles(range: string): string[] {
  const out = git(['diff', '--name-only', '--diff-filter=ACMR', range]);
  return splitLines(out);
}

function deletedFileCount(range: string): number {
  const out = git(['log', '--diff-filter=D', '--name-only', '--pretty=format:', range]);
  return new Set(splitLines(out)).size;
}

function authorEmails(range: string): string[] {
  return [...new Set(splitLines(git(['log', '--format=%ae', range])))];
}

function commitSubjects(range: string): string[] {
  return splitLines(git(['log', '--format=%s', range]));
}

function main() {
  const errors: string[] = [];
  const range = changedRange();
  const deleteThreshold = Number(process.env.PAI_DELETE_THRESHOLD || DEFAULT_DELETE_THRESHOLD);

  console.log('\n=== Repo Safety CI Gate ===');
  info(`Range: ${range}`);

  const bare = gitMaybe(['config', '--get', 'core.bare']).trim();
  if (bare === 'true') {
    console.log('\nRepo safety failures:');
    fail('core.bare=true on a working repo (config corruption)');
    console.log('');
    process.exit(1);
  }
  pass('core.bare is not true');

  const deleted = deletedFileCount(range);
  if (deleted > deleteThreshold) {
    errors.push(`range deletes ${deleted} files (> ${deleteThreshold}); possible repo-wipe/seed incident`);
  } else {
    pass(`large-delete guard passed (${deleted}/${deleteThreshold} deleted files)`);
  }

  const seedSubjects = commitSubjects(range).filter((subject) => /^seed$/i.test(subject));
  if (seedSubjects.length > 0) {
    errors.push('range contains a commit whose subject is exactly "seed"');
  } else {
    pass('no exact "seed" commit subject found');
  }

  const badAuthors = authorEmails(range).filter((email) => !isAllowedAuthor(email));
  if (badAuthors.length > 0) {
    errors.push(`non-allowlisted author email(s): ${badAuthors.join(', ')}`);
  } else {
    pass('author allowlist passed');
  }

  const runtimeFiles = changedFiles(range).filter(isRuntimePath);
  if (runtimeFiles.length > 0) {
    errors.push(`runtime/memory-generated files changed: ${runtimeFiles.slice(0, 20).join(', ')}${runtimeFiles.length > 20 ? ', ...' : ''}`);
  } else {
    pass('no runtime/generated memory files changed');
  }

  if (errors.length > 0) {
    console.log('\nRepo safety failures:');
    for (const error of errors) fail(error);
    console.log('');
    process.exit(1);
  }

  console.log('');
  pass('Repo safety CI gate passed');
}

if (import.meta.main) main();
