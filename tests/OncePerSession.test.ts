/**
 * OncePerSession.test.ts — Tests for hooks/lib/once-per-session.ts
 *
 * Run: bun test tests/OncePerSession.test.ts
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { alreadyRanForSession, markRanForSession } from '../hooks/lib/once-per-session';

let tmpDir: string;
let origPaiDir: string | undefined;

function setup() {
  tmpDir = mkdtempSync(join(tmpdir(), 'pai-once-session-test-'));
  origPaiDir = process.env.PAI_DIR;
  process.env.PAI_DIR = tmpDir;
}

function cleanup() {
  rmSync(tmpDir, { recursive: true, force: true });
  if (origPaiDir !== undefined) process.env.PAI_DIR = origPaiDir;
  else delete process.env.PAI_DIR;
}

// ── null session_id ──────────────────────────────────────────────────────────

describe('null session_id', () => {
  beforeEach(setup);
  afterEach(cleanup);

  test('alreadyRanForSession returns false for null session_id', () => {
    expect(alreadyRanForSession('TestHook', null)).toBe(false);
  });

  test('markRanForSession is a no-op for null session_id', () => {
    markRanForSession('TestHook', null);
    expect(alreadyRanForSession('TestHook', null)).toBe(false);
  });
});

// ── First run ────────────────────────────────────────────────────────────────

describe('first run', () => {
  beforeEach(setup);
  afterEach(cleanup);

  test('returns false on first check for a session', () => {
    expect(alreadyRanForSession('StartupGreeting', 'session-001')).toBe(false);
  });

  test('creates STATE directory and sentinel after mark', () => {
    markRanForSession('StartupGreeting', 'session-001');
    const sentinel = join(tmpDir, 'MEMORY', 'STATE', '.once-StartupGreeting');
    const content = readFileSync(sentinel, 'utf-8').trim();
    expect(content).toBe('session-001');
  });
});

// ── Second run (same session) ────────────────────────────────────────────────

describe('same session re-fire', () => {
  beforeEach(setup);
  afterEach(cleanup);

  test('returns true after marking the same session', () => {
    markRanForSession('LoadContext', 'session-abc');
    expect(alreadyRanForSession('LoadContext', 'session-abc')).toBe(true);
  });
});

// ── Different session ────────────────────────────────────────────────────────

describe('different session', () => {
  beforeEach(setup);
  afterEach(cleanup);

  test('returns false for a different session_id', () => {
    markRanForSession('StartupGreeting', 'session-001');
    expect(alreadyRanForSession('StartupGreeting', 'session-002')).toBe(false);
  });

  test('new session overwrites old sentinel', () => {
    markRanForSession('StartupGreeting', 'session-001');
    markRanForSession('StartupGreeting', 'session-002');
    expect(alreadyRanForSession('StartupGreeting', 'session-001')).toBe(false);
    expect(alreadyRanForSession('StartupGreeting', 'session-002')).toBe(true);
  });
});

// ── Different hooks ──────────────────────────────────────────────────────────

describe('hook isolation', () => {
  beforeEach(setup);
  afterEach(cleanup);

  test('different hooks have independent sentinels', () => {
    markRanForSession('StartupGreeting', 'session-xyz');
    markRanForSession('LoadContext', 'session-xyz');

    expect(alreadyRanForSession('StartupGreeting', 'session-xyz')).toBe(true);
    expect(alreadyRanForSession('LoadContext', 'session-xyz')).toBe(true);
    expect(alreadyRanForSession('CheckVersion', 'session-xyz')).toBe(false);
  });
});

// ── STATE directory doesn't exist yet ────────────────────────────────────────

describe('no STATE directory', () => {
  beforeEach(setup);
  afterEach(cleanup);

  test('alreadyRanForSession returns false gracefully', () => {
    expect(alreadyRanForSession('NewHook', 'session-new')).toBe(false);
  });

  test('markRanForSession creates STATE dir automatically', () => {
    markRanForSession('NewHook', 'session-new');
    expect(alreadyRanForSession('NewHook', 'session-new')).toBe(true);
  });
});
