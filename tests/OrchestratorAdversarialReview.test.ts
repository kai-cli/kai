import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runAdversarialReview, type AgentRunner } from '../PAI/Tools/orchestrator/workflows/adversarial-review';
import { type WorkItem, type WorkPacket } from '../PAI/Tools/orchestrator/schema';

function fixture(): WorkItem {
  return JSON.parse(readFileSync(join(process.cwd(), 'fixtures', 'orchestrator', 'adversarial-review.json'), 'utf-8'));
}

describe('orchestrator adversarial-review workflow', () => {
  test('runs reviewer/red-team and judge packets into a synthesis decision', async () => {
    const packets: WorkPacket[] = [];
    const runner: AgentRunner = async (packet) => {
      packets.push(packet);
      if (packet.role.role === 'red-team') {
        return {
          status: 'findings',
          summary: 'red-team reviewed plan',
          artifacts: [{
            id: 'red-team-result',
            type: 'agent-result',
            source: packet.role.engine,
            content: 'red-team result',
          }],
          findings: [{
            id: 'finding-medium-1',
            severity: 'medium',
            category: 'design',
            issue: 'Rollback checkpoint is implicit.',
            recommendation: 'Make rollback checkpoint explicit before unattended execution.',
            confidence: 'high',
            status: 'open',
          }],
        };
      }
      return {
        status: 'pass',
        summary: `judge synthesized ${packet.findings?.length ?? 0} finding(s)`,
        artifacts: [{
          id: 'judge-result',
          type: 'agent-result',
          source: packet.role.engine,
          content: 'judge result',
        }],
      };
    };

    const result = await runAdversarialReview(fixture(), { runAgent: runner });

    expect(result.status).toBe('complete');
    expect(result.policyResult.allowed).toBe(true);
    expect(result.findings.map((finding) => finding.id)).toEqual(['finding-medium-1']);
    expect(packets.map((packet) => packet.role.role)).toEqual(['red-team', 'judge']);
    expect(packets[1].findings?.[0].id).toBe('finding-medium-1');
    expect(result.artifacts.some((artifact) => artifact.type === 'packet')).toBe(true);
    expect(result.artifacts.some((artifact) => artifact.type === 'finding-report')).toBe(true);
    expect(result.artifacts.some((artifact) => artifact.type === 'decision')).toBe(true);
  });

  test('blocks the synthesis decision when high findings remain open', async () => {
    const runner: AgentRunner = async (packet) => {
      if (packet.role.role === 'red-team') {
        return {
          status: 'findings',
          summary: 'red-team found a high issue',
          artifacts: [],
          findings: [{
            id: 'finding-high-1',
            severity: 'high',
            category: 'security',
            issue: 'Unattended execution has no explicit permission gate.',
            recommendation: 'Require an explicit permission gate before execution.',
            confidence: 'high',
            status: 'open',
          }],
        };
      }
      return { status: 'pass', summary: 'judge agrees this must block', artifacts: [] };
    };

    const result = await runAdversarialReview(fixture(), { runAgent: runner });

    expect(result.status).toBe('blocked');
    expect(result.policyResult.allowed).toBe(false);
    expect(result.decision.reason).toContain('Open blocker/high findings remain');
    expect(result.decision.actions).toContain('fix-or-triage-blocking-findings');
  });

  test('blocks when work item source paths hit blocked policy paths', async () => {
    const workItem = fixture();
    workItem.inputs[0] = {
      ...workItem.inputs[0],
      source: 'MEMORY/STATE/private-runtime.json',
    };

    const result = await runAdversarialReview(workItem, { dryRun: true });

    expect(result.status).toBe('blocked');
    expect(result.decision.reason).toContain('Changed path is blocked by policy: MEMORY/STATE/private-runtime.json');
    expect(result.policyResult.reasons).toContain('Blocked path changed: MEMORY/STATE/private-runtime.json');
  });

  test('blocks and records an artifact for malformed agent output', async () => {
    const runner: AgentRunner = async (packet) => {
      if (packet.role.role === 'red-team') return { malformed: true };
      return { status: 'pass', summary: 'judge should still produce output', artifacts: [] };
    };

    const result = await runAdversarialReview(fixture(), { runAgent: runner });

    expect(result.status).toBe('blocked');
    expect(result.policyResult.reasons).toContain('Agent output is malformed.');
    expect(result.warnings[0]).toContain('agentResult.status');
    expect(result.artifacts.some((artifact) =>
      artifact.type === 'agent-result' && artifact.content?.includes('Agent result failed validation')
    )).toBe(true);
  });

  test('dry-run fixture runner produces local-only artifacts without live command adapters', async () => {
    const result = await runAdversarialReview(fixture(), { dryRun: true });

    expect(result.status).toBe('complete');
    expect(result.packets.map((packet) => packet.role.role)).toEqual(['red-team', 'judge']);
    expect(result.agentResults.every((agentResult) =>
      agentResult.artifacts.every((artifact) => artifact.metadata?.dryRunFixture === true)
    )).toBe(true);
    expect(result.artifacts.map((artifact) => artifact.source)).not.toContain('github');
  });

  test('can persist workflow artifacts to the ledger when a root is provided', async () => {
    const ledgerRoot = mkdtempSync(join(tmpdir(), 'pai-adversarial-review-ledger-'));

    const result = await runAdversarialReview(fixture(), { dryRun: true, ledgerRoot });

    expect(result.status).toBe('complete');
    expect(result.artifacts.every((artifact) => artifact.path)).toBe(true);
    expect(existsSync(join(ledgerRoot, fixture().id, 'work-item.json'))).toBe(true);
    expect(existsSync(join(ledgerRoot, fixture().id, 'artifacts', `${fixture().id}-decision.json`))).toBe(true);
  });
});
