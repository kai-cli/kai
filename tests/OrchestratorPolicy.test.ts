import { describe, expect, test } from 'bun:test';
import {
  conservativeDefaultPolicy,
  type Finding,
} from '../PAI/Tools/orchestrator/schema';
import { evaluatePolicy } from '../PAI/Tools/orchestrator/policy';

function policy(overrides: Partial<ReturnType<typeof conservativeDefaultPolicy>> = {}) {
  return { ...conservativeDefaultPolicy(), autonomy: 'merge' as const, allowMerge: true, allowPush: true, ...overrides };
}

const highFinding: Finding = {
  id: 'finding-high-1',
  severity: 'high',
  category: 'bug',
  issue: 'Incorrect behavior',
  recommendation: 'Fix before merge',
  confidence: 'high',
  status: 'open',
};

describe('orchestrator policy evaluator', () => {
  test('allows merge only when all safety gates pass', () => {
    const result = evaluatePolicy({
      policy: policy(),
      requestedAction: 'merge',
      checkState: 'green',
      changedPaths: ['src/orchestrator.ts'],
      findings: [],
    });
    expect(result.allowed).toBe(true);
    expect(result.decision.status).toBe('merge-ready');
  });

  test('blocks private/public boundary risk', () => {
    const result = evaluatePolicy({
      policy: policy(),
      requestedAction: 'merge',
      checkState: 'green',
      privateBoundaryRisk: true,
    });
    expect(result.allowed).toBe(false);
    expect(result.decision.reason).toContain('Private/public boundary risk');
  });

  test('blocks red or missing CI when green CI is required', () => {
    for (const checkState of ['red', 'pending', 'missing', 'unknown'] as const) {
      const result = evaluatePolicy({
        policy: policy(),
        requestedAction: 'merge',
        checkState,
      });
      expect(result.allowed).toBe(false);
      expect(result.requiredActions).toContain('wait-for-green-ci');
    }
  });

  test('blocks merge with non-green CI even when green CI is not broadly required', () => {
    const result = evaluatePolicy({
      policy: policy({ requireGreenCI: false }),
      requestedAction: 'merge',
      checkState: 'red',
    });
    expect(result.allowed).toBe(false);
    expect(result.decision.reason).toContain('CI is not green');
    expect(result.requiredActions).toContain('wait-for-green-ci');
  });

  test('blocks push with non-green CI even when green CI is not broadly required', () => {
    const result = evaluatePolicy({
      policy: policy({ requireGreenCI: false, allowPush: true }),
      requestedAction: 'push',
      checkState: 'red',
    });
    expect(result.allowed).toBe(false);
    expect(result.decision.reason).toContain('CI is not green');
    expect(result.requiredActions).toContain('wait-for-green-ci');
  });

  test('blocks push when autonomy is advise even if allowPush is true', () => {
    const result = evaluatePolicy({
      policy: policy({ autonomy: 'advise', allowPush: true }),
      requestedAction: 'push',
      checkState: 'green',
    });
    expect(result.allowed).toBe(false);
    expect(result.decision.reason).toContain('autonomy is advise');
  });

  test('allows push when autonomy permits fixes, push is enabled, and CI is green', () => {
    const result = evaluatePolicy({
      policy: policy({ autonomy: 'fix', allowPush: true }),
      requestedAction: 'push',
      checkState: 'green',
    });
    expect(result.allowed).toBe(true);
  });

  test('blocks open high or blocker findings', () => {
    const result = evaluatePolicy({
      policy: policy(),
      requestedAction: 'merge',
      checkState: 'green',
      findings: [highFinding],
    });
    expect(result.allowed).toBe(false);
    expect(result.decision.reason).toContain('finding-high-1');
  });

  test('does not block fixed high findings or open medium findings', () => {
    const fixedHigh = { ...highFinding, status: 'fixed' as const };
    const medium = { ...highFinding, id: 'finding-medium-1', severity: 'medium' as const };
    const result = evaluatePolicy({
      policy: policy(),
      requestedAction: 'merge',
      checkState: 'green',
      findings: [fixedHigh, medium],
    });
    expect(result.allowed).toBe(true);
  });

  test('blocks changed paths under blockedPaths', () => {
    const result = evaluatePolicy({
      policy: policy(),
      requestedAction: 'fix',
      checkState: 'green',
      changedPaths: ['MEMORY/private.md'],
    });
    expect(result.allowed).toBe(false);
    expect(result.decision.reason).toContain('blocked by policy');
  });

  test('blocks changed paths outside allowedPaths', () => {
    const result = evaluatePolicy({
      policy: policy({ allowedPaths: ['src/**'] }),
      requestedAction: 'fix',
      checkState: 'green',
      changedPaths: ['tests/example.test.ts'],
    });
    expect(result.allowed).toBe(false);
    expect(result.decision.reason).toContain('outside allowed paths');
  });

  test('allows nested files under allowed globstar paths', () => {
    const result = evaluatePolicy({
      policy: policy({ allowedPaths: ['docs/**'], blockedPaths: [] }),
      requestedAction: 'fix',
      checkState: 'green',
      changedPaths: ['docs/planning/example-plan.md'],
    });
    expect(result.allowed).toBe(true);
  });

  test('blocks malformed agent output', () => {
    const result = evaluatePolicy({
      policy: policy(),
      requestedAction: 'fix',
      checkState: 'green',
      malformedAgentOutput: true,
    });
    expect(result.allowed).toBe(false);
    expect(result.requiredActions).toContain('rerun-or-inspect-agent-output');
  });

  test('blocks invalid agent result schema', () => {
    const result = evaluatePolicy({
      policy: policy(),
      requestedAction: 'fix',
      checkState: 'green',
      agentResult: { status: 'ok' },
    });
    expect(result.allowed).toBe(false);
    expect(result.decision.reason).toContain('schema validation');
  });

  test('blocks merge when allowMerge is false even if autonomy says merge', () => {
    const result = evaluatePolicy({
      policy: policy({ allowMerge: false }),
      requestedAction: 'merge',
      checkState: 'green',
    });
    expect(result.allowed).toBe(false);
    expect(result.decision.reason).toContain('allowMerge is false');
  });

  test('blocks fix and iterate when autonomy is advise', () => {
    const result = evaluatePolicy({
      policy: conservativeDefaultPolicy(),
      requestedAction: 'iterate',
      checkState: 'green',
    });
    expect(result.allowed).toBe(false);
    expect(result.decision.reason).toContain('autonomy is advise');
  });
});
