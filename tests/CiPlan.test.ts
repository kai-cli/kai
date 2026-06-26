import { describe, expect, test } from 'bun:test';
import { planCi } from '../scripts/ci-plan';

describe('ci-plan', () => {
  test('push events run full CI regardless of paths', () => {
    const plan = planCi(['docs/planning/ROADMAP-7.x.md'], 'push');

    expect(plan.run_docs_spec).toBe(true);
    expect(plan.run_tests).toBe(true);
    expect(plan.run_smoke).toBe(true);
    expect(plan.run_sync).toBe(true);
    expect(plan.reason).toContain('push event');
  });

  test('docs-only PRs skip expensive source suites but run docs/spec', () => {
    const plan = planCi([
      'docs/planning/ROADMAP-7.x.md',
      'docs/planning/MEMORY-SPINE-SPEC.md',
    ], 'pull_request');

    expect(plan.docs_only).toBe(true);
    expect(plan.run_docs_spec).toBe(true);
    expect(plan.run_tests).toBe(false);
    expect(plan.run_smoke).toBe(false);
    expect(plan.run_sync).toBe(false);
  });

  test('hook/config changes run tests and smoke', () => {
    const plan = planCi([
      'hooks/GitHubWriteGuard.hook.ts',
      'config/hooks.jsonc',
    ], 'pull_request');

    expect(plan.docs_only).toBe(false);
    expect(plan.run_tests).toBe(true);
    expect(plan.run_smoke).toBe(true);
    expect(plan.run_sync).toBe(false);
    expect(plan.reason).toContain('hook/config');
  });

  test('sync/KAI changes run tests and sync gate', () => {
    const plan = planCi([
      'scripts/sync-ci-gate.ts',
      'scripts/sync-manifest.json',
      'scripts/kai-temp-release-gate.ts',
    ], 'pull_request');

    expect(plan.run_tests).toBe(true);
    expect(plan.run_sync).toBe(true);
    expect(plan.reason).toContain('sync/kai');
  });

  test('memory changes run tests without forcing sync gate', () => {
    const plan = planCi([
      'hooks/MemRecall.hook.ts',
      'tests/MemoryTelemetryHooks.test.ts',
    ], 'pull_request');

    expect(plan.run_tests).toBe(true);
    expect(plan.run_sync).toBe(false);
    expect(plan.reason).toContain('memory');
  });

  test('workflow and CI script changes run all impacted gates', () => {
    const plan = planCi([
      '.github/workflows/test.yml',
      'scripts/ci-plan.ts',
    ], 'pull_request');

    expect(plan.run_docs_spec).toBe(true);
    expect(plan.run_tests).toBe(true);
    expect(plan.run_smoke).toBe(true);
    expect(plan.run_sync).toBe(true);
    expect(plan.reason).toContain('workflow/ci');
  });

  test('generated artifacts break out of docs-only mode', () => {
    const plan = planCi([
      'docs/wiki/overview.md',
    ], 'pull_request');

    expect(plan.docs_only).toBe(false);
    expect(plan.run_tests).toBe(true);
    expect(plan.run_smoke).toBe(true);
    expect(plan.run_sync).toBe(true);
    expect(plan.run_docs_spec).toBe(true);
  });

  test('unknown empty diff fails conservative', () => {
    const plan = planCi([], 'pull_request');

    expect(plan.run_tests).toBe(true);
    expect(plan.run_smoke).toBe(true);
    expect(plan.run_sync).toBe(true);
  });
});
