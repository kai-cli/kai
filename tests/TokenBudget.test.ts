/**
 * TokenBudget.test.ts — Unit tests for applyTokenBudget in LoadContext.hook.ts
 *
 * Tests the priority-based truncation logic: relationship dropped first,
 * then learning, then knowledge. Partial truncation vs full drop.
 *
 * Run: bun test tests/TokenBudget.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { applyTokenBudget } from '../hooks/LoadContext.hook.ts';

const K = (n: number) => 'k'.repeat(n); // generate string of length n

describe('applyTokenBudget — within budget', () => {
  test('returns sources unchanged when under budget', () => {
    const result = applyTokenBudget(
      { knowledge: 'aaa', learning: 'bbb', relationship: 'ccc' },
      1000
    );
    expect(result.knowledge).toBe('aaa');
    expect(result.learning).toBe('bbb');
    expect(result.relationship).toBe('ccc');
  });

  test('returns unchanged when exactly at budget', () => {
    const result = applyTokenBudget(
      { knowledge: K(5000), learning: K(5000), relationship: K(5000) },
      15000
    );
    expect(result.knowledge.length).toBe(5000);
    expect(result.learning.length).toBe(5000);
    expect(result.relationship.length).toBe(5000);
  });
});

describe('applyTokenBudget — relationship dropped first (lowest priority)', () => {
  test('drops relationship when it fits excess exactly', () => {
    // knowledge=8000 + learning=6000 + relationship=2000 = 16000 total, budget=14000 → drop relationship
    const result = applyTokenBudget(
      { knowledge: K(8000), learning: K(6000), relationship: K(2000) },
      14000
    );
    expect(result.knowledge.length).toBe(8000);
    expect(result.learning.length).toBe(6000);
    expect(result.relationship).toBe('');
  });

  test('truncates relationship when partially over budget', () => {
    // total=12500, budget=12000 → need to drop 500 chars from relationship
    const result = applyTokenBudget(
      { knowledge: K(5000), learning: K(5000), relationship: K(2500) },
      12000
    );
    expect(result.knowledge.length).toBe(5000);
    expect(result.learning.length).toBe(5000);
    expect(result.relationship).toContain('[... truncated to fit token budget]');
    const contentLen = result.relationship.indexOf('\n\n[...');
    expect(contentLen).toBe(2000); // 2500 - 500 = 2000
  });
});

describe('applyTokenBudget — learning dropped second', () => {
  test('drops relationship fully then truncates learning', () => {
    // knowledge=8000 + learning=6000 + relationship=1000 = 15000, budget=10000
    // Drop relationship(1000) → still 4000 over → truncate learning
    const result = applyTokenBudget(
      { knowledge: K(8000), learning: K(6000), relationship: K(1000) },
      10000
    );
    expect(result.knowledge.length).toBe(8000);
    expect(result.relationship).toBe('');
    expect(result.learning).toContain('[... truncated');
    expect(result.learning.indexOf('\n\n[...')).toBe(2000); // 8000+2000=10000
  });

  test('drops relationship and learning when both need to go', () => {
    // knowledge=9000 + learning=4000 + relationship=3000 = 16000, budget=9000
    const result = applyTokenBudget(
      { knowledge: K(9000), learning: K(4000), relationship: K(3000) },
      9000
    );
    expect(result.knowledge.length).toBe(9000);
    expect(result.relationship).toBe('');
    expect(result.learning).toBe('');
  });
});

describe('applyTokenBudget — knowledge last resort', () => {
  test('truncates knowledge when relationship and learning both empty', () => {
    const result = applyTokenBudget(
      { knowledge: K(20000), learning: '', relationship: '' },
      10000
    );
    expect(result.relationship).toBe('');
    expect(result.learning).toBe('');
    expect(result.knowledge).toContain('[... truncated');
    expect(result.knowledge.indexOf('\n\n[...')).toBe(10000);
  });
});

describe('applyTokenBudget — edge cases', () => {
  test('handles empty sources', () => {
    const result = applyTokenBudget(
      { knowledge: '', learning: '', relationship: '' },
      16000
    );
    expect(result.knowledge).toBe('');
    expect(result.learning).toBe('');
    expect(result.relationship).toBe('');
  });

  test('handles zero budget', () => {
    const result = applyTokenBudget(
      { knowledge: 'abc', learning: 'def', relationship: 'ghi' },
      0
    );
    // All content dropped to meet budget
    expect(result.relationship).toBe('');
    expect(result.learning).toBe('');
    // knowledge may be empty or truncated to fit 0 budget
    expect((result.knowledge.length + result.learning.length + result.relationship.length)).toBeLessThanOrEqual(0 + '[... truncated to fit token budget]'.length + 2);
  });

  test('total after budget is <= budgetChars (+ truncation suffix)', () => {
    const SUFFIX = '\n\n[... truncated to fit token budget]';
    const result = applyTokenBudget(
      { knowledge: K(10000), learning: K(8000), relationship: K(5000) },
      16000
    );
    const total = result.knowledge.length + result.learning.length + result.relationship.length;
    // Total should be at or near budget (suffix adds a few chars when truncating)
    expect(total).toBeLessThanOrEqual(16000 + SUFFIX.length);
  });
});
