/**
 * RepoSafetyCIGate.test.ts — CI mirror for local pre-push incident guards.
 *
 * These tests use real temp Git repos so the CI gate proves it actually fails on
 * bad ranges, not just that strings exist in a workflow.
 */
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { isAllowedAuthor, isRuntimePath } from '../scripts/repo-safety-ci';

const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const SCRIPT = join(REPO, 'scripts', 'repo-safety-ci.ts');

function run(cmd: string, args: string[], cwd: string, env: Record<string, string> = {}) {
  return spawnSync(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf-8',
  });
}

function git(cwd: string, ...args: string[]) {
  const res = run('git', args, cwd);
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr || res.stdout}`);
  return res.stdout.trim();
}

function commitFile(cwd: string, path: string, content: string, message: string, authorEmail = 'maintainer@kai-cli.com') {
  const full = join(cwd, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
  git(cwd, 'add', path);
  git(cwd, '-c', `user.email=${authorEmail}`, '-c', 'user.name=KAI Maintainer', 'commit', '-qm', message);
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'repo-safety-ci-'));
  git(dir, 'init', '-q');
  commitFile(dir, 'README.md', '# test\n', 'base');
  return dir;
}

function runGate(cwd: string, range = 'HEAD^..HEAD', env: Record<string, string> = {}) {
  return run('bun', [SCRIPT, '--range', range], cwd, env);
}

describe('repo-safety-ci predicates', () => {
  test('author allowlist matches maintainer and rejects junk identity', () => {
    expect(isAllowedAuthor('maintainer@kai-cli.com')).toBe(true);
    expect(isAllowedAuthor('155489027+DevenDucommun@users.noreply.github.com')).toBe(true);
    expect(isAllowedAuthor('bot@openai.com')).toBe(true);
    expect(isAllowedAuthor('t@t.t')).toBe(false);
  });

  test('runtime path classifier blocks generated memory/runtime surfaces without blocking knowledge docs', () => {
    expect(isRuntimePath('auto-memory/foo.md')).toBe(true);
    expect(isRuntimePath('.last-update-result.json')).toBe(true);
    expect(isRuntimePath('MEMORY/STATE/hook-perf.jsonl')).toBe(true);
    expect(isRuntimePath('MEMORY/KNOWLEDGE/security.md')).toBe(false);
    expect(isRuntimePath('docs/planning/ROADMAP-7.x.md')).toBe(false);
  });
});

describe('repo-safety-ci real gate execution', () => {
  test('passes a normal maintainer-authored change', () => {
    const dir = makeRepo();
    try {
      commitFile(dir, 'docs/ok.md', 'ok\n', 'docs');
      const res = runGate(dir);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('Repo safety CI gate passed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('blocks junk author identities', () => {
    const dir = makeRepo();
    try {
      commitFile(dir, 'bad.txt', 'bad\n', 'bad author', 't@t.t');
      const res = runGate(dir);
      expect(res.status).toBe(1);
      expect(res.stdout).toContain('non-allowlisted author');
      expect(res.stdout).toContain('t@t.t');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('blocks runtime/generated memory files', () => {
    const dir = makeRepo();
    try {
      commitFile(dir, 'auto-memory/session.md', 'memory\n', 'memory noise');
      const res = runGate(dir);
      expect(res.status).toBe(1);
      expect(res.stdout).toContain('runtime/memory-generated files changed');
      expect(res.stdout).toContain('auto-memory/session.md');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('blocks large deletion ranges', () => {
    const dir = makeRepo();
    try {
      commitFile(dir, 'a.txt', 'a\n', 'add a');
      commitFile(dir, 'b.txt', 'b\n', 'add b');
      git(dir, 'rm', '-q', 'a.txt', 'b.txt');
      git(dir, '-c', 'user.email=maintainer@kai-cli.com', '-c', 'user.name=KAI Maintainer', 'commit', '-qm', 'delete files');
      const res = runGate(dir, 'HEAD^..HEAD', { PAI_DELETE_THRESHOLD: '1' });
      expect(res.status).toBe(1);
      expect(res.stdout).toContain('range deletes 2 files');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('blocks exact seed commit subjects', () => {
    const dir = makeRepo();
    try {
      commitFile(dir, 'seed.txt', 'seed\n', 'seed');
      const res = runGate(dir);
      expect(res.status).toBe(1);
      expect(res.stdout).toContain('subject is exactly "seed"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('blocks core.bare=true before range checks', () => {
    const dir = makeRepo();
    try {
      git(dir, 'config', 'core.bare', 'true');
      const res = runGate(dir);
      expect(res.status).toBe(1);
      expect(res.stdout).toContain('core.bare=true on a working repo');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
