import { test, expect, describe } from 'bun:test';
import { CostTracker } from '../scripts/lib/cost-tracker';

describe('CostTracker', () => {
  test('calculates Opus cost correctly', () => {
    const tracker = new CostTracker();
    const event = tracker.recordPhase('scope', 'opus', 10000, 5000);
    // Input: 10000/1M * 15 = 0.15, Output: 5000/1M * 75 = 0.375
    expect(event.costUsd).toBeCloseTo(0.525, 4);
  });

  test('calculates Sonnet cost correctly', () => {
    const tracker = new CostTracker();
    const event = tracker.recordPhase('implement', 'sonnet', 20000, 10000);
    // Input: 20000/1M * 3 = 0.06, Output: 10000/1M * 15 = 0.15
    expect(event.costUsd).toBeCloseTo(0.21, 4);
  });

  test('calculates Haiku cost correctly', () => {
    const tracker = new CostTracker();
    const event = tracker.recordPhase('verify', 'haiku', 100000, 50000);
    // Input: 100000/1M * 0.25 = 0.025, Output: 50000/1M * 1.25 = 0.0625
    expect(event.costUsd).toBeCloseTo(0.0875, 4);
  });

  test('tracks total cost across phases', () => {
    const tracker = new CostTracker();
    tracker.recordPhase('scope', 'opus', 10000, 5000);
    tracker.recordPhase('implement', 'sonnet', 20000, 10000);
    expect(tracker.getTotalCost()).toBeCloseTo(0.735, 3);
  });

  test('soft limit warning at $2.00', () => {
    const tracker = new CostTracker({ softLimitUsd: 2.0 });
    tracker.recordPhase('scope', 'opus', 100000, 20000);
    // 100000/1M * 15 + 20000/1M * 75 = 1.5 + 1.5 = 3.0
    expect(tracker.isOverSoftLimit()).toBe(true);
  });

  test('hard limit abort at $5.00', () => {
    const tracker = new CostTracker({ hardLimitUsd: 5.0 });
    tracker.recordPhase('scope', 'opus', 200000, 50000);
    // 200000/1M * 15 + 50000/1M * 75 = 3.0 + 3.75 = 6.75
    expect(tracker.isOverHardLimit()).toBe(true);
  });

  test('under soft limit returns false', () => {
    const tracker = new CostTracker({ softLimitUsd: 2.0 });
    tracker.recordPhase('verify', 'haiku', 5000, 2000);
    expect(tracker.isOverSoftLimit()).toBe(false);
  });

  test('formatTable produces valid markdown', () => {
    const tracker = new CostTracker();
    tracker.recordPhase('scope', 'opus', 10000, 5000);
    const table = tracker.formatTable();
    expect(table).toContain('## Cost Breakdown');
    expect(table).toContain('| Phase');
    expect(table).toContain('scope');
    expect(table).toContain('**Total Cost:**');
  });

  test('formatTable with no events', () => {
    const tracker = new CostTracker();
    expect(tracker.formatTable()).toBe('No cost data recorded.');
  });

  test('recordFromOutput parses token usage', () => {
    const tracker = new CostTracker();
    const output = 'Some text\nInput tokens: 8200\nOutput tokens: 3100\nMore text';
    const event = tracker.recordFromOutput('scope', 'sonnet', output);
    expect(event).not.toBeNull();
    expect(event!.inputTokens).toBe(8200);
    expect(event!.outputTokens).toBe(3100);
  });

  test('recordFromOutput returns null when no tokens found', () => {
    const tracker = new CostTracker();
    const event = tracker.recordFromOutput('scope', 'sonnet', 'No token info here');
    expect(event).toBeNull();
  });

  test('defaults unknown model to sonnet pricing', () => {
    const tracker = new CostTracker();
    const event = tracker.recordPhase('test', 'unknown-model', 1000000, 0);
    // 1M input * $3/MTok = $3.00
    expect(event.costUsd).toBeCloseTo(3.0, 4);
  });
});
