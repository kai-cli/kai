/**
 * ReflectionHarvester.test.ts — Unit tests for pure functions in
 * PAI/Tools/ReflectionHarvester.ts
 *
 * Tests: tokenize, jaccard similarity, deduplicate (no LLM calls),
 * extractPatternGroups theme detection.
 *
 * Run: bun test tests/ReflectionHarvester.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { tokenize, jaccard, deduplicate, extractPatternGroups } from '../PAI/Tools/ReflectionHarvester';

// ── tokenize ──────────────────────────────────────────────────────────────────

describe('tokenize', () => {
  test('lowercases and splits on non-word chars', () => {
    const tokens = tokenize('Should have read FILE first');
    expect(tokens.has('should')).toBe(true);
    expect(tokens.has('have')).toBe(true);
    expect(tokens.has('read')).toBe(true);
    expect(tokens.has('file')).toBe(true);
    expect(tokens.has('first')).toBe(true);
  });

  test('filters out words <= 3 chars', () => {
    const tokens = tokenize('the cat sat on a mat');
    expect(tokens.has('the')).toBe(false);
    expect(tokens.has('cat')).toBe(false);
    expect(tokens.has('sat')).toBe(false);
    expect(tokens.has('on')).toBe(false);
  });

  test('returns empty set for empty string', () => {
    expect(tokenize('').size).toBe(0);
  });

  test('returns empty set for short words only', () => {
    expect(tokenize('do it now fix').size).toBe(0);
  });

  test('deduplicates repeated words', () => {
    const tokens = tokenize('should should should have');
    expect(tokens.has('should')).toBe(true);
    expect(tokens.size).toBe(2); // 'should' and 'have'
  });
});

// ── jaccard ───────────────────────────────────────────────────────────────────

describe('jaccard', () => {
  test('identical sets return 1.0', () => {
    const a = new Set(['alpha', 'beta', 'gamma']);
    expect(jaccard(a, a)).toBe(1.0);
  });

  test('disjoint sets return 0.0', () => {
    const a = new Set(['alpha', 'beta']);
    const b = new Set(['gamma', 'delta']);
    expect(jaccard(a, b)).toBe(0.0);
  });

  test('50% overlap returns ~0.33', () => {
    const a = new Set(['alpha', 'beta', 'gamma']);
    const b = new Set(['alpha', 'beta', 'delta']);
    // intersection = 2, union = 4
    expect(jaccard(a, b)).toBeCloseTo(2 / 4, 2);
  });

  test('empty sets return 0', () => {
    expect(jaccard(new Set(), new Set(['word']))).toBe(0);
    expect(jaccard(new Set(['word']), new Set())).toBe(0);
  });

  test('single shared word in larger sets', () => {
    const a = new Set(['alpha', 'beta', 'gamma', 'delta']);
    const b = new Set(['alpha', 'zeta', 'theta', 'kappa']);
    // intersection = 1, union = 7
    expect(jaccard(a, b)).toBeCloseTo(1 / 7, 2);
  });
});

// ── deduplicate ───────────────────────────────────────────────────────────────

function makeReflection(q1: string, timestamp = '2026-04-01T00:00:00Z') {
  return { timestamp, effort_level: 'standard', task_description: 'test', reflection_q1: q1 };
}

describe('deduplicate', () => {
  test('returns single reflection unchanged', () => {
    const r = [makeReflection('Should have read the target file before making changes')];
    expect(deduplicate(r)).toHaveLength(1);
  });

  test('removes near-identical reflections (>0.45 Jaccard)', () => {
    const r1 = makeReflection('Should have read the target file before making any changes to avoid conflicts', '2026-04-01T00:00:00Z');
    const r2 = makeReflection('Should have read the target file before making changes to avoid conflicts here', '2026-04-02T00:00:00Z');
    const result = deduplicate([r1, r2]);
    expect(result).toHaveLength(1);
  });

  test('keeps distinct reflections', () => {
    const r1 = makeReflection('Should have parallelized the file reading operations from the start', '2026-04-01T00:00:00Z');
    const r2 = makeReflection('Context compaction caused reconstruction friction and lost prior work', '2026-04-02T00:00:00Z');
    const result = deduplicate([r1, r2]);
    expect(result).toHaveLength(2);
  });

  test('keeps most recent of duplicates', () => {
    const older = makeReflection('Should have read target files before planning changes', '2026-03-01T00:00:00Z');
    const newer = makeReflection('Should have read target files before planning any changes here', '2026-04-01T00:00:00Z');
    const result = deduplicate([older, newer]);
    expect(result).toHaveLength(1);
    expect(result[0].timestamp).toBe('2026-04-01T00:00:00Z');
  });

  test('handles empty input', () => {
    expect(deduplicate([])).toEqual([]);
  });

  test('skips reflections with no text content', () => {
    const empty = { timestamp: '2026-04-01T00:00:00Z', effort_level: 'standard', task_description: 'test' };
    expect(deduplicate([empty])).toHaveLength(0);
  });
});

// ── extractPatternGroups ──────────────────────────────────────────────────────

describe('extractPatternGroups', () => {
  test('detects parallelize-work theme', () => {
    const reflections = [
      makeReflection('Should have parallelized the three file reads from start'),
      makeReflection('Could have run these operations concurrently rather than sequentially'),
      makeReflection('Should have batched the API calls instead of one by one'),
    ];
    const groups = extractPatternGroups(reflections);
    const parallel = groups.find(g => g.theme === 'parallelize-work');
    expect(parallel).toBeDefined();
    expect(parallel!.count).toBeGreaterThanOrEqual(2);
  });

  test('detects read-files-first theme', () => {
    const reflections = [
      makeReflection('Should have read the file first before writing the implementation'),
      makeReflection('Reading the target file upfront would have revealed half the work already done'),
      makeReflection('Pre-flight check should have included reading the existing state'),
    ];
    const groups = extractPatternGroups(reflections);
    const readFirst = groups.find(g => g.theme === 'read-files-first');
    expect(readFirst).toBeDefined();
    expect(readFirst!.count).toBeGreaterThanOrEqual(2);
  });

  test('only includes themes with >=2 occurrences', () => {
    const reflections = [
      makeReflection('Should have parallelized the reads'),  // 1 parallelize hit
      makeReflection('Something unrelated here completely'),
    ];
    const groups = extractPatternGroups(reflections);
    // All groups should have count >= 2
    for (const g of groups) {
      expect(g.count).toBeGreaterThanOrEqual(2);
    }
  });

  test('returns groups sorted by count descending', () => {
    // Many parallelize hits, fewer read-first hits
    const reflections = [
      makeReflection('Should have parallelized the concurrent operations from start'),
      makeReflection('Could have batched these parallel calls simultaneously'),
      makeReflection('Should have run these concurrently not sequentially'),
      makeReflection('Should have read the file first before writing'),
      makeReflection('Reading upfront would have saved time with pre-flight'),
    ];
    const groups = extractPatternGroups(reflections);
    for (let i = 1; i < groups.length; i++) {
      expect(groups[i - 1].count).toBeGreaterThanOrEqual(groups[i].count);
    }
  });

  test('handles empty input', () => {
    expect(extractPatternGroups([])).toEqual([]);
  });
});
