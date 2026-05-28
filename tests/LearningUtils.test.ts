import { describe, test, expect } from 'bun:test';
import { getLearningCategory, isLearningCapture } from '../hooks/lib/learning-utils';

describe('learning-utils.ts', () => {
  describe('getLearningCategory', () => {
    test('categorizes algorithm indicators as ALGORITHM', () => {
      expect(getLearningCategory('This approach was over-engineered')).toBe('ALGORITHM');
      expect(getLearningCategory('Wrong approach taken')).toBe('ALGORITHM');
      expect(getLearningCategory('Should have asked first')).toBe('ALGORITHM');
      expect(getLearningCategory('Didn\'t follow the plan')).toBe('ALGORITHM');
      expect(getLearningCategory('Missed the point entirely')).toBe('ALGORITHM');
      expect(getLearningCategory('Too complex solution')).toBe('ALGORITHM');
    });

    test('categorizes system indicators as SYSTEM', () => {
      expect(getLearningCategory('Hook crashed unexpectedly')).toBe('SYSTEM');
      expect(getLearningCategory('Tool configuration broken')).toBe('SYSTEM');
      expect(getLearningCategory('Import path not found')).toBe('SYSTEM');
      expect(getLearningCategory('TypeScript compilation failed')).toBe('SYSTEM');
      expect(getLearningCategory('Module file not found')).toBe('SYSTEM');
    });

    test('prioritizes ALGORITHM over SYSTEM', () => {
      // When both indicators present, ALGORITHM wins
      const mixed = 'Wrong approach caused hook crash';
      expect(getLearningCategory(mixed)).toBe('ALGORITHM');
    });

    test('includes comment in analysis', () => {
      expect(getLearningCategory('Fixed issue', 'over-engineered solution')).toBe('ALGORITHM');
      expect(getLearningCategory('Updated code', 'hook was broken')).toBe('SYSTEM');
    });

    test('handles case-insensitive matching', () => {
      expect(getLearningCategory('WRONG APPROACH')).toBe('ALGORITHM');
      expect(getLearningCategory('Hook Crashed')).toBe('SYSTEM');
    });

    test('defaults to ALGORITHM when no indicators match', () => {
      expect(getLearningCategory('Some random learning')).toBe('ALGORITHM');
      expect(getLearningCategory('Task completed successfully')).toBe('ALGORITHM');
      expect(getLearningCategory('')).toBe('ALGORITHM');
    });

    test('detects method and strategy keywords', () => {
      expect(getLearningCategory('Better strategy needed')).toBe('ALGORITHM');
      expect(getLearningCategory('Different method works')).toBe('ALGORITHM');
      expect(getLearningCategory('Reasoning was flawed')).toBe('ALGORITHM');
    });

    test('handles whitespace and formatting', () => {
      expect(getLearningCategory('  wrong   approach  ')).toBe('ALGORITHM');
      expect(getLearningCategory('hook\ncrashed')).toBe('SYSTEM');
    });
  });

  describe('isLearningCapture', () => {
    test('detects learning with 2+ indicators', () => {
      expect(isLearningCapture('Found a bug and fixed it')).toBe(true);
      expect(isLearningCapture('Issue discovered during troubleshooting')).toBe(true);
      expect(isLearningCapture('Error resolved after debug')).toBe(true);
    });

    test('rejects text with fewer than 2 indicators', () => {
      expect(isLearningCapture('Found something')).toBe(false);
      expect(isLearningCapture('Working on task')).toBe(false);
      expect(isLearningCapture('Updated the code')).toBe(false);
    });

    test('checks summary and analysis fields', () => {
      expect(isLearningCapture('text', 'bug found', 'issue fixed')).toBe(true);
      expect(isLearningCapture('normal text', 'discovered problem', 'root cause identified')).toBe(true);
    });

    test('detects problem + solution words (needs 2+ indicators)', () => {
      expect(isLearningCapture('problem found and solved')).toBe(true);
      expect(isLearningCapture('issue was broken but fixed')).toBe(true);
      expect(isLearningCapture('bug caused error but lesson learned')).toBe(true);
    });

    test('detects solution words', () => {
      expect(isLearningCapture('issue was fixed and resolved')).toBe(true);
      expect(isLearningCapture('discovered the problem and solved it')).toBe(true);
      expect(isLearningCapture('learned lesson from failure')).toBe(true);
    });

    test('detects investigation words', () => {
      expect(isLearningCapture('troubleshooting revealed bug')).toBe(true);
      expect(isLearningCapture('debug found root cause')).toBe(true);
      expect(isLearningCapture('investigate and discover issue')).toBe(true);
    });

    test('detects learning reflection words', () => {
      expect(isLearningCapture('lesson learned from error')).toBe(true);
      expect(isLearningCapture('takeaway from bug fix')).toBe(true);
      expect(isLearningCapture('now we know the issue')).toBe(true);
      expect(isLearningCapture('next time fix error first')).toBe(true);
    });

    test('handles case-insensitive matching', () => {
      expect(isLearningCapture('BUG FOUND AND FIXED')).toBe(true);
      expect(isLearningCapture('Issue Resolved After Debug')).toBe(true);
    });

    test('handles empty inputs', () => {
      expect(isLearningCapture('')).toBe(false);
      expect(isLearningCapture('', '', '')).toBe(false);
    });

    test('combines all text fields for analysis', () => {
      expect(isLearningCapture('found', 'the problem', 'and fixed')).toBe(true);
      expect(isLearningCapture('error', '', 'was resolved')).toBe(true);
    });

    test('requires exactly 2 or more indicators', () => {
      // 3 indicators
      expect(isLearningCapture('bug discovered and fixed after troubleshooting')).toBe(true);
      // 2 indicators
      expect(isLearningCapture('bug discovered')).toBe(true);
      // 1 indicator
      expect(isLearningCapture('bug')).toBe(false);
    });
  });
});
