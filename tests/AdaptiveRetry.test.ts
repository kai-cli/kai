import { test, expect, describe } from 'bun:test';
import { parseSeverity, shouldRetry } from '../scripts/lib/adaptive-retry';

describe('parseSeverity', () => {
  test('detects Critical Blocker', () => {
    expect(parseSeverity('FAIL — Critical Blocker: tests still fail')).toBe('critical');
  });

  test('detects Standard Issue', () => {
    expect(parseSeverity('FAIL — Standard Issue: edge case missing')).toBe('standard');
  });

  test('detects Minor Concern', () => {
    expect(parseSeverity('FAIL — Minor Concern: could improve naming')).toBe('minor');
  });

  test('returns unknown for unrecognized output', () => {
    expect(parseSeverity('Some random QA output')).toBe('unknown');
  });

  test('case insensitive', () => {
    expect(parseSeverity('critical blocker found')).toBe('critical');
  });
});

describe('shouldRetry', () => {
  const defaultConfig = { strict: false, maxRetries: 2, currentAttempt: 0 };

  test('Critical Blocker always retries on first attempt', () => {
    const result = shouldRetry('Critical Blocker: broken', defaultConfig);
    expect(result.shouldRetry).toBe(true);
    expect(result.severity).toBe('critical');
    expect(result.deferred).toBe(false);
  });

  test('Critical Blocker retries on second attempt', () => {
    const result = shouldRetry('Critical Blocker: still broken', {
      ...defaultConfig,
      currentAttempt: 1,
    });
    expect(result.shouldRetry).toBe(true);
  });

  test('Critical Blocker stops after maxRetries', () => {
    const result = shouldRetry('Critical Blocker: still broken', {
      ...defaultConfig,
      currentAttempt: 2,
    });
    expect(result.shouldRetry).toBe(false);
  });

  test('Standard Issue retries once', () => {
    const result = shouldRetry('Standard Issue: needs work', defaultConfig);
    expect(result.shouldRetry).toBe(true);
    expect(result.severity).toBe('standard');
  });

  test('Standard Issue does not retry after first attempt', () => {
    const result = shouldRetry('Standard Issue: needs work', {
      ...defaultConfig,
      currentAttempt: 1,
    });
    expect(result.shouldRetry).toBe(false);
    expect(result.reason).toContain('escalating');
  });

  test('Minor Concern skips retry', () => {
    const result = shouldRetry('Minor Concern: naming could be better', defaultConfig);
    expect(result.shouldRetry).toBe(false);
    expect(result.deferred).toBe(true);
    expect(result.reason).toContain('deferring');
  });

  test('--strict overrides and retries everything', () => {
    const result = shouldRetry('Minor Concern: trivial', {
      ...defaultConfig,
      strict: true,
    });
    expect(result.shouldRetry).toBe(true);
    expect(result.reason).toContain('--strict');
  });

  test('--strict stops at maxRetries', () => {
    const result = shouldRetry('Minor Concern: trivial', {
      strict: true,
      maxRetries: 2,
      currentAttempt: 2,
    });
    expect(result.shouldRetry).toBe(false);
  });

  test('unknown severity retries as precaution', () => {
    const result = shouldRetry('Some random failure output', defaultConfig);
    expect(result.shouldRetry).toBe(true);
    expect(result.severity).toBe('unknown');
  });
});
