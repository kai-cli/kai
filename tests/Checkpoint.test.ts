import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { CheckpointManager } from '../scripts/lib/checkpoint';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('CheckpointManager', () => {
  let testDir: string;
  let manager: CheckpointManager;

  beforeEach(() => {
    // Create a unique temp directory for each test
    testDir = join(tmpdir(), `checkpoint-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    manager = new CheckpointManager(testDir);
  });

  afterEach(() => {
    // Cleanup test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('save/load checkpoint round-trip', () => {
    const output = 'This is the PM scoping output';
    manager.save('scope', 'completed', output);

    const loaded = manager.getPhaseOutput('scope');
    expect(loaded).toBe(output);
  });

  test('getLastCompleted returns correct phase', () => {
    manager.save('scope', 'completed', 'scope output');
    expect(manager.getLastCompleted()).toBe('scope');

    manager.save('implement', 'completed', 'implement output');
    expect(manager.getLastCompleted()).toBe('implement');
  });

  test('getLastCompleted returns most recent completed phase', () => {
    manager.save('scope', 'completed', 'scope output');

    // Add a small delay to ensure different timestamps
    const start = Date.now();
    while (Date.now() - start < 5) {
      // Spin
    }

    manager.save('implement', 'completed', 'implement output');
    expect(manager.getLastCompleted()).toBe('implement');
  });

  test('getLastCompleted ignores non-completed phases', () => {
    manager.save('scope', 'completed', 'scope output');
    manager.save('implement', 'started');
    manager.save('verify', 'failed');

    expect(manager.getLastCompleted()).toBe('scope');
  });

  test('getLastCompleted returns null when no checkpoints exist', () => {
    expect(manager.getLastCompleted()).toBeNull();
  });

  test('canResume true when partial checkpoints exist', () => {
    manager.save('scope', 'completed', 'scope output');
    manager.save('implement', 'started');

    expect(manager.canResume()).toBe(true);
  });

  test('canResume false when no checkpoints exist', () => {
    expect(manager.canResume()).toBe(false);
  });

  test('canResume true with only completed checkpoints', () => {
    manager.save('scope', 'completed', 'scope output');
    expect(manager.canResume()).toBe(true);
  });

  test('cleanup removes all checkpoint files', () => {
    manager.save('scope', 'completed', 'scope output');
    manager.save('implement', 'completed', 'implement output');
    manager.save('verify', 'started');

    const checkpointsDir = join(testDir, 'checkpoints');
    expect(existsSync(checkpointsDir)).toBe(true);

    manager.cleanup();

    // Directory still exists but files are removed
    const checkpoints = manager.getAllCheckpoints();
    expect(checkpoints.length).toBe(0);
  });

  test('getPhaseOutput returns null for non-existent phase', () => {
    expect(manager.getPhaseOutput('nonexistent')).toBeNull();
  });

  test('getPhaseOutput returns null for started phase (no output yet)', () => {
    manager.save('scope', 'started');
    expect(manager.getPhaseOutput('scope')).toBeNull();
  });

  test('getPhaseOutput returns null for failed phase', () => {
    manager.save('scope', 'failed');
    expect(manager.getPhaseOutput('scope')).toBeNull();
  });

  test('getAllCheckpoints returns checkpoints in chronological order', () => {
    manager.save('scope', 'completed', 'scope output');

    // Small delay for timestamp ordering
    const start = Date.now();
    while (Date.now() - start < 5) {
      // Spin
    }

    manager.save('implement', 'started');

    const checkpoints = manager.getAllCheckpoints();
    expect(checkpoints.length).toBe(2);
    expect(checkpoints[0].phase).toBe('scope');
    expect(checkpoints[1].phase).toBe('implement');
  });

  test('checkpoint saves status correctly', () => {
    manager.save('scope', 'started');
    const checkpoints = manager.getAllCheckpoints();
    expect(checkpoints[0].status).toBe('started');

    manager.save('scope', 'completed', 'output');
    const updated = manager.getAllCheckpoints();
    expect(updated[0].status).toBe('completed');
  });

  test('checkpoint includes timestamp', () => {
    const before = new Date().toISOString();
    manager.save('scope', 'completed', 'output');
    const after = new Date().toISOString();

    const checkpoints = manager.getAllCheckpoints();
    expect(checkpoints.length).toBe(1);
    expect(checkpoints[0].timestamp).toBeTruthy();
    expect(checkpoints[0].timestamp >= before).toBe(true);
    expect(checkpoints[0].timestamp <= after).toBe(true);
  });
});
