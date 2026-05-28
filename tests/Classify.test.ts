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

  describe('ALGORITHM mode', () => {
    test('classifies action verb + technical object as ALGORITHM', () => {
      expect(classify('fix the auth bug')).toBe('ALGORITHM');
      expect(classify('build a new feature')).toBe('ALGORITHM');
      expect(classify('debug this error')).toBe('ALGORITHM');
      expect(classify('refactor the service')).toBe('ALGORITHM');
      expect(classify('analyze the logs')).toBe('ALGORITHM');
    });

    test('classifies strong dev verbs as ALGORITHM', () => {
      expect(classify('fix this')).toBe('ALGORITHM');
      expect(classify('debug the issue')).toBe('ALGORITHM');
      expect(classify('refactor my code')).toBe('ALGORITHM');
      expect(classify('investigate the problem')).toBe('ALGORITHM');
      expect(classify('troubleshoot the error')).toBe('ALGORITHM');
    });

    test('requires at least 2 words for strong dev verbs', () => {
      // Bare "fix" or "debug" without context stays NATIVE
      expect(classify('fix')).toBe('NATIVE');
      expect(classify('debug')).toBe('NATIVE');
    });

    test('classifies action verb + complexity as ALGORITHM', () => {
      const complex = 'create a new authentication system with JWT tokens and refresh logic and also add rate limiting and implement proper error handling';
      expect(classify(complex)).toBe('ALGORITHM');
    });

    test('classifies multi-step instructions as ALGORITHM', () => {
      expect(classify('first create the file and then add the tests')).toBe('ALGORITHM');
      expect(classify('step 1) analyze the code step 2) fix the bugs')).toBe('ALGORITHM');
    });

    test('recognizes technical objects', () => {
      expect(classify('update the hooks')).toBe('ALGORITHM');
      expect(classify('write some tests')).toBe('ALGORITHM');
      expect(classify('configure the database')).toBe('ALGORITHM');
      expect(classify('deploy the application')).toBe('ALGORITHM');
      expect(classify('review my code')).toBe('ALGORITHM');
    });

    test('handles plurals in technical objects', () => {
      expect(classify('fix the bugs')).toBe('ALGORITHM');
      expect(classify('update the files')).toBe('ALGORITHM');
      expect(classify('analyze the queries')).toBe('ALGORITHM');
    });
  });

  describe('NATIVE mode', () => {
    test('classifies simple questions as NATIVE', () => {
      expect(classify('what is this?')).toBe('NATIVE');
      expect(classify('how does it work?')).toBe('NATIVE');
      expect(classify('why did that happen?')).toBe('NATIVE');
    });

    test('classifies non-technical requests as NATIVE', () => {
      expect(classify('tell me about it')).toBe('NATIVE');
      expect(classify('explain this to me')).toBe('NATIVE');
      expect(classify('show me the details')).toBe('NATIVE');
    });

    test('classifies short action phrases by verb', () => {
      expect(classify('create something')).toBe('NATIVE');
      expect(classify('build that')).toBe('ALGORITHM');
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
    });

    test('handles special characters', () => {
      expect(classify('fix the "auth" bug')).toBe('ALGORITHM');
      expect(classify('update config.json file')).toBe('ALGORITHM');
      expect(classify('debug @mention feature')).toBe('ALGORITHM');
    });
  });

  describe('type safety', () => {
    test('returns one of the three valid modes', () => {
      const validModes: Mode[] = ['MINIMAL', 'ALGORITHM', 'NATIVE'];
      const result = classify('fix the bug');
      expect(validModes).toContain(result);
    });
  });
});
