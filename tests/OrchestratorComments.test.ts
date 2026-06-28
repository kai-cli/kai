import { describe, expect, test } from 'bun:test';
import {
  COMMENT_MARKER_END,
  COMMENT_MARKER_START,
  emitOrchestratorComment,
  parseOrchestratorComment,
} from '../PAI/Tools/orchestrator/comments';
import type { Decision, Finding } from '../PAI/Tools/orchestrator/schema';

const finding: Finding = {
  id: 'finding-1',
  severity: 'high',
  category: 'bug',
  issue: 'The PR can merge with a failing gate.',
  recommendation: 'Require green CI before merge.',
  confidence: 'high',
  status: 'open',
  location: { path: 'src/review.ts', line: 12 },
};

const decision: Decision = {
  status: 'blocked',
  reason: 'Open high-severity finding remains.',
  actions: ['fix-or-triage-blocking-findings'],
};

describe('orchestrator PR comment markers', () => {
  test('emits a stable PAI marker with normalized JSON state', () => {
    const markdown = emitOrchestratorComment({
      workItemId: 'work-1',
      source: 'claude-local',
      updatedAt: '2026-06-26T23:30:00.000Z',
      findings: [finding],
      decision,
    });
    expect(markdown).toContain(COMMENT_MARKER_START);
    expect(markdown).toContain(COMMENT_MARKER_END);
    expect(markdown).toContain('"version": 1');
    expect(markdown).toContain('Open blocker/high findings: 1');
  });

  test('round-trips finding IDs, severities, statuses, and source metadata', () => {
    const markdown = emitOrchestratorComment({
      workItemId: 'work-1',
      source: 'claude-local',
      updatedAt: '2026-06-26T23:30:00.000Z',
      findings: [finding],
      decision,
    });
    const parsed = parseOrchestratorComment(markdown);
    expect(parsed.found).toBe(true);
    expect(parsed.errors).toEqual([]);
    expect(parsed.state?.workItemId).toBe('work-1');
    expect(parsed.state?.source).toBe('claude-local');
    expect(parsed.state?.findings[0].id).toBe('finding-1');
    expect(parsed.state?.findings[0].severity).toBe('high');
    expect(parsed.state?.findings[0].status).toBe('open');
    expect(parsed.state?.decision.status).toBe('blocked');
  });

  test('returns found false when no marker exists', () => {
    const parsed = parseOrchestratorComment('ordinary PR comment');
    expect(parsed.found).toBe(false);
    expect(parsed.errors).toEqual([]);
  });

  test('fails closed on malformed marker JSON', () => {
    const parsed = parseOrchestratorComment(`${COMMENT_MARKER_START}\nnot json\n${COMMENT_MARKER_END}`);
    expect(parsed.found).toBe(true);
    expect(parsed.errors.join('\n')).toContain('Failed to parse');
  });

  test('fails closed on malformed finding payloads', () => {
    const markdown = `${COMMENT_MARKER_START}
\`\`\`json
{
  "version": 1,
  "workItemId": "work-1",
  "source": "claude-local",
  "updatedAt": "2026-06-26T23:30:00.000Z",
  "findings": [{ "id": "bad", "severity": "critical" }],
  "decision": { "status": "blocked", "reason": "bad finding" }
}
\`\`\`
${COMMENT_MARKER_END}`;
    const parsed = parseOrchestratorComment(markdown);
    expect(parsed.found).toBe(true);
    expect(parsed.errors.join('\n')).toContain('findings[0].severity');
  });
});
