/**
 * WikiCurrency.unit.test.ts — proves the wiki-currency detector fires on the case that slipped past
 * it (committed-but-unpushed code with no wiki update) AND stays quiet when the wiki was updated.
 *
 * Uses real temp git repos with a local "upstream" so @{u}..HEAD resolves — that's the exact mechanism
 * the hardening adds, so the test must exercise real git, not mock it.
 */
import { test, expect, beforeEach, afterEach } from 'bun:test';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { analyzeRepo, MEANINGFUL_LINES, type WikiProject } from '../hooks/handlers/WikiCurrency';

let work: string;
function g(repo: string, ...args: string[]) {
  execFileSync('git', ['-C', repo, ...args], { stdio: ['ignore', 'pipe', 'ignore'] });
}

/** Make a repo with a local bare upstream so `@{u}` resolves (mirrors a real cloned repo). */
function makeRepoWithUpstream(name: string): string {
  const bare = join(work, `${name}.git`);
  const repo = join(work, name);
  execFileSync('git', ['init', '--bare', '-b', 'main', bare], { stdio: 'ignore' });
  execFileSync('git', ['clone', bare, repo], { stdio: 'ignore' });
  g(repo, 'config', 'user.email', 't@t.t');
  g(repo, 'config', 'user.name', 'T');
  // seed an initial commit and push so @{u} exists
  writeFileSync(join(repo, 'README.md'), '# seed\n');
  g(repo, 'add', '.');
  g(repo, 'commit', '-m', 'seed');
  g(repo, 'push', 'origin', 'main');
  return repo;
}

function bigCode(lines: number): string {
  return Array.from({ length: lines }, (_, i) => `const x${i} = ${i};`).join('\n') + '\n';
}

beforeEach(() => { work = mkdtempSync(join(tmpdir(), 'wikicur-')); });
afterEach(() => { try { rmSync(work, { recursive: true, force: true }); } catch {} });

test('ISC-9: COMMITTED-unpushed code with no wiki → flagged (the case that was missed)', () => {
  const repo = makeRepoWithUpstream('proj');
  writeFileSync(join(repo, 'feature.ts'), bigCode(MEANINGFUL_LINES + 30));
  g(repo, 'add', '.');
  g(repo, 'commit', '-m', 'feat: big committed change, no wiki'); // committed, NOT pushed; clean tree

  const p: WikiProject = { repo, name: 'proj' };
  const stats = analyzeRepo(p);
  expect(stats).not.toBeNull();
  expect(stats!.codeLines).toBeGreaterThanOrEqual(MEANINGFUL_LINES);
  expect(stats!.wikiTouched).toBe(false); // → handler would flag
});

test('ISC-10: committed code + committed wiki (sibling) → silent', () => {
  const repo = makeRepoWithUpstream('proj2');
  const wiki = makeRepoWithUpstream('proj2-wiki');
  writeFileSync(join(repo, 'feature.ts'), bigCode(MEANINGFUL_LINES + 30));
  g(repo, 'add', '.'); g(repo, 'commit', '-m', 'feat');
  // wiki updated AND committed-unpushed (not just uncommitted)
  writeFileSync(join(wiki, 'page.md'), '# documented\n');
  g(wiki, 'add', '.'); g(wiki, 'commit', '-m', 'docs');

  const p: WikiProject = { repo, name: 'proj2', wikiRepo: wiki };
  const stats = analyzeRepo(p);
  expect(stats!.codeLines).toBeGreaterThanOrEqual(MEANINGFUL_LINES);
  expect(stats!.wikiTouched).toBe(true); // committed wiki counts → no flag
});

test('ISC-2: uncommitted code still detected (regression)', () => {
  const repo = makeRepoWithUpstream('proj3');
  writeFileSync(join(repo, 'wip.ts'), bigCode(MEANINGFUL_LINES + 10)); // untracked, uncommitted
  const stats = analyzeRepo({ repo, name: 'proj3' });
  expect(stats!.codeLines).toBeGreaterThanOrEqual(MEANINGFUL_LINES);
  expect(stats!.wikiTouched).toBe(false);
});

test('ISC-3: a file changed both committed AND uncommitted is counted once', () => {
  const repo = makeRepoWithUpstream('proj4');
  writeFileSync(join(repo, 'f.ts'), bigCode(MEANINGFUL_LINES + 5));
  g(repo, 'add', '.'); g(repo, 'commit', '-m', 'c1');           // committed-unpushed
  writeFileSync(join(repo, 'f.ts'), bigCode(MEANINGFUL_LINES + 5) + 'const extra = 1;\n'); // also uncommitted
  const stats = analyzeRepo({ repo, name: 'proj4' });
  // f.ts must appear exactly once in codeFiles despite being in both ranges
  expect(stats!.codeFiles.filter(f => f === 'f.ts').length).toBe(1);
});

test('ISC-6: no upstream → graceful fallback to uncommitted-only (no throw)', () => {
  const repo = join(work, 'noupstream');
  execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
  g(repo, 'config', 'user.email', 't@t.t'); g(repo, 'config', 'user.name', 'T');
  writeFileSync(join(repo, 'a.ts'), bigCode(MEANINGFUL_LINES + 5)); // uncommitted, no @{u}
  const stats = analyzeRepo({ repo, name: 'noup' });
  expect(stats).not.toBeNull();
  expect(stats!.codeLines).toBeGreaterThanOrEqual(MEANINGFUL_LINES); // uncommitted path still works
});

test('ISC-7/A2: non-git dir → null (no throw); tiny edit → below threshold', () => {
  const notRepo = join(work, 'plain');
  mkdirSync(notRepo);
  expect(analyzeRepo({ repo: notRepo, name: 'plain' })).toBeNull();

  const repo = makeRepoWithUpstream('proj5');
  writeFileSync(join(repo, 'tiny.ts'), 'const x = 1;\n'); // 1 line, < MEANINGFUL_LINES
  const stats = analyzeRepo({ repo, name: 'proj5' });
  expect(stats!.codeLines).toBeLessThan(MEANINGFUL_LINES);
});
