/**
 * SecurityValidator.test.ts — Subprocess tests for hooks/SecurityValidator.hook.ts
 *
 * Tests the three decision types: block (exit 2), confirm (ask), allow (continue).
 * Covers: catastrophic Bash commands, zero-access paths, confirm-level ops, safe ops.
 *
 * Run: bun test tests/SecurityValidator.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { spawn } from 'bun';

const HOOK = new URL('../hooks/SecurityValidator.hook.ts', import.meta.url).pathname;

// Use real PAI_DIR so patterns.yaml loads — security tests must test real patterns.
// Security event logs write to a temp dir to avoid polluting production logs.
import { mkdtempSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';

const TEST_LOG_DIR = mkdtempSync(join(tmpdir(), 'pai-sv-test-'));
mkdirSync(join(TEST_LOG_DIR, 'MEMORY', 'SECURITY'), { recursive: true });
const REPO_ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const REAL_PAI_DIR = process.env.PAI_DIR || REPO_ROOT;

async function runValidator(
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<{ decision?: string; continue?: boolean; reason?: string; message?: string; exitCode: number }> {
  const payload = JSON.stringify({
    session_id: 'test-session',
    tool_name: toolName,
    tool_input: toolInput,
  });

  // Use real PAI_DIR for patterns, but override log path to temp dir
  const proc = spawn(['bun', 'run', HOOK], {
    stdin: new TextEncoder().encode(payload),
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, PAI_DIR: REAL_PAI_DIR },
  });

  const [out, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);

  try {
    const parsed = out.trim() ? JSON.parse(out) : {};
    return { ...parsed, exitCode };
  } catch {
    // Empty stdout = hard block (exit 2) — not a parse error
    return { exitCode };
  }
}

// ── Hard blocks (catastrophic operations → exit 2) ────────────────────────────

describe('SecurityValidator — hard blocks (Bash)', () => {
  test('blocks rm -rf /', async () => {
    const result = await runValidator('Bash', { command: 'rm -rf /' });
    // Hard block: decision=block OR exit code 2
    expect(result.decision === 'block' || result.exitCode === 2).toBe(true);
  });

  test('blocks rm -rf /*', async () => {
    const result = await runValidator('Bash', { command: 'rm -rf /*' });
    expect(result.decision === 'block' || result.exitCode === 2).toBe(true);
  });

  test('blocks format/mkfs commands', async () => {
    const result = await runValidator('Bash', { command: 'mkfs.ext4 /dev/sda' });
    expect(result.decision === 'block' || result.exitCode === 2).toBe(true);
  });
});

// ── Zero-access paths (never readable or writable) ───────────────────────────

describe('SecurityValidator — zero-access paths', () => {
  test('blocks Read of ~/.ssh/id_rsa (exit 2, no stdout)', async () => {
    const home = process.env.HOME || '/Users/test';
    const result = await runValidator('Read', { file_path: `${home}/.ssh/id_rsa` });
    // Hard block: exits with code 2, stdout is empty
    expect(result.exitCode).toBe(2);
    expect(result.continue).not.toBe(true);
  });

  test('blocks Write to ~/.ssh/authorized_keys (exit 2, no stdout)', async () => {
    const home = process.env.HOME || '/Users/test';
    const result = await runValidator('Write', {
      file_path: `${home}/.ssh/authorized_keys`,
      content: 'evil key',
    });
    expect(result.exitCode).toBe(2);
    expect(result.continue).not.toBe(true);
  });
});

// ── Confirm-level operations (ask, not block) ────────────────────────────────

describe('SecurityValidator — confirm operations', () => {
  test('asks on git push --force', async () => {
    const result = await runValidator('Bash', { command: 'git push --force origin main' });
    // Should be ask or block, never silently allow
    expect(result.continue).not.toBe(true);
  });

  test('asks on destructive git operations', async () => {
    const result = await runValidator('Bash', { command: 'git reset --hard HEAD~10' });
    expect(result.continue).not.toBe(true);
  });
});

// ── Safe operations (allow) ──────────────────────────────────────────────────

describe('SecurityValidator — allowed operations', () => {
  test('allows normal git status', async () => {
    const result = await runValidator('Bash', { command: 'git status' });
    expect(result.continue).toBe(true);
  });

  test('allows bun test', async () => {
    const result = await runValidator('Bash', { command: 'bun test' });
    expect(result.continue).toBe(true);
  });

  test('allows reading a normal source file', async () => {
    const result = await runValidator('Read', { file_path: '/Users/test/Projects/myapp/src/index.ts' });
    expect(result.continue).toBe(true);
  });

  test('allows ls command', async () => {
    const result = await runValidator('Bash', { command: 'ls -la' });
    expect(result.continue).toBe(true);
  });

  test('allows grep command', async () => {
    const result = await runValidator('Bash', { command: 'grep -r "pattern" ./src' });
    expect(result.continue).toBe(true);
  });
});

// ── Fail-open behavior ───────────────────────────────────────────────────────

describe('SecurityValidator — fail-open', () => {
  test('returns continue on malformed input', async () => {
    const proc = spawn(['bun', 'run', HOOK], {
      stdin: new TextEncoder().encode('not-valid-json'),
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, PAI_DIR: '/tmp/pai-security-test' },
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    const result = JSON.parse(out);
    expect(result.continue).toBe(true);
  });

  test('missing patterns file does not crash — fails open', async () => {
    // With a PAI_DIR with no patterns.yaml, should fail open (allow)
    const proc = spawn(['bun', 'run', HOOK], {
      stdin: new TextEncoder().encode(JSON.stringify({
        session_id: 'test', tool_name: 'Bash', tool_input: { command: 'echo hello' },
      })),
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, PAI_DIR: TEST_LOG_DIR }, // empty dir, no patterns
    });
    const out = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    expect(exitCode).not.toBe(1); // never exit(1) from a hook
    const result = JSON.parse(out);
    expect(result.continue).toBe(true); // fail-open
  });
});
