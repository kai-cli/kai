import { describe, test, expect } from 'bun:test';
import {
  isValidWorkingTitle,
  isValidCompletionTitle,
  isValidQuestionTitle,
  trimToValidTitle,
  getWorkingFallback,
  getQuestionFallback,
  gerundToPastTense,
} from '../hooks/lib/output-validators';

describe('output-validators.ts', () => {
  describe('isValidWorkingTitle', () => {
    test('accepts valid working title with gerund', () => {
      expect(isValidWorkingTitle('Fixing auth bug.')).toBe(true);
      expect(isValidWorkingTitle('Building new feature.')).toBe(true);
      expect(isValidWorkingTitle('Analyzing test results.')).toBe(true);
    });

    test('rejects title without gerund', () => {
      expect(isValidWorkingTitle('Fixed auth bug.')).toBe(false);
      expect(isValidWorkingTitle('Built new feature.')).toBe(false);
    });

    test('rejects title without period', () => {
      expect(isValidWorkingTitle('Fixing auth bug')).toBe(false);
    });

    test('rejects title too short or too long', () => {
      expect(isValidWorkingTitle('Fixing.')).toBe(false);
      expect(isValidWorkingTitle('Fixing auth bug in production system.')).toBe(false);
    });

    test('rejects title with incomplete ending', () => {
      expect(isValidWorkingTitle('Fixing the.')).toBe(false);
      expect(isValidWorkingTitle('Building with.')).toBe(false);
      expect(isValidWorkingTitle('Analyzing for.')).toBe(false);
    });

    test('rejects title ending with dangling adverb', () => {
      expect(isValidWorkingTitle('Processing now.')).toBe(false);
      expect(isValidWorkingTitle('Analyzing here.')).toBe(false);
    });

    test('rejects generic garbage patterns', () => {
      expect(isValidWorkingTitle('Processing the task.')).toBe(false);
      expect(isValidWorkingTitle('Handling the request.')).toBe(false);
      expect(isValidWorkingTitle('Working on it.')).toBe(false);
    });

    test('rejects first-person pronouns', () => {
      expect(isValidWorkingTitle('Fixing my bug.')).toBe(false);
      expect(isValidWorkingTitle('Building for me.')).toBe(false);
    });
  });

  describe('isValidCompletionTitle', () => {
    test('accepts valid completion title', () => {
      expect(isValidCompletionTitle('Fixed auth bug.')).toBe(true);
      expect(isValidCompletionTitle('Built new feature.')).toBe(true);
      expect(isValidCompletionTitle('Analyzed test results.')).toBe(true);
    });

    test('rejects gerund (working title)', () => {
      expect(isValidCompletionTitle('Fixing auth bug.')).toBe(false);
      expect(isValidCompletionTitle('Building new feature.')).toBe(false);
    });

    test('rejects title without period', () => {
      expect(isValidCompletionTitle('Fixed auth bug')).toBe(false);
    });

    test('rejects title with incomplete ending', () => {
      expect(isValidCompletionTitle('Fixed the.')).toBe(false);
      expect(isValidCompletionTitle('Built with.')).toBe(false);
    });

    test('rejects generic garbage patterns', () => {
      expect(isValidCompletionTitle('Completed the task.')).toBe(false);
      expect(isValidCompletionTitle('Processed the request.')).toBe(false);
      expect(isValidCompletionTitle('Finished the work.')).toBe(false);
    });
  });

  describe('isValidQuestionTitle', () => {
    test('accepts valid question title', () => {
      expect(isValidQuestionTitle('Auth method')).toBe(true);
      expect(isValidQuestionTitle('File path')).toBe(true);
      expect(isValidQuestionTitle('Next step')).toBe(true);
    });

    test('rejects title with period', () => {
      expect(isValidQuestionTitle('Auth method.')).toBe(false);
    });

    test('rejects title too long', () => {
      expect(isValidQuestionTitle('This is a very long question title')).toBe(false);
    });

    test('rejects title with HTML tags', () => {
      expect(isValidQuestionTitle('<Auth> method')).toBe(false);
    });

    test('rejects empty title', () => {
      expect(isValidQuestionTitle('')).toBe(false);
      expect(isValidQuestionTitle('   ')).toBe(false);
    });

    test('rejects title with too many words', () => {
      expect(isValidQuestionTitle('one two three four five')).toBe(false);
    });

    test('accepts single word', () => {
      expect(isValidQuestionTitle('Method')).toBe(true);
    });
  });

  describe('trimToValidTitle', () => {
    test('returns first valid title from words', () => {
      const words = ['Fixing', 'auth', 'bug', 'in', 'production'];
      const result = trimToValidTitle(words, isValidWorkingTitle, 4);
      expect(result).toBe('Fixing auth bug.');
    });

    test('falls back to shorter title if longer invalid', () => {
      const words = ['Fixing', 'the', 'issue', 'now'];
      const result = trimToValidTitle(words, isValidWorkingTitle, 4);
      // "Fixing the issue." is valid (3 words)
      expect(result).toBe('Fixing the issue.');
    });

    test('returns null if no valid title found', () => {
      const words = ['the', 'and', 'with'];
      const result = trimToValidTitle(words, isValidWorkingTitle, 4);
      expect(result).toBe(null);
    });

    test('respects maxWords limit', () => {
      const words = ['Fixing', 'auth', 'bug'];
      const result = trimToValidTitle(words, isValidWorkingTitle, 2);
      expect(result).toBe('Fixing auth.');
    });

    test('strips trailing punctuation before adding period', () => {
      const words = ['Fixing', 'auth,'];
      const result = trimToValidTitle(words, isValidWorkingTitle, 4);
      expect(result).toBe('Fixing auth.');
    });
  });

  describe('gerundToPastTense', () => {
    test('converts regular gerunds to past tense', () => {
      expect(gerundToPastTense('Fixing')).toBe('Fixed');
      expect(gerundToPastTense('Adding')).toBe('Added');
      expect(gerundToPastTense('Removing')).toBe('Removed');
    });

    test('converts irregular gerunds correctly', () => {
      expect(gerundToPastTense('Building')).toBe('Built');
      expect(gerundToPastTense('Writing')).toBe('Wrote');
      expect(gerundToPastTense('Running')).toBe('Ran');
      expect(gerundToPastTense('Making')).toBe('Made');
      expect(gerundToPastTense('Finding')).toBe('Found');
    });

    test('handles doubled consonants', () => {
      expect(gerundToPastTense('Stopping')).toBe('Stopped');
      expect(gerundToPastTense('Getting')).toBe('Got');
    });

    test('handles non-gerunds unchanged', () => {
      expect(gerundToPastTense('Fixed')).toBe('Fixed');
      expect(gerundToPastTense('Done')).toBe('Done');
    });

    test('handles short words unchanged', () => {
      expect(gerundToPastTense('ing')).toBe('ing');
    });

    test('preserves capitalization', () => {
      expect(gerundToPastTense('building')).toBe('Built');
      expect(gerundToPastTense('Building')).toBe('Built');
    });
  });

  describe('fallbacks', () => {
    test('getWorkingFallback returns valid working title', () => {
      const fallback = getWorkingFallback();
      expect(isValidWorkingTitle(fallback)).toBe(true);
    });

    test('getQuestionFallback returns valid question title', () => {
      const fallback = getQuestionFallback();
      expect(isValidQuestionTitle(fallback)).toBe(true);
    });
  });
});
