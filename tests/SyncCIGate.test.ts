/**
 * SyncCIGate.test.ts — Test sync readiness gate
 *
 * Verifies that the sync CI gate correctly:
 * 1. Classifies files as private/kai-only/public
 * 2. Detects PII in public files
 * 3. Verifies manifest counts
 * 4. Actually fails on bad input (gate integrity)
 */

import { describe, test, expect } from 'bun:test';
import { classifyFile, scanForPII, parseExcludePaths, parseKaiOnlyFiles } from '../scripts/sync-ci-gate';
import { existsSync, writeFileSync, mkdirSync, unlinkSync, rmdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

// Capture PAI_DIR at module load time, before any tests can modify process.env
// This prevents interference from parallel tests (e.g., ApiKeys.test.ts) that modify HOME
const PAI_DIR = (() => {
  if (process.env.PAI_DIR) return process.env.PAI_DIR;
  // If running from kai root, use cwd
  const cwd = process.cwd();
  if (cwd.endsWith('kai')) return cwd;
  // Otherwise use standard path (this will be correct before tests modify HOME)
  return join(process.env.HOME!, 'Projects', 'kai');
})();
const TEST_DIR = join(PAI_DIR, 'tests', '.sync-gate-test-tmp');

// sync-to-kai.sh is kai only (excluded from kai sync)
const hasSyncScript = existsSync(join(PAI_DIR, 'scripts', 'sync-to-kai.sh'));

describe.skipIf(!hasSyncScript)('SyncCIGate', () => {
  test('parses EXCLUDE_PATHS from sync-to-kai.sh', () => {
    const excludePaths = parseExcludePaths(PAI_DIR);
    expect(excludePaths.length).toBeGreaterThan(0);
    expect(excludePaths).toContain('CLAUDE.md');
    expect(excludePaths).toContain('VERSION');
    expect(excludePaths).toContain('config/identity.jsonc');
  });

  test('parses KAI_ONLY_FILES from sync-to-kai.sh', () => {
    const kaiOnlyFiles = parseKaiOnlyFiles(PAI_DIR);
    expect(kaiOnlyFiles.length).toBeGreaterThan(0);
    expect(kaiOnlyFiles).toContain('CHANGELOG.md');
    expect(kaiOnlyFiles).toContain('LICENSE');
    expect(kaiOnlyFiles).toContain('get-kai.sh');
  });

  test('classifies file in EXCLUDE_PATHS as private', () => {
    const excludePaths = parseExcludePaths(PAI_DIR);
    const kaiOnlyFiles = parseKaiOnlyFiles(PAI_DIR);

    const result = classifyFile('CLAUDE.md', excludePaths, kaiOnlyFiles);
    expect(result).toBe('private');
  });

  test('classifies file in KAI_ONLY_FILES as kai-only', () => {
    const excludePaths = parseExcludePaths(PAI_DIR);
    const kaiOnlyFiles = parseKaiOnlyFiles(PAI_DIR);

    const result = classifyFile('CHANGELOG.md', excludePaths, kaiOnlyFiles);
    expect(result).toBe('kai-only');
  });

  test('classifies uncategorized file as public', () => {
    const excludePaths = parseExcludePaths(PAI_DIR);
    const kaiOnlyFiles = parseKaiOnlyFiles(PAI_DIR);

    const result = classifyFile('hooks/SessionStart.hook.ts', excludePaths, kaiOnlyFiles);
    expect(result).toBe('public');
  });

  test('detects PII pattern in file content', () => {
    // Create temporary test file with PII
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }

    const testFile = join(TEST_DIR, 'pii-test.ts');
    const relPath = 'tests/.sync-gate-test-tmp/pii-test.ts';

    // Write file with known PII pattern
    writeFileSync(testFile, '// Email: test@example.com\nconst foo = "bar";');

    const patterns = scanForPII(relPath, PAI_DIR);

    // Clean up
    unlinkSync(testFile);
    try {
      rmdirSync(TEST_DIR);
    } catch {
      // Directory might not be empty if other tests are running
    }

    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns.some(p => p.includes('yourcompany'))).toBe(true);
  });

  test('does not flag clean file', () => {
    // Create temporary test file without PII
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }

    const testFile = join(TEST_DIR, 'clean-test.ts');
    const relPath = 'tests/.sync-gate-test-tmp/clean-test.ts';

    writeFileSync(testFile, '// Clean file\nconst foo = "bar";\nexport default foo;');

    const patterns = scanForPII(relPath, PAI_DIR);

    // Clean up
    unlinkSync(testFile);
    try {
      rmdirSync(TEST_DIR);
    } catch {
      // Ignore cleanup errors
    }

    expect(patterns.length).toBe(0);
  });

  test('gate actually fails on PII in public file', () => {
    // This test verifies the gate doesn't just log warnings — it must EXIT 1
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }

    const testFile = join(TEST_DIR, 'pii-public.ts');
    const relPath = 'tests/.sync-gate-test-tmp/pii-public.ts';

    // Write a file with PII that would be classified as public
    writeFileSync(testFile, '// Author: Your Name\nconst config = { email: "test@example.com" };');

    // Add to git tracking temporarily
    try {
      execSync(`git add "${testFile}"`, { cwd: PAI_DIR, stdio: 'ignore' });

      // Run the gate script — it should fail
      let exitCode = 0;
      try {
        execSync('bun scripts/sync-ci-gate.ts', {
          cwd: PAI_DIR,
          env: { ...process.env, PAI_DIR },
          stdio: 'pipe',
          timeout: 10000
        });
      } catch (err: any) {
        exitCode = err.status || 1;
      }

      // Clean up git tracking
      execSync(`git reset HEAD "${testFile}"`, { cwd: PAI_DIR, stdio: 'ignore' });
      unlinkSync(testFile);
      try {
        rmdirSync(TEST_DIR);
      } catch {
        // Ignore cleanup errors
      }

      // The gate MUST fail when PII is present in a public file
      expect(exitCode).toBe(1);
    } catch (err) {
      // Clean up on error
      try {
        execSync(`git reset HEAD "${testFile}"`, { cwd: PAI_DIR, stdio: 'ignore' });
      } catch {}
      try {
        unlinkSync(testFile);
      } catch {}
      try {
        rmdirSync(TEST_DIR);
      } catch {}
      throw err;
    }
  });

  test('gate runs without crashing', () => {
    // Run gate on actual repo — it may pass or fail depending on repo state
    // but it should not crash
    let exitCode = 0;
    let crashed = false;
    try {
      execSync('bun scripts/sync-ci-gate.ts', {
        cwd: PAI_DIR,
        env: { ...process.env, PAI_DIR },
        stdio: 'pipe',
        timeout: 10000
      });
    } catch (err: any) {
      exitCode = err.status;
      if (exitCode === undefined || exitCode === null) {
        crashed = true;
      }
    }

    // Gate should not crash (should exit with either 0 or 1)
    expect(crashed).toBe(false);
    expect([0, 1]).toContain(exitCode);
  });

  test('manifest counts align with filesystem', () => {
    const manifestPath = join(PAI_DIR, 'manifest.json');
    if (!existsSync(manifestPath)) {
      // Manifest doesn't exist in kai (kai-only), skip test
      expect(true).toBe(true);
      return;
    }

    const manifest = JSON.parse(require('fs').readFileSync(manifestPath, 'utf-8'));

    const actualSkills = execSync(
      "find skills -name SKILL.md | wc -l | tr -d ' '",
      { cwd: PAI_DIR, encoding: 'utf-8' }
    ).trim();

    const actualHooks = execSync(
      "find hooks -maxdepth 1 -name '*.hook.ts' | wc -l | tr -d ' '",
      { cwd: PAI_DIR, encoding: 'utf-8' }
    ).trim();

    const actualAgents = execSync(
      "find agents -maxdepth 1 -name '*.md' ! -name README.md | wc -l | tr -d ' '",
      { cwd: PAI_DIR, encoding: 'utf-8' }
    ).trim();

    // If manifest exists, counts must match
    if (manifest.skills !== undefined) {
      expect(manifest.skills.toString()).toBe(actualSkills);
    }
    if (manifest.hooks !== undefined) {
      expect(manifest.hooks.toString()).toBe(actualHooks);
    }
    if (manifest.agents !== undefined) {
      expect(manifest.agents.toString()).toBe(actualAgents);
    }
  });

  test('directory patterns work correctly', () => {
    const excludePaths = parseExcludePaths(PAI_DIR);
    const kaiOnlyFiles = parseKaiOnlyFiles(PAI_DIR);

    // Test directory pattern matching
    const result1 = classifyFile('Plans/v6.5.0.md', excludePaths, kaiOnlyFiles);
    expect(result1).toBe('private');

    const result2 = classifyFile('hooks/user/CustomHook.hook.ts', excludePaths, kaiOnlyFiles);
    expect(result2).toBe('kai-only');
  });

  test('glob patterns work correctly', () => {
    const excludePaths = parseExcludePaths(PAI_DIR);
    const kaiOnlyFiles = parseKaiOnlyFiles(PAI_DIR);

    // Test glob pattern for MEMORY/STAGING/2026-*
    const result = classifyFile('MEMORY/STAGING/2026-05-27-session.json', excludePaths, kaiOnlyFiles);
    expect(result).toBe('private');
  });
});
