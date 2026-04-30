/**
 * LoadContext.test.ts — Tests for hooks/LoadContext.hook.ts
 *
 * Covers: isDynamicEnabled (config flag checks), applyTokenBudget (context trimming)
 */

import { test, expect, describe } from 'bun:test';
import {
  isDynamicEnabled,
  applyTokenBudget,
  type Settings,
  type DynamicContextConfig,
} from '../hooks/LoadContext.hook.ts';

// ── isDynamicEnabled ──────────────────────────────────────────────────────────

describe('isDynamicEnabled', () => {
  test('returns true when dynamicContext is absent (backward compatible default)', () => {
    const settings: Settings = {};
    expect(isDynamicEnabled(settings, 'relationshipContext')).toBe(true);
    expect(isDynamicEnabled(settings, 'learningReadback')).toBe(true);
    expect(isDynamicEnabled(settings, 'knowledgeInjection')).toBe(true);
    expect(isDynamicEnabled(settings, 'activeWorkSummary')).toBe(true);
  });

  test('returns true when dynamicContext exists but key is absent', () => {
    const settings: Settings = { dynamicContext: {} };
    expect(isDynamicEnabled(settings, 'relationshipContext')).toBe(true);
  });

  test('returns false when key is explicitly set to false', () => {
    const settings: Settings = {
      dynamicContext: { relationshipContext: false },
    };
    expect(isDynamicEnabled(settings, 'relationshipContext')).toBe(false);
  });

  test('returns true when key is explicitly set to true', () => {
    const settings: Settings = {
      dynamicContext: { learningReadback: true },
    };
    expect(isDynamicEnabled(settings, 'learningReadback')).toBe(true);
  });

  test('each key is independent', () => {
    const settings: Settings = {
      dynamicContext: {
        relationshipContext: false,
        learningReadback: true,
        knowledgeInjection: false,
        activeWorkSummary: true,
      },
    };
    expect(isDynamicEnabled(settings, 'relationshipContext')).toBe(false);
    expect(isDynamicEnabled(settings, 'learningReadback')).toBe(true);
    expect(isDynamicEnabled(settings, 'knowledgeInjection')).toBe(false);
    expect(isDynamicEnabled(settings, 'activeWorkSummary')).toBe(true);
  });
});

// ── applyTokenBudget ──────────────────────────────────────────────────────────

describe('applyTokenBudget', () => {
  const sources = {
    knowledge: 'k'.repeat(1000),
    learning: 'l'.repeat(1000),
    relationship: 'r'.repeat(1000),
  };

  test('returns all sources unchanged when total fits in budget', () => {
    const result = applyTokenBudget(sources, 10000);
    expect(result.knowledge).toBe(sources.knowledge);
    expect(result.learning).toBe(sources.learning);
    expect(result.relationship).toBe(sources.relationship);
  });

  test('total output fits within budget (allowing truncation suffix)', () => {
    // applyTokenBudget appends "\n\n[... truncated to fit token budget]" when trimming,
    // so the result may slightly exceed the raw budget by the suffix length (~40 chars).
    const budget = 1500;
    const result = applyTokenBudget(sources, budget);
    const total = result.knowledge.length + result.learning.length + result.relationship.length;
    // Allow up to 50 chars overage for the truncation suffix
    expect(total).toBeLessThanOrEqual(budget + 50);
    // And verify it's meaningfully smaller than the original 3000 chars
    expect(total).toBeLessThan(3000);
  });

  test('trims lowest-priority sources first (relationship before learning before knowledge)', () => {
    // Budget is tight — only fits ~1 source
    const result = applyTokenBudget(sources, 1200);
    // knowledge (priority 1, highest) should be most preserved
    // relationship (priority 3, lowest) should be trimmed most
    expect(result.knowledge.length).toBeGreaterThanOrEqual(result.relationship.length);
  });

  test('handles zero budget gracefully', () => {
    const result = applyTokenBudget(sources, 0);
    const total = result.knowledge.length + result.learning.length + result.relationship.length;
    expect(total).toBe(0);
  });

  test('handles empty sources', () => {
    const empty = { knowledge: '', learning: '', relationship: '' };
    const result = applyTokenBudget(empty, 1000);
    expect(result.knowledge).toBe('');
    expect(result.learning).toBe('');
    expect(result.relationship).toBe('');
  });

  test('preserves sources that individually fit within budget', () => {
    const small = {
      knowledge: 'short',
      learning: 'short',
      relationship: 'short',
    };
    const result = applyTokenBudget(small, 100);
    expect(result.knowledge).toBe('short');
    expect(result.learning).toBe('short');
    expect(result.relationship).toBe('short');
  });
});
