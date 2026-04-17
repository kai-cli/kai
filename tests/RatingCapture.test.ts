/**
 * RatingCapture.test.ts — Unit tests for hooks/RatingCapture.hook.ts
 *
 * Tests: parseExplicitRating (the non-trivial regex), detectCorrections.
 * Does NOT test LLM paths (generateSuccessDraft) or file I/O (writeRating).
 *
 * Run: bun test tests/RatingCapture.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { parseExplicitRating, detectCorrections } from '../hooks/RatingCapture.hook.ts';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ── parseExplicitRating ───────────────────────────────────────────────────────

describe('parseExplicitRating — valid ratings', () => {
  test('bare number returns rating', () => {
    expect(parseExplicitRating('7')).toEqual({ rating: 7, comment: undefined });
  });

  test('10 is valid', () => {
    expect(parseExplicitRating('10')).toEqual({ rating: 10, comment: undefined });
  });

  test('1 is valid (minimum)', () => {
    expect(parseExplicitRating('1')).toEqual({ rating: 1, comment: undefined });
  });

  test('number with dash comment', () => {
    const result = parseExplicitRating('8 - good work');
    expect(result?.rating).toBe(8);
    expect(result?.comment).toBe('good work');
  });

  test('number with colon comment', () => {
    const result = parseExplicitRating('6: needs work');
    expect(result?.rating).toBe(6);
    expect(result?.comment).toBe('needs work');
  });

  test('number with space then comment', () => {
    const result = parseExplicitRating('9 excellent session');
    expect(result?.rating).toBe(9);
    expect(result?.comment).toBe('excellent session');
  });

  test('number with trailing whitespace', () => {
    expect(parseExplicitRating('7  ')).toEqual({ rating: 7, comment: undefined });
  });

  test('short praise "great job" not treated as a rating', () => {
    // "great job" starts with 'g' — not a rating
    expect(parseExplicitRating('great job')).toBeNull();
  });
});

describe('parseExplicitRating — rejected patterns (non-ratings)', () => {
  test('rejects "10/10"', () => {
    expect(parseExplicitRating('10/10')).toBeNull();
  });

  test('rejects "3.5"', () => {
    expect(parseExplicitRating('3.5')).toBeNull();
  });

  test('rejects "7th"', () => {
    expect(parseExplicitRating('7th thing')).toBeNull();
  });

  test('rejects "5 items"', () => {
    expect(parseExplicitRating('5 items')).toBeNull();
  });

  test('rejects "3 things to fix"', () => {
    expect(parseExplicitRating('3 things to fix')).toBeNull();
  });

  test('rejects "2 files"', () => {
    expect(parseExplicitRating('2 files')).toBeNull();
  });

  test('rejects "10 minutes"', () => {
    expect(parseExplicitRating('10 minutes')).toBeNull();
  });

  test('rejects "5x faster"', () => {
    expect(parseExplicitRating('5x faster')).toBeNull();
  });

  test('rejects "3 steps"', () => {
    expect(parseExplicitRating('3 steps')).toBeNull();
  });

  test('rejects "5 bugs"', () => {
    expect(parseExplicitRating('5 bugs')).toBeNull();
  });

  test('rejects empty string', () => {
    expect(parseExplicitRating('')).toBeNull();
  });

  test('rejects plain text question', () => {
    expect(parseExplicitRating('what is the status?')).toBeNull();
  });

  test('rejects "5 of the issues"', () => {
    expect(parseExplicitRating('5 of the issues')).toBeNull();
  });

  test('rejects "5 to 10 range"', () => {
    expect(parseExplicitRating('5 to 10 range')).toBeNull();
  });
});

describe('parseExplicitRating — edge cases', () => {
  test('leading/trailing whitespace is trimmed', () => {
    expect(parseExplicitRating('  8  ')).toEqual({ rating: 8, comment: undefined });
  });

  test('number followed by exclamation is valid', () => {
    const result = parseExplicitRating('10!');
    // "!" is not a letter/digit/slash/dot so it should pass
    expect(result).not.toBeNull();
    expect(result?.rating).toBe(10);
  });

  test('comment is undefined when no comment provided', () => {
    const result = parseExplicitRating('5');
    expect(result?.comment).toBeUndefined();
  });
});

// ── detectCorrections ─────────────────────────────────────────────────────────

describe('detectCorrections', () => {
  let tmpDir: string;

  function makeTranscript(messages: Array<{ role: 'user' | 'assistant'; text: string }>) {
    tmpDir = mkdtempSync(join(tmpdir(), 'pai-rating-test-'));
    const path = join(tmpDir, 'transcript.jsonl');
    const lines = messages.map(m => JSON.stringify({
      type: m.role,
      message: { content: m.text },
    }));
    writeFileSync(path, lines.join('\n'));
    return path;
  }

  function cleanup() {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  }

  test('detects "no, I meant" correction', () => {
    const path = makeTranscript([
      { role: 'user', text: 'Update the README' },
      { role: 'assistant', text: 'I updated README.md' },
      { role: 'user', text: 'no, I meant the contributing guide not README' },
    ]);
    const result = detectCorrections(path);
    expect(result.length).toBeGreaterThan(0);
    cleanup();
  });

  test('detects "that\'s not right" correction', () => {
    const path = makeTranscript([
      { role: 'user', text: 'Fix the bug' },
      { role: 'assistant', text: 'Fixed it' },
      { role: 'user', text: "that's not right, you changed the wrong function" },
    ]);
    const result = detectCorrections(path);
    expect(result.length).toBeGreaterThan(0);
    cleanup();
  });

  test('detects "wrong direction" correction', () => {
    const path = makeTranscript([
      { role: 'user', text: 'Refactor this' },
      { role: 'assistant', text: 'Refactored' },
      { role: 'user', text: 'wrong direction entirely, I wanted the other approach' },
    ]);
    const result = detectCorrections(path);
    expect(result.length).toBeGreaterThan(0);
    cleanup();
  });

  test('returns empty for clean session', () => {
    const path = makeTranscript([
      { role: 'user', text: 'Great, ship it' },
      { role: 'assistant', text: 'Done' },
      { role: 'user', text: 'Perfect, thanks' },
    ]);
    const result = detectCorrections(path);
    expect(result).toHaveLength(0);
    cleanup();
  });

  test('returns empty for nonexistent transcript', () => {
    expect(detectCorrections('/nonexistent/path.jsonl')).toHaveLength(0);
  });

  test('returns empty for empty path', () => {
    expect(detectCorrections('')).toHaveLength(0);
  });

  test('caps at 3 corrections max', () => {
    const path = makeTranscript([
      { role: 'user', text: 'no, I meant the first thing' },
      { role: 'user', text: "that's not right, try again" },
      { role: 'user', text: 'no, I meant the other file' },
      { role: 'user', text: 'wrong direction, go back' },
      { role: 'user', text: 'no, I meant the original approach' },
    ]);
    const result = detectCorrections(path);
    expect(result.length).toBeLessThanOrEqual(3);
    cleanup();
  });
});
