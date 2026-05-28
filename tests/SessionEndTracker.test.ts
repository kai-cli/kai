/**
 * SessionEndTracker.test.ts - Tests for hooks/lib/session-end-tracker.ts
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { existsSync, mkdirSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';
import { markStarted, markComplete, detectStale, cleanupSession } from '../hooks/lib/session-end-tracker';

// Use a test-specific MEMORY/STATE directory
const TEST_PAI_DIR = join(import.meta.dir, '.test-session-end-tracker');
const SENTINEL_DIR = join(TEST_PAI_DIR, 'MEMORY', 'STATE', 'session-end');

beforeAll(() => {
  // Set PAI_DIR to our test directory
  process.env.PAI_DIR = TEST_PAI_DIR;

  // Clean up any existing test directory
  if (existsSync(TEST_PAI_DIR)) {
    rmSync(TEST_PAI_DIR, { recursive: true, force: true });
  }

  // Create the structure
  mkdirSync(SENTINEL_DIR, { recursive: true });
});

afterAll(() => {
  // Clean up test directory
  if (existsSync(TEST_PAI_DIR)) {
    rmSync(TEST_PAI_DIR, { recursive: true, force: true });
  }

  // Restore PAI_DIR
  delete process.env.PAI_DIR;
});

describe('SessionEndTracker', () => {
  test('markStarted creates .started file', () => {
    markStarted('TestHook', 'session-123');

    const files = readdirSync(SENTINEL_DIR);
    expect(files).toContain('TestHook.session-123.started');
  });

  test('markComplete renames .started to .complete', () => {
    markStarted('HookA', 'session-456');
    markComplete('HookA', 'session-456');

    const files = readdirSync(SENTINEL_DIR);
    expect(files).toContain('HookA.session-456.complete');
    expect(files).not.toContain('HookA.session-456.started');
  });

  test('detectStale finds hooks with .started but no .complete', () => {
    // Create two hooks, only complete one
    markStarted('StaleHook', 'session-789');
    markStarted('CompleteHook', 'session-789');
    markComplete('CompleteHook', 'session-789');

    const stale = detectStale();
    expect(stale).toContain('StaleHook');
    expect(stale).not.toContain('CompleteHook');
  });

  test('detectStale returns empty array when all hooks complete', () => {
    const sessionId = 'session-all-complete';
    markStarted('Hook1', sessionId);
    markStarted('Hook2', sessionId);
    markStarted('Hook3', sessionId);

    markComplete('Hook1', sessionId);
    markComplete('Hook2', sessionId);
    markComplete('Hook3', sessionId);

    const stale = detectStale();
    // Filter to only this session's hooks
    const sessionStale = stale.filter(h => {
      const files = readdirSync(SENTINEL_DIR);
      return files.some(f => f.includes(sessionId) && f.startsWith(h));
    });

    expect(sessionStale.length).toBe(0);
  });

  test('cleanupSession removes all files for that session', () => {
    const sessionId = 'session-cleanup-test';

    markStarted('HookX', sessionId);
    markStarted('HookY', sessionId);
    markComplete('HookY', sessionId);

    // Verify files exist
    let files = readdirSync(SENTINEL_DIR);
    const beforeCount = files.filter(f => f.includes(sessionId)).length;
    expect(beforeCount).toBeGreaterThan(0);

    // Cleanup
    cleanupSession(sessionId);

    // Verify all session files removed
    files = readdirSync(SENTINEL_DIR);
    const afterCount = files.filter(f => f.includes(sessionId)).length;
    expect(afterCount).toBe(0);
  });

  test('multiple sessions do not interfere', () => {
    const session1 = 'session-multi-1';
    const session2 = 'session-multi-2';

    markStarted('HookA', session1);
    markStarted('HookB', session2);
    markComplete('HookA', session1);

    // session1 should be complete, session2 should be stale
    const stale = detectStale();

    // Check if HookB is in stale list
    expect(stale).toContain('HookB');

    // Clean up session1 should not affect session2
    cleanupSession(session1);

    const files = readdirSync(SENTINEL_DIR);
    expect(files.some(f => f.includes(session1))).toBe(false);
    expect(files.some(f => f.includes(session2))).toBe(true);
  });

  test('markComplete without markStarted creates .complete file', () => {
    const sessionId = 'session-direct-complete';

    // Call markComplete without markStarted
    markComplete('DirectComplete', sessionId);

    const files = readdirSync(SENTINEL_DIR);
    expect(files).toContain('DirectComplete.session-direct-complete.complete');
  });

  test('hook names with dots are handled correctly', () => {
    const sessionId = 'session-dots';
    const hookName = 'Complex.Hook.Name';

    markStarted(hookName, sessionId);
    markComplete(hookName, sessionId);

    const files = readdirSync(SENTINEL_DIR);
    expect(files).toContain(`${hookName}.${sessionId}.complete`);

    // Verify detectStale doesn't report it as stale
    const stale = detectStale();
    expect(stale).not.toContain(hookName);
  });
});
