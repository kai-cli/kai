import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { emitOrchestratorComment } from '../PAI/Tools/orchestrator/comments';
import { changedPathsFromDiff, fixtureGitHubClient, REQUIRED_LIVE_WRITE_TOKEN } from '../PAI/Tools/orchestrator/github';
import { runPrReview, type PrAgentRunner } from '../PAI/Tools/orchestrator/workflows/pr-review';
import { type Decision, type Finding, type WorkItem } from '../PAI/Tools/orchestrator/schema';

function fixture(): WorkItem {
  return JSON.parse(readFileSync(join(process.cwd(), 'fixtures', 'orchestrator', 'pr-review.json'), 'utf-8'));
}

const priorFinding: Finding = {
  id: 'prior-finding',
  severity: 'medium',
  category: 'docs',
  issue: 'Prior comment finding',
  recommendation: 'Keep marker state resumable.',
  confidence: 'medium',
  status: 'open',
};

const priorDecision: Decision = {
  status: 'blocked',
  reason: 'Prior review blocked.',
};

describe('orchestrator pr-review workflow', () => {
  test('extracts changed paths from unified diffs', () => {
    expect(changedPathsFromDiff([
      'diff --git a/src/old.ts b/src/new.ts',
      '--- a/src/old.ts',
      '+++ b/src/new.ts',
      'diff --git a/docs/planning/ROADMAP.md b/docs/planning/ROADMAP.md',
      '--- a/docs/planning/ROADMAP.md',
      '+++ b/docs/planning/ROADMAP.md',
    ].join('\n'))).toEqual(['docs/planning/ROADMAP.md', 'src/new.ts', 'src/old.ts']);
  });

  test('dry-run produces review, fix, policy, and final-report artifacts without live GitHub writes', async () => {
    const github = fixtureGitHubClient();

    const result = await runPrReview(fixture(), { dryRun: true, github });

    expect(result.status).toBe('fixed');
    expect(result.policyResult.allowed).toBe(true);
    expect(result.checkState).toBe('green');
    expect(result.commentsWritten).toBe(0);
    expect(github.writes).toEqual([]);
    expect(result.packets.map((packet) => packet.role.role)).toEqual(['reviewer', 'fixer']);
    expect(result.findings.every((finding) => finding.status === 'fixed')).toBe(true);
    expect(result.artifacts.some((artifact) => artifact.type === 'packet')).toBe(true);
    expect(result.artifacts.some((artifact) => artifact.id.endsWith('review-findings'))).toBe(true);
    expect(result.artifacts.some((artifact) => artifact.id.endsWith('post-fix-findings'))).toBe(true);
    expect(result.artifacts.some((artifact) => artifact.type === 'decision')).toBe(true);
    expect(result.artifacts.some((artifact) => artifact.id.endsWith('final-report'))).toBe(true);
  });

  test('blocks PR review when changed paths hit blocked policy paths', async () => {
    const github = fixtureGitHubClient({
      diff: [
        'diff --git a/docs/planning/ROADMAP-7.x.md b/docs/planning/ROADMAP-7.x.md',
        'index 1111111..2222222 100644',
        '--- a/docs/planning/ROADMAP-7.x.md',
        '+++ b/docs/planning/ROADMAP-7.x.md',
        '@@ -1,2 +1,3 @@',
        '+private planning detail',
      ].join('\n'),
    });

    const result = await runPrReview(fixture(), { dryRun: true, github });

    expect(result.status).toBe('blocked');
    expect(result.decision.reason).toContain('Changed path is blocked by policy: docs/planning/ROADMAP-7.x.md');
    expect(result.policyResult.reasons).toContain('Blocked path changed: docs/planning/ROADMAP-7.x.md');
  });

  test('passes PR metadata, diff, check state, and existing PAI marker into review packets', async () => {
    const packets: string[] = [];
    const comment = emitOrchestratorComment({
      workItemId: fixture().id,
      source: 'https://github.com/example/project/pull/123',
      findings: [priorFinding],
      decision: priorDecision,
      updatedAt: '2026-06-27T00:00:00.000Z',
    });
    const github = fixtureGitHubClient({
      diff: 'diff --git a/src/foo.ts b/src/foo.ts\n+export const foo = true;',
      comments: [comment],
      labels: ['pai-autopilot'],
    });
    const runner: PrAgentRunner = async (packet) => {
      packets.push(JSON.stringify(packet.inputs));
      if (packet.role.role === 'reviewer') {
        return { status: 'pass', summary: 'reviewed fixture PR context', artifacts: [] };
      }
      return { status: 'fixed', summary: 'nothing to fix', artifacts: [] };
    };

    const result = await runPrReview(fixture(), { runAgent: runner, github });

    expect(result.status).toBe('complete');
    expect(packets[0]).toContain('diff --git');
    expect(packets[0]).toContain('checkState=green');
    expect(packets[0]).toContain('pai-autopilot');
    expect(packets[0]).toContain('prior-finding');
  });

  test('blocks on pending CI and records a check-state artifact', async () => {
    const github = fixtureGitHubClient({ checkState: 'pending' });

    const result = await runPrReview(fixture(), { dryRun: true, github, ciWaitTimeoutMs: 1 });

    expect(result.status).toBe('blocked');
    expect(result.decision.reason).toContain('CI is not green');
    expect(result.artifacts.some((artifact) =>
      artifact.id.endsWith('ci-state') && artifact.content?.includes('"checkState": "pending"')
    )).toBe(true);
  });

  test('blocks and records malformed review output', async () => {
    const runner: PrAgentRunner = async (packet) => {
      if (packet.role.role === 'reviewer') return { malformed: true };
      return { status: 'fixed', summary: 'fixer should not repair malformed review output', artifacts: [] };
    };

    const result = await runPrReview(fixture(), { runAgent: runner, github: fixtureGitHubClient() });

    expect(result.status).toBe('blocked');
    expect(result.policyResult.reasons).toContain('Agent output is malformed.');
    expect(result.warnings[0]).toContain('agentResult.status');
    expect(result.artifacts.some((artifact) =>
      artifact.type === 'agent-result' && artifact.content?.includes('Review result failed validation')
    )).toBe(true);
  });

  test('can persist PR workflow artifacts to the ledger when a root is provided', async () => {
    const ledgerRoot = mkdtempSync(join(tmpdir(), 'pai-pr-review-ledger-'));

    const result = await runPrReview(fixture(), { dryRun: true, ledgerRoot });

    expect(result.status).toBe('fixed');
    expect(result.artifacts.every((artifact) => artifact.path)).toBe(true);
    expect(existsSync(join(ledgerRoot, fixture().id, 'work-item.json'))).toBe(true);
    expect(existsSync(join(ledgerRoot, fixture().id, 'artifacts', `${fixture().id}-final-report.json`))).toBe(true);
  });
});

describe('orchestrator GitHub fixture write guards', () => {
  test('blocks PR comments, pushes, and merges without explicit live-write approval', async () => {
    const github = fixtureGitHubClient();

    await expect(github.upsertComment('comment')).rejects.toThrow('requires explicit live GitHub write approval');
    await expect(github.pushFixes()).rejects.toThrow('requires explicit live GitHub write approval');
    await expect(github.mergePullRequest()).rejects.toThrow('requires explicit live GitHub write approval');
    expect(github.writes).toEqual([]);
  });

  test('records fixture writes only when the explicit live-write token is supplied', async () => {
    const github = fixtureGitHubClient();
    const writeOptions = { allowLiveWrites: true, liveWriteToken: REQUIRED_LIVE_WRITE_TOKEN };

    await github.upsertComment('comment', writeOptions);
    await github.pushFixes(writeOptions);
    await github.mergePullRequest(writeOptions);

    expect(github.writes).toEqual(['comment', 'pushFixes', 'mergePullRequest']);
  });

  test('workflow comment emission is blocked without explicit live-write approval', async () => {
    const github = fixtureGitHubClient();

    const result = await runPrReview(fixture(), { dryRun: true, github, emitComment: true });

    expect(result.status).toBe('blocked');
    expect(result.commentsWritten).toBe(0);
    expect(result.decision.reason).toContain('GitHub comment write blocked');
    expect(result.artifacts.some((artifact) => artifact.type === 'pr-comment')).toBe(true);
    expect(github.writes).toEqual([]);
  });
});
