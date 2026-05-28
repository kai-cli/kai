import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { parseExplicitRating, detectCorrections, CORRECTION_PATTERNS } from '../hooks/lib/rating-parser';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('rating-parser.ts', () => {
  describe('parseExplicitRating', () => {
    test('parses single digit rating', () => {
      expect(parseExplicitRating('7')).toEqual({ rating: 7, comment: undefined });
      expect(parseExplicitRating('9')).toEqual({ rating: 9, comment: undefined });
      expect(parseExplicitRating('10')).toEqual({ rating: 10, comment: undefined });
    });

    test('parses rating with comment after dash', () => {
      const result = parseExplicitRating('8 - great work');
      expect(result).toEqual({ rating: 8, comment: 'great work' });
    });

    test('parses rating with comment after colon', () => {
      const result = parseExplicitRating('7: needs improvement');
      expect(result).toEqual({ rating: 7, comment: 'needs improvement' });
    });

    test('parses rating with comment after space', () => {
      const result = parseExplicitRating('9 excellent job');
      expect(result).toEqual({ rating: 9, comment: 'excellent job' });
    });

    test('rejects rating with slash (10/10)', () => {
      expect(parseExplicitRating('10/10')).toBe(null);
    });

    test('rejects decimal rating', () => {
      expect(parseExplicitRating('3.5')).toBe(null);
      expect(parseExplicitRating('7.8')).toBe(null);
    });

    test('rejects ordinal numbers', () => {
      expect(parseExplicitRating('7th thing')).toBe(null);
      expect(parseExplicitRating('1st step')).toBe(null);
    });

    test('rejects sentences with numbers', () => {
      expect(parseExplicitRating('3 items to fix')).toBe(null);
      expect(parseExplicitRating('5 things need work')).toBe(null);
      expect(parseExplicitRating('7 bugs found')).toBe(null);
    });

    test('rejects out of range ratings', () => {
      expect(parseExplicitRating('0')).toBe(null);
      expect(parseExplicitRating('11')).toBe(null);
      expect(parseExplicitRating('-5')).toBe(null);
    });

    test('handles whitespace variations', () => {
      expect(parseExplicitRating('  8  ')).toEqual({ rating: 8, comment: undefined });
      expect(parseExplicitRating('7  -  good')).toEqual({ rating: 7, comment: 'good' });
    });

    test('rejects empty string', () => {
      expect(parseExplicitRating('')).toBe(null);
      expect(parseExplicitRating('   ')).toBe(null);
    });

    test('accepts rating with exclamation', () => {
      const result = parseExplicitRating('10!');
      expect(result).toEqual({ rating: 10, comment: '!' });
    });

    test('rejects percentage-like patterns', () => {
      expect(parseExplicitRating('5 percent')).toBe(null);
      expect(parseExplicitRating('3%')).toBe(null);
    });
  });

  describe('detectCorrections', () => {
    const testDir = join(tmpdir(), 'pai-test-rating-parser');

    beforeAll(() => {
      mkdirSync(testDir, { recursive: true });
    });

    afterAll(() => {
      rmSync(testDir, { recursive: true, force: true });
    });

    test('detects "no, I meant" pattern', () => {
      const transcriptPath = join(testDir, 'test-correction-1.jsonl');
      const lines = [
        JSON.stringify({ type: 'user', message: { content: 'Fix the bug' } }),
        JSON.stringify({ type: 'assistant', message: { content: 'Working on it' } }),
        JSON.stringify({ type: 'user', message: { content: 'No, I meant the auth bug' } }),
      ];
      writeFileSync(transcriptPath, lines.join('\n'));

      const corrections = detectCorrections(transcriptPath);
      expect(corrections.length).toBeGreaterThan(0);
      expect(corrections[0]).toContain('No, I meant');
    });

    test('detects "that\'s not" pattern', () => {
      const transcriptPath = join(testDir, 'test-correction-2.jsonl');
      const lines = [
        JSON.stringify({ type: 'user', message: { content: 'Update the file' } }),
        JSON.stringify({ type: 'assistant', message: { content: 'Updated config.js' } }),
        JSON.stringify({ type: 'user', message: { content: 'That\'s not right' } }),
      ];
      writeFileSync(transcriptPath, lines.join('\n'));

      const corrections = detectCorrections(transcriptPath);
      expect(corrections.length).toBeGreaterThan(0);
      expect(corrections[0]).toContain('not right');
    });

    test('detects "wrong direction" pattern', () => {
      const transcriptPath = join(testDir, 'test-correction-3.jsonl');
      const lines = [
        JSON.stringify({ type: 'user', message: { content: 'Build feature X' } }),
        JSON.stringify({ type: 'assistant', message: { content: 'Building feature Y' } }),
        JSON.stringify({ type: 'user', message: { content: 'Wrong direction' } }),
      ];
      writeFileSync(transcriptPath, lines.join('\n'));

      const corrections = detectCorrections(transcriptPath);
      expect(corrections.length).toBeGreaterThan(0);
      expect(corrections[0]).toContain('Wrong direction');
    });

    test('detects "stop doing" pattern', () => {
      const transcriptPath = join(testDir, 'test-correction-4.jsonl');
      const lines = [
        JSON.stringify({ type: 'user', message: { content: 'Clean up the code' } }),
        JSON.stringify({ type: 'assistant', message: { content: 'Removing comments' } }),
        JSON.stringify({ type: 'user', message: { content: 'Stop removing comments' } }),
      ];
      writeFileSync(transcriptPath, lines.join('\n'));

      const corrections = detectCorrections(transcriptPath);
      expect(corrections.length).toBeGreaterThan(0);
      expect(corrections[0]).toContain('Stop removing');
    });

    test('returns empty array for missing file', () => {
      const corrections = detectCorrections('/nonexistent/path.jsonl');
      expect(corrections).toEqual([]);
    });

    test('returns empty array for empty transcript', () => {
      const transcriptPath = join(testDir, 'test-empty.jsonl');
      writeFileSync(transcriptPath, '');

      const corrections = detectCorrections(transcriptPath);
      expect(corrections).toEqual([]);
    });

    test('returns up to 3 corrections max', () => {
      const transcriptPath = join(testDir, 'test-many-corrections.jsonl');
      const lines = [
        JSON.stringify({ type: 'user', message: { content: 'No, wait' } }),
        JSON.stringify({ type: 'user', message: { content: 'That\'s not right' } }),
        JSON.stringify({ type: 'user', message: { content: 'Wrong approach' } }),
        JSON.stringify({ type: 'user', message: { content: 'Stop doing that' } }),
        JSON.stringify({ type: 'user', message: { content: 'No, I meant something else' } }),
      ];
      writeFileSync(transcriptPath, lines.join('\n'));

      const corrections = detectCorrections(transcriptPath);
      expect(corrections.length).toBeLessThanOrEqual(3);
    });

    test('truncates corrections to 120 chars', () => {
      const transcriptPath = join(testDir, 'test-long-correction.jsonl');
      const longText = 'No, I meant ' + 'a'.repeat(200);
      const lines = [
        JSON.stringify({ type: 'user', message: { content: longText } }),
      ];
      writeFileSync(transcriptPath, lines.join('\n'));

      const corrections = detectCorrections(transcriptPath);
      expect(corrections[0].length).toBeLessThanOrEqual(120);
    });

    test('handles array-formatted message content', () => {
      const transcriptPath = join(testDir, 'test-array-content.jsonl');
      const lines = [
        JSON.stringify({
          type: 'user',
          message: {
            content: [
              { type: 'text', text: 'No, I meant the other file' },
            ],
          },
        }),
      ];
      writeFileSync(transcriptPath, lines.join('\n'));

      const corrections = detectCorrections(transcriptPath);
      expect(corrections.length).toBeGreaterThan(0);
      expect(corrections[0]).toContain('No, I meant');
    });

    test('skips malformed JSON lines', () => {
      const transcriptPath = join(testDir, 'test-malformed.jsonl');
      const lines = [
        'not valid json',
        JSON.stringify({ type: 'user', message: { content: 'No, wait' } }),
      ];
      writeFileSync(transcriptPath, lines.join('\n'));

      const corrections = detectCorrections(transcriptPath);
      expect(corrections.length).toBe(1);
    });
  });

  describe('CORRECTION_PATTERNS', () => {
    test('all patterns are valid regex', () => {
      expect(CORRECTION_PATTERNS.length).toBeGreaterThan(0);
      CORRECTION_PATTERNS.forEach(pattern => {
        expect(pattern).toBeInstanceOf(RegExp);
      });
    });
  });
});
