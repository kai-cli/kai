import { describe, test, expect } from 'bun:test';
import { classify, type Mode } from '../hooks/lib/classify';

describe('classify.ts', () => {
  describe('MINIMAL mode', () => {
    test('classifies greetings as MINIMAL', () => {
      expect(classify('hi')).toBe('MINIMAL');
      expect(classify('hello')).toBe('MINIMAL');
      expect(classify('hey')).toBe('MINIMAL');
      expect(classify('Hi')).toBe('MINIMAL');
      expect(classify('HELLO')).toBe('MINIMAL');
    });

    test('classifies acknowledgments as MINIMAL', () => {
      expect(classify('thanks')).toBe('MINIMAL');
      expect(classify('thank you')).toBe('MINIMAL');
      expect(classify('ok')).toBe('MINIMAL');
      expect(classify('okay')).toBe('MINIMAL');
      expect(classify('got it')).toBe('MINIMAL');
      expect(classify('sure')).toBe('MINIMAL');
      expect(classify('yes')).toBe('MINIMAL');
      expect(classify('no')).toBe('MINIMAL');
    });

    test('classifies ratings as MINIMAL', () => {
      expect(classify('7')).toBe('MINIMAL');
      expect(classify('9')).toBe('MINIMAL');
      expect(classify('10')).toBe('MINIMAL');
    });

    test('handles whitespace in MINIMAL prompts', () => {
      expect(classify('  hi  ')).toBe('MINIMAL');
      expect(classify('  7  ')).toBe('MINIMAL');
    });
  });

  describe('INVESTIGATE mode', () => {
    test('classifies review/investigate verbs + technical object as INVESTIGATE', () => {
      expect(classify('review this PR')).toBe('INVESTIGATE');
      expect(classify('review my code')).toBe('INVESTIGATE');
      expect(classify('analyze the logs')).toBe('INVESTIGATE');
      expect(classify('audit the security config')).toBe('INVESTIGATE');
      expect(classify('examine the architecture')).toBe('INVESTIGATE');
    });

    test('classifies strong investigate verbs as INVESTIGATE', () => {
      expect(classify('investigate the problem')).toBe('INVESTIGATE');
      expect(classify('research this codebase')).toBe('INVESTIGATE');
      expect(classify('validate the PR changes')).toBe('INVESTIGATE');
      expect(classify('diagnose the issue')).toBe('INVESTIGATE');
      expect(classify('trace the execution path')).toBe('INVESTIGATE');
    });

    test('classifies questions about technical objects as INVESTIGATE', () => {
      expect(classify('how does this middleware work')).toBe('INVESTIGATE');
      expect(classify('what is this hook doing')).toBe('INVESTIGATE');
      expect(classify('explain the auth system')).toBe('INVESTIGATE');
    });

    test('routes to ALGORITHM when build intent is present', () => {
      // "review AND fix" → ALGORITHM because fix is a build verb
      expect(classify('review this PR and fix it')).toBe('ALGORITHM');
      expect(classify('investigate the bug and implement a fix')).toBe('ALGORITHM');
      expect(classify('analyze the code and refactor it')).toBe('ALGORITHM');
    });

    test('real-world investigation prompts', () => {
      expect(classify('review this PR and bug. validate them fully.')).toBe('INVESTIGATE');
      expect(classify('check if there is any regression in the tests')).toBe('INVESTIGATE');
      expect(classify('compare these two implementations')).toBe('INVESTIGATE');
      expect(classify('evaluate the performance of this query')).toBe('INVESTIGATE');
    });
  });

  describe('ALGORITHM mode', () => {
    test('classifies build verb + technical object as ALGORITHM', () => {
      expect(classify('fix the auth bug')).toBe('ALGORITHM');
      expect(classify('build a new feature')).toBe('ALGORITHM');
      expect(classify('debug this error')).toBe('ALGORITHM');
      expect(classify('refactor the service')).toBe('ALGORITHM');
    });

    test('classifies strong dev verbs as ALGORITHM', () => {
      expect(classify('fix this')).toBe('ALGORITHM');
      expect(classify('debug the issue')).toBe('ALGORITHM');
      expect(classify('refactor my code')).toBe('ALGORITHM');
      expect(classify('migrate the database')).toBe('ALGORITHM');
    });

    test('requires at least 2 words for strong dev verbs', () => {
      expect(classify('fix')).toBe('NATIVE');
      expect(classify('debug')).toBe('NATIVE');
    });

    test('classifies action verb + complexity as ALGORITHM', () => {
      const complex = 'create a new authentication system with JWT tokens and refresh logic and also add rate limiting and implement proper error handling';
      expect(classify(complex)).toBe('ALGORITHM');
    });

    test('classifies multi-step build instructions as ALGORITHM', () => {
      expect(classify('first create the file and then add the tests')).toBe('ALGORITHM');
      expect(classify('step 1) analyze the code step 2) fix the bugs')).toBe('ALGORITHM');
    });

    test('recognizes build verbs + technical objects', () => {
      expect(classify('update the hooks')).toBe('ALGORITHM');
      expect(classify('write some tests')).toBe('ALGORITHM');
      expect(classify('configure the database')).toBe('ALGORITHM');
      expect(classify('deploy the application')).toBe('ALGORITHM');
    });

    test('handles plurals in technical objects', () => {
      expect(classify('fix the bugs')).toBe('ALGORITHM');
      expect(classify('update the files')).toBe('ALGORITHM');
    });
  });

  describe('NATIVE mode', () => {
    test('classifies simple non-technical questions as NATIVE', () => {
      expect(classify('what is this?')).toBe('NATIVE');
      expect(classify('why did that happen?')).toBe('NATIVE');
    });

    test('classifies non-technical requests as NATIVE', () => {
      expect(classify('tell me about it')).toBe('NATIVE');
      expect(classify('show me the details')).toBe('NATIVE');
    });

    test('classifies short action phrases without technical object as NATIVE', () => {
      expect(classify('create something')).toBe('NATIVE');
    });

    test('classifies very short prompts as NATIVE', () => {
      expect(classify('go')).toBe('NATIVE');
      expect(classify('x')).toBe('NATIVE');
    });

    test('handles empty or whitespace-only input', () => {
      expect(classify('')).toBe('NATIVE');
      expect(classify('   ')).toBe('NATIVE');
    });
  });

  describe('edge cases', () => {
    test('handles prompts with only action verbs', () => {
      expect(classify('build')).toBe('ALGORITHM');
      expect(classify('create')).toBe('NATIVE');
      expect(classify('fix')).toBe('NATIVE');
    });

    test('handles prompts with only technical objects', () => {
      expect(classify('the code')).toBe('NATIVE');
      expect(classify('some tests')).toBe('NATIVE');
      expect(classify('a feature')).toBe('NATIVE');
    });

    test('handles mixed case input', () => {
      expect(classify('FIX THE AUTH BUG')).toBe('ALGORITHM');
      expect(classify('Build A NEW Feature')).toBe('ALGORITHM');
      expect(classify('REVIEW THIS PR')).toBe('INVESTIGATE');
    });

    test('handles special characters', () => {
      expect(classify('fix the "auth" bug')).toBe('ALGORITHM');
      expect(classify('update config.json file')).toBe('ALGORITHM');
      expect(classify('debug @mention feature')).toBe('ALGORITHM');
    });
  });

  describe('type safety', () => {
    test('returns one of the four valid modes', () => {
      const validModes: Mode[] = ['MINIMAL', 'INVESTIGATE', 'ALGORITHM', 'NATIVE'];
      const result = classify('fix the bug');
      expect(validModes).toContain(result);
    });
  });
});
