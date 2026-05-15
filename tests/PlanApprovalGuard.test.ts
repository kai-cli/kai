import { describe, test, expect } from 'bun:test';
import { isApproval, isNewTask } from '../hooks/PlanApprovalGuard.hook';
import { detectPlanSignals, isPlanPresentation } from '../hooks/handlers/PlanDetection';

describe('PlanDetection - detectPlanSignals', () => {
  test('detects phase headers', () => {
    const text = '## Phase A: Steering\nSome content here';
    const signals = detectPlanSignals(text);
    expect(signals.hasPhaseHeader).toBe(true);
  });

  test('detects execution order header', () => {
    const text = '## Execution Order\n\n```\nPhase A → Phase B\n```';
    const signals = detectPlanSignals(text);
    expect(signals.hasPhaseHeader).toBe(true);
  });

  test('detects completion gate checkboxes', () => {
    const text = '- [ ] All tests pass\n- [x] verify-release gate passes';
    const signals = detectPlanSignals(text);
    expect(signals.hasCompletionGate).toBe(true);
  });

  test('detects time estimates', () => {
    const text = 'This phase will take ~3-4 hours across sessions';
    const signals = detectPlanSignals(text);
    expect(signals.hasTimeEstimate).toBe(true);
  });

  test('detects hours without tilde', () => {
    const text = 'Estimated: 17-20 hours total';
    const signals = detectPlanSignals(text);
    expect(signals.hasTimeEstimate).toBe(true);
  });

  test('detects execution order keyword', () => {
    const text = 'The execution order is A then B then C';
    const signals = detectPlanSignals(text);
    expect(signals.hasExecutionOrder).toBe(true);
  });

  test('returns 0 signals for normal text', () => {
    const text = 'I fixed the bug in line 42. The test now passes.';
    const signals = detectPlanSignals(text);
    expect(signals.signalCount).toBe(0);
  });

  test('counts multiple signals correctly', () => {
    const text = `## Phase A: Build
- [ ] Tests pass and verify-release completes
Total: ~4-5 hours`;
    const signals = detectPlanSignals(text);
    expect(signals.signalCount).toBeGreaterThanOrEqual(2);
  });
});

describe('PlanDetection - isPlanPresentation', () => {
  test('returns true when ≥2 signals present', () => {
    const plan = `## Phase R: Research Mode

### R1. deliberate.ts --mode research
Estimated: ~4-5 hours

## Completion Gate
- [ ] R1 implemented
- [ ] Tests pass`;
    expect(isPlanPresentation(plan)).toBe(true);
  });

  test('returns false for single signal', () => {
    const text = '## Phase A: something\nBut no other plan signals here.';
    expect(isPlanPresentation(text)).toBe(false);
  });

  test('returns false for regular code discussion', () => {
    const text = `I've updated the function to handle edge cases.
The changes are in hooks/lib/config-loader.ts.
Let me know if you want me to add tests.`;
    expect(isPlanPresentation(text)).toBe(false);
  });

  test('returns false for empty text', () => {
    expect(isPlanPresentation('')).toBe(false);
  });
});

describe('PlanApprovalGuard - isApproval', () => {
  test('detects "go ahead"', () => {
    expect(isApproval('go ahead')).toBe(true);
  });

  test('detects "do it"', () => {
    expect(isApproval('do it')).toBe(true);
  });

  test('detects "yes"', () => {
    expect(isApproval('yes')).toBe(true);
  });

  test('detects "proceed"', () => {
    expect(isApproval('proceed')).toBe(true);
  });

  test('detects "lgtm"', () => {
    expect(isApproval('lgtm')).toBe(true);
  });

  test('detects "sounds good"', () => {
    expect(isApproval('sounds good')).toBe(true);
  });

  test('detects "ok do it"', () => {
    expect(isApproval('ok do it')).toBe(true);
  });

  test('detects "let\'s go"', () => {
    expect(isApproval("let's go")).toBe(true);
  });

  test('rejects questions', () => {
    expect(isApproval('should we proceed?')).toBe(false);
  });

  test('rejects long prompts', () => {
    expect(isApproval('go ahead and also can you fix the bug in line 42 and then refactor the entire module while you are at it')).toBe(false);
  });

  test('rejects new task verbs', () => {
    expect(isApproval('can you fix the bug')).toBe(false);
  });

  test('rejects "please add tests"', () => {
    expect(isApproval('please add tests for this')).toBe(false);
  });
});

describe('PlanApprovalGuard - isNewTask', () => {
  test('detects multi-line task request', () => {
    expect(isNewTask('can you refactor this module?\nHere are the requirements:\n1. Split into files')).toBe(true);
  });

  test('detects long task request', () => {
    const longTask = 'please implement a new feature that connects to the database and retrieves all user records, transforms them into the new schema format, validates each field, and writes them back to the new table with proper error handling and logging throughout the entire process';
    expect(isNewTask(longTask)).toBe(true);
  });

  test('rejects short approval', () => {
    expect(isNewTask('yes')).toBe(false);
  });

  test('rejects short non-task', () => {
    expect(isNewTask('ok')).toBe(false);
  });
});
