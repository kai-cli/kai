import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  conservativeDefaultPolicy,
  validateAgentResult,
  validateDecision,
  validateFinding,
  validatePolicy,
  validatePolicyResult,
  validateWorkPacket,
  validateWorkItem,
} from '../PAI/Tools/orchestrator/schema';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), 'fixtures', 'orchestrator', name), 'utf-8'));
}

describe('orchestrator schema', () => {
  test('validates the PR review fixture', () => {
    const result = validateWorkItem(fixture('pr-review.json'));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.value?.type).toBe('pr-review');
  });

  test('validates the adversarial review fixture', () => {
    const result = validateWorkItem(fixture('adversarial-review.json'));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.value?.type).toBe('adversarial-review');
  });

  test('rejects unknown workflow types', () => {
    const item = fixture('pr-review.json') as Record<string, unknown>;
    item.type = 'private-chat-bridge';
    const result = validateWorkItem(item);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('workItem.type');
  });

  test('rejects malformed findings', () => {
    const result = validateFinding({
      id: 'finding-1',
      severity: 'critical',
      category: 'bug',
      issue: 'Missing boundary check',
      recommendation: 'Add a policy guard',
      confidence: 'high',
      status: 'open',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('finding.severity');
  });

  test('validates agent results with nested findings and artifacts', () => {
    const result = validateAgentResult({
      status: 'findings',
      summary: 'One issue found.',
      artifacts: [{ id: 'artifact-1', type: 'finding-report', source: 'claude-local', content: 'report' }],
      findings: [{
        id: 'finding-1',
        severity: 'high',
        category: 'security',
        issue: 'Untrusted merge path',
        recommendation: 'Block merge until CI and policy pass',
        confidence: 'high',
        status: 'open',
      }],
    });
    expect(result.valid).toBe(true);
  });

  test('validates work packets for role-scoped agent handoff', () => {
    const item = fixture('pr-review.json') as any;
    const result = validateWorkPacket({
      id: 'packet-1',
      workItemId: item.id,
      type: item.type,
      objective: item.objective,
      role: item.roles[0],
      inputs: item.inputs,
      policy: item.policy,
      artifacts: [],
    });
    expect(result.valid).toBe(true);
    expect(result.value?.role.engine).toBe('claude-local');
  });

  test('validates decision and policy result contracts', () => {
    const decision = validateDecision({
      status: 'blocked',
      reason: 'CI is not green.',
      actions: ['wait-for-ci'],
    });
    expect(decision.valid).toBe(true);

    const policyResult = validatePolicyResult({
      allowed: false,
      decision: decision.value,
      reasons: ['CI is not green.'],
      requiredActions: ['wait-for-ci'],
    });
    expect(policyResult.valid).toBe(true);
    expect(policyResult.value?.allowed).toBe(false);
  });

  test('rejects malformed policy results', () => {
    const result = validatePolicyResult({
      allowed: 'yes',
      decision: { status: 'ship-it', reason: '' },
      reasons: 'none',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('policyResult.allowed');
    expect(result.errors.join('\n')).toContain('policyResult.decision.status');
  });

  test('conservative default policy blocks push, merge, and private boundary risk', () => {
    const policy = conservativeDefaultPolicy();
    expect(policy.autonomy).toBe('advise');
    expect(policy.allowPush).toBe(false);
    expect(policy.allowMerge).toBe(false);
    expect(policy.requireGreenCI).toBe(true);
    expect(policy.stopOnPrivateBoundaryRisk).toBe(true);
    expect(policy.blockedPaths).toContain('MEMORY/**');
  });

  test('warns when policy weakens private boundary protection', () => {
    const policy = { ...conservativeDefaultPolicy(), stopOnPrivateBoundaryRisk: false };
    const result = validatePolicy(policy);
    expect(result.valid).toBe(true);
    expect(result.warnings.join('\n')).toContain('stopOnPrivateBoundaryRisk');
  });
});
