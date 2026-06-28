import { describe, expect, test } from 'bun:test';

function runOrchestrator(args: string[]) {
  return Bun.spawnSync(['bun', 'PAI/Tools/Orchestrator.ts', ...args], {
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

function runPai(args: string[]) {
  return Bun.spawnSync(['bun', 'PAI/Tools/pai.ts', ...args], {
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

describe('orchestrator CLI skeleton', () => {
  test('dry-run validates a fixture without executing live engines', () => {
    const result = runOrchestrator(['run', 'fixtures/orchestrator/pr-review.json', '--dry-run']);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout.toString());
    expect(payload.status).toBe('fixed');
    expect(payload.workItemId).toBe('fixture-pr-review-001');
    expect(payload.reason).toContain('Fix round completed');
    expect(payload.checkState).toBe('green');
    expect(payload.commentsWritten).toBe(0);
    expect(payload.packets).toEqual([
      'fixture-pr-review-001-claude-reviewer-review',
      'fixture-pr-review-001-codex-fixer-fix',
    ]);
  });

  test('run without dry-run fails closed', () => {
    const result = runOrchestrator(['run', 'fixtures/orchestrator/pr-review.json']);
    expect(result.exitCode).toBe(2);
    const payload = JSON.parse(result.stdout.toString());
    expect(payload.status).toBe('blocked');
    expect(payload.reason).toContain('not implemented');
  });

  test('invalid work item fails closed', () => {
    const result = runOrchestrator(['run', 'fixtures/orchestrator/missing.json', '--dry-run']);
    expect(result.exitCode).toBe(2);
    const payload = JSON.parse(result.stdout.toString());
    expect(payload.status).toBe('failed');
    expect(payload.errors[0]).toContain('not found');
  });

  test('pai dispatcher routes adversarial-review dry-run through the workflow', () => {
    const result = runPai(['orchestrator', 'run', 'fixtures/orchestrator/adversarial-review.json', '--dry-run']);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout.toString());
    expect(payload.status).toBe('complete');
    expect(payload.workItemId).toBe('fixture-adversarial-review-001');
    expect(payload.reason).toContain('Policy permits advise');
    expect(payload.findings).toBe(1);
    expect(payload.packets).toEqual([
      'fixture-adversarial-review-001-claude-red-team-review',
      'fixture-adversarial-review-001-codex-judge-judge',
    ]);
  });
});
