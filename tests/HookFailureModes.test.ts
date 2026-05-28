/**
 * HookFailureModes.test.ts - Test fail-open/fail-closed behavior for critical hooks
 *
 * Verifies that hooks with critical data writes (explicit ratings, work completion)
 * fail-closed (exit non-zero) when writes fail, while best-effort hooks remain fail-open.
 */

import { test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, writeFileSync, chmodSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';

const TEST_PAI_DIR = join(tmpdir(), `pai-hook-failure-test-${Date.now()}`);
const RATINGS_FILE = join(TEST_PAI_DIR, 'MEMORY', 'LEARNING', 'SIGNALS', 'ratings.jsonl');

beforeAll(() => {
  // Create test PAI directory
  mkdirSync(TEST_PAI_DIR, { recursive: true });
  mkdirSync(join(TEST_PAI_DIR, 'MEMORY', 'LEARNING', 'SIGNALS'), { recursive: true });
  mkdirSync(join(TEST_PAI_DIR, 'MEMORY', 'STATE'), { recursive: true });
  mkdirSync(join(TEST_PAI_DIR, 'MEMORY', 'WORK'), { recursive: true });
});

afterAll(() => {
  // Clean up test directory
  if (existsSync(TEST_PAI_DIR)) {
    rmSync(TEST_PAI_DIR, { recursive: true, force: true });
  }
});

test('RatingCapture fails closed on explicit rating write error', async () => {
  const ratingsDir = join(TEST_PAI_DIR, 'MEMORY', 'LEARNING', 'SIGNALS');

  // Create ratings file and make it readonly
  writeFileSync(RATINGS_FILE, '');
  chmodSync(RATINGS_FILE, 0o444); // readonly

  // Use correct rating format: "8 - comment" not "8/10"
  // The parser rejects "X/Y" format to avoid false positives
  const hookInput = JSON.stringify({
    session_id: 'test-session',
    prompt: '8 - great work',
    transcript_path: '/dev/null',
    hook_event_name: 'UserPromptSubmit',
  });

  const result = spawnSync(
    'bun',
    [join(process.cwd(), 'hooks', 'RatingCapture.hook.ts')],
    {
      input: hookInput,
      env: { ...process.env, PAI_DIR: TEST_PAI_DIR },
      encoding: 'utf-8',
      timeout: 10000,
    }
  );

  // Restore write permissions for cleanup
  chmodSync(RATINGS_FILE, 0o644);

  // Explicit rating write failure should exit non-zero
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('FATAL');
});

test('RatingCapture succeeds on explicit rating write', async () => {
  // Ensure ratings file is writable
  const ratingsDir = join(TEST_PAI_DIR, 'MEMORY', 'LEARNING', 'SIGNALS');
  if (existsSync(RATINGS_FILE)) {
    chmodSync(RATINGS_FILE, 0o644);
  }

  // Use correct rating format: "9 - comment" not "9/10"
  const hookInput = JSON.stringify({
    session_id: 'test-session',
    prompt: '9 - excellent',
    transcript_path: '/dev/null',
    hook_event_name: 'UserPromptSubmit',
  });

  const result = spawnSync(
    'bun',
    [join(process.cwd(), 'hooks', 'RatingCapture.hook.ts')],
    {
      input: hookInput,
      env: { ...process.env, PAI_DIR: TEST_PAI_DIR },
      encoding: 'utf-8',
      timeout: 10000,
    }
  );

  // Explicit rating write success should exit 0
  expect(result.status).toBe(0);
  expect(result.stderr).toContain('Wrote explicit rating');
});

test('SessionSummary fails closed on META.yaml write error', async () => {
  const workDir = join(TEST_PAI_DIR, 'MEMORY', 'WORK', 'test-work-123');
  mkdirSync(workDir, { recursive: true });

  // Create META.yaml
  const metaPath = join(workDir, 'META.yaml');
  writeFileSync(metaPath, 'id: "test-work-123"\ntitle: "Test Work"\nstatus: "ACTIVE"\ncompleted_at: null\n');

  // Create current-work.json state
  const stateFile = join(TEST_PAI_DIR, 'MEMORY', 'STATE', 'current-work.json');
  writeFileSync(stateFile, JSON.stringify({
    session_id: 'test-session',
    session_dir: 'test-work-123',
    created_at: new Date().toISOString(),
  }));

  // Make META.yaml readonly
  chmodSync(metaPath, 0o444);

  const hookInput = JSON.stringify({
    session_id: 'test-session',
    transcript_path: '/dev/null',
    hook_event_name: 'SessionEnd',
  });

  const result = spawnSync(
    'bun',
    [join(process.cwd(), 'hooks', 'SessionSummary.hook.ts')],
    {
      input: hookInput,
      env: { ...process.env, PAI_DIR: TEST_PAI_DIR },
      encoding: 'utf-8',
      timeout: 5000,
    }
  );

  // Restore write permissions for cleanup
  chmodSync(metaPath, 0o644);

  // Work completion write failure should exit non-zero
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('FATAL');
});

test('SessionSummary succeeds on valid work completion', async () => {
  const workDir = join(TEST_PAI_DIR, 'MEMORY', 'WORK', 'test-work-456');
  mkdirSync(workDir, { recursive: true });

  // Create META.yaml
  const metaPath = join(workDir, 'META.yaml');
  writeFileSync(metaPath, 'id: "test-work-456"\ntitle: "Test Work"\nstatus: "ACTIVE"\ncompleted_at: null\n');

  // Create current-work.json state
  const stateFile = join(TEST_PAI_DIR, 'MEMORY', 'STATE', 'current-work.json');
  writeFileSync(stateFile, JSON.stringify({
    session_id: 'test-session-2',
    session_dir: 'test-work-456',
    created_at: new Date().toISOString(),
  }));

  const hookInput = JSON.stringify({
    session_id: 'test-session-2',
    transcript_path: '/dev/null',
    hook_event_name: 'SessionEnd',
  });

  const result = spawnSync(
    'bun',
    [join(process.cwd(), 'hooks', 'SessionSummary.hook.ts')],
    {
      input: hookInput,
      env: { ...process.env, PAI_DIR: TEST_PAI_DIR },
      encoding: 'utf-8',
      timeout: 5000,
    }
  );

  // Valid work completion should exit 0
  expect(result.status).toBe(0);
  expect(result.stderr).toContain('Marked work directory as COMPLETED');
});

test('InsightExtractor remains fail-open on write error', async () => {
  // InsightExtractor should be fail-open (best-effort learning capture)
  const insightsDir = join(TEST_PAI_DIR, 'MEMORY', 'LEARNING', 'INSIGHTS');
  mkdirSync(insightsDir, { recursive: true });

  // Make insights directory readonly
  chmodSync(insightsDir, 0o555);

  const hookInput = JSON.stringify({
    session_id: 'test-session',
    transcript_path: '/dev/null',
    hook_event_name: 'SessionEnd',
  });

  const result = spawnSync(
    'bun',
    [join(process.cwd(), 'hooks', 'InsightExtractor.hook.ts')],
    {
      input: hookInput,
      env: { ...process.env, PAI_DIR: TEST_PAI_DIR },
      encoding: 'utf-8',
      timeout: 5000,
    }
  );

  // Restore write permissions for cleanup
  chmodSync(insightsDir, 0o755);

  // InsightExtractor should always exit 0 (fail-open)
  expect(result.status).toBe(0);
});
