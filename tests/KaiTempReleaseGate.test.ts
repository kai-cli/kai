import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  assertNoScrubSentinel,
  findForbiddenArtifactPaths,
  seedTempKaiRepo,
} from '../scripts/kai-temp-release-gate';

describe('kai-temp-release-gate', () => {
  test('detects forbidden private/runtime artifact paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'kai-artifact-test-'));
    mkdirSync(join(root, 'auto-memory'), { recursive: true });
    writeFileSync(join(root, 'auto-memory', 'memory.md'), 'private');
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, 'scripts', 'pii-patterns.json'), '[]');
    mkdirSync(join(root, 'MEMORY', 'STATE'), { recursive: true });
    writeFileSync(join(root, 'MEMORY', 'STATE', 'ada-branch-guard-overrides.jsonl'), '{}\n');
    writeFileSync(join(root, 'README.md'), '# safe\n');

    const found = findForbiddenArtifactPaths(root);

    expect(found).toContain('auto-memory');
    expect(found).toContain('scripts/pii-patterns.json');
    expect(found).toContain('MEMORY/STATE/ada-branch-guard-overrides.jsonl');
    expect(found).not.toContain('README.md');
  });

  test('detects uncleared scrub sentinel', () => {
    const root = mkdtempSync(join(tmpdir(), 'kai-sentinel-test-'));
    mkdirSync(join(root, '.git'), { recursive: true });
    writeFileSync(join(root, '.git', '.sync-scrub-in-progress'), 'in progress');

    expect(assertNoScrubSentinel(root)).toEqual(['.git/.sync-scrub-in-progress']);
  });

  test('seedTempKaiRepo creates required KAI-only baseline files and git repo', () => {
    const root = mkdtempSync(join(tmpdir(), 'kai-seed-test-'));
    seedTempKaiRepo(root);

    expect(existsSync(join(root, '.git'))).toBe(true);
    expect(existsSync(join(root, 'LICENSE'))).toBe(true);
    expect(existsSync(join(root, 'CONTRIBUTING.md'))).toBe(true);
    expect(existsSync(join(root, 'MEMORY', 'STATE', '.gitkeep'))).toBe(true);
  });
});
