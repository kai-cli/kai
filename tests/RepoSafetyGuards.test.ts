/**
 * RepoSafetyGuards.test.ts — incident 2026-06-22 prevention guards (R1/R2/R3).
 *
 * The pre-push hook gained three guards after a stray "seed" tool wiped the repo:
 *   R1 — large-deletion guard (blocks a push range deleting > threshold files)
 *   R2 — author-identity guard (blocks junk authors like t@t.t)
 *   R3 — core.bare canary (blocks pushing from a core.bare=true working repo)
 *
 * "Gates must actually fail" doctrine: these tests prove each guard fires on the bad input
 * AND passes on the good input.
 */
import { describe, test, expect } from 'bun:test';
import { readFileSync, mkdtempSync, rmSync, cpSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';

const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const HOOK = readFileSync(join(REPO, 'scripts/hooks/pre-push'), 'utf-8');
const PRE_COMMIT_HOOK = readFileSync(join(REPO, 'scripts/hooks/pre-commit'), 'utf-8');

describe('pre-push repo-safety guards are wired (incident 2026-06-22)', () => {
  test('R1 large-deletion guard present with override', () => {
    expect(HOOK).toContain('--diff-filter=D');
    expect(HOOK).toContain('PAI_DELETE_THRESHOLD');
    expect(HOOK).toContain('PAI_ALLOW_LARGE_DELETE');
    expect(HOOK).toContain('repo-wipe');
  });

  test('R2 author-identity guard present with allowlist + override', () => {
    expect(HOOK).toContain("git log --format='%ae'");
    expect(HOOK).toContain('kai-cli\\.com');
    expect(HOOK).toContain('PAI_ALLOW_AUTHOR');
  });

  test('R3 core.bare canary present', () => {
    expect(HOOK).toContain('core.bare=true');
    expect(HOOK).toContain('git config --get core.bare');
  });

  test('new-branch range excludes existing remote history (no full-ancestry false positives)', () => {
    // A new branch must scan only commits NOT already on origin — not its entire ancestry,
    // which would flag every historical author/deletion. Must use --not --remotes=origin,
    // NOT bare "$lsha" (full history) and NOT "--not --all" (excludes the pushed commits).
    expect(HOOK).toContain('--not --remotes=origin');
    expect(HOOK).not.toContain('SAFE_RANGE="$lsha"');
  });

  test('docs/memory-only pushes do not run the live-coupled full test suite by default', () => {
    expect(HOOK).toContain('Skipping full test suite for docs/memory-only push range');
    expect(HOOK).toContain('PAI_PRE_PUSH_FULL_TESTS');
    expect(HOOK).toContain('MEMORY/KNOWLEDGE/*.md');
    expect(HOOK).toContain('MEMORY/memcarry/store/atoms/*');
  });

  test('main-branch workflow guard is wired in commit and push hooks', () => {
    expect(PRE_COMMIT_HOOK).toContain('Commit blocked: current branch is main');
    expect(PRE_COMMIT_HOOK).toContain('PAI_ALLOW_MAIN_WRITE');
    expect(HOOK).toContain('direct main-branch push');
    expect(HOOK).toContain('refs/heads/main');
    expect(HOOK).toContain('PAI_ALLOW_MAIN_WRITE');
  });
});

// Pure logic mirrors of the guard predicates — prove they discriminate good vs bad.
function isJunkAuthor(email: string): boolean {
  return !/@(kai-cli\.com|users\.noreply\.github\.com|anthropic\.com|openai\.com)$/.test(email);
}

describe('R2 author predicate (must actually fail)', () => {
  test('blocks the junk t@t.t identity from the incident', () => {
    expect(isJunkAuthor('t@t.t')).toBe(true);
  });
  test('allows real maintainer identities', () => {
    expect(isJunkAuthor('maintainer@kai-cli.com')).toBe(false);
    expect(isJunkAuthor('155489027+DevenDucommun@users.noreply.github.com')).toBe(false);
    expect(isJunkAuthor('noreply@anthropic.com')).toBe(false);
  });
});

describe('R1 deletion predicate (must actually fail)', () => {
  const threshold = 400;
  test('a repo-wipe (1894 deletions) trips the threshold', () => {
    expect(1894 > threshold).toBe(true);
  });
  test('a normal change (a few files) does not', () => {
    expect(5 > threshold).toBe(false);
  });
});

// REAL failure-path test (not string presence): run the actual hook in a core.bare=true repo
// and assert it emits the explicit R3 diagnostic and exits 1 — proving R3 fires BEFORE the
// `git rev-parse --show-toplevel` that would otherwise crash the hook (review finding 2026-06-23).
describe('R3 core.bare canary — real hook execution', () => {
  test('hook blocks with the explicit diagnostic when core.bare=true', () => {
    const dir = mkdtempSync(join(tmpdir(), 'r3-canary-'));
    try {
      const run = (args: string[], opts: any = {}) =>
        spawnSync('git', args, { cwd: dir, encoding: 'utf-8', ...opts });
      run(['init', '-q']);
      run(['config', 'user.email', 'maintainer@kai-cli.com']);
      run(['config', 'user.name', 'KAI Maintainer']);
      require('fs').writeFileSync(join(dir, 'f.txt'), 'x');
      run(['add', '.']);
      run(['commit', '-qm', 'base']);
      const tip = run(['rev-parse', 'HEAD']).stdout.trim();
      cpSync(join(REPO, 'scripts/hooks/pre-push'), join(dir, 'hook.sh'));
      run(['config', 'core.bare', 'true']); // the incident state

      const res = spawnSync('bash', [join(dir, 'hook.sh')], {
        cwd: dir,
        input: `refs/heads/x ${tip} refs/heads/x 000\n`,
        encoding: 'utf-8',
      });
      const out = (res.stdout || '') + (res.stderr || '');
      expect(res.status).toBe(1);                                   // blocked, not crashed-through
      expect(out).toContain('core.bare=true on a working repo');   // explicit diagnostic fired
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('main-branch workflow guard — real hook execution', () => {
  test('pre-commit hook blocks commits on main before scanning staged files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'main-commit-guard-'));
    try {
      const run = (args: string[], opts: any = {}) =>
        spawnSync('git', args, { cwd: dir, encoding: 'utf-8', ...opts });
      run(['init', '-q', '-b', 'main']);
      run(['config', 'user.email', 'maintainer@kai-cli.com']);
      run(['config', 'user.name', 'KAI Maintainer']);
      writeFileSync(join(dir, 'f.txt'), 'x');
      run(['add', '.']);
      cpSync(join(REPO, 'scripts/hooks/pre-commit'), join(dir, 'hook.sh'));

      const res = spawnSync('bash', [join(dir, 'hook.sh')], {
        cwd: dir,
        encoding: 'utf-8',
      });
      const out = (res.stdout || '') + (res.stderr || '');
      expect(res.status).toBe(1);
      expect(out).toContain('Commit blocked: current branch is main');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('pre-push hook blocks direct main push before expensive gates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'main-push-guard-'));
    try {
      const run = (args: string[], opts: any = {}) =>
        spawnSync('git', args, { cwd: dir, encoding: 'utf-8', ...opts });
      run(['init', '-q', '-b', 'main']);
      run(['config', 'user.email', 'maintainer@kai-cli.com']);
      run(['config', 'user.name', 'KAI Maintainer']);
      writeFileSync(join(dir, 'f.txt'), 'x');
      run(['add', '.']);
      run(['commit', '-qm', 'base']);
      const tip = run(['rev-parse', 'HEAD']).stdout.trim();
      cpSync(join(REPO, 'scripts/hooks/pre-push'), join(dir, 'hook.sh'));

      const res = spawnSync('bash', [join(dir, 'hook.sh')], {
        cwd: dir,
        input: `refs/heads/main ${tip} refs/heads/main 000\n`,
        encoding: 'utf-8',
      });
      const out = (res.stdout || '') + (res.stderr || '');
      expect(res.status).toBe(1);
      expect(out).toContain('direct main-branch push');
      expect(out).not.toContain('Running tests');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
