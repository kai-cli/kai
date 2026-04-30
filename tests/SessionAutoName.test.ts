/**
 * SessionAutoName.test.ts — Tests for hooks/SessionAutoName.hook.ts
 *
 * Covers: isNativeMode, sanitizePromptForNaming, extractFallbackName
 */

import { test, expect, describe } from 'bun:test';
import {
  isNativeMode,
  sanitizePromptForNaming,
  extractFallbackName,
} from '../hooks/SessionAutoName.hook.ts';

// ── isNativeMode ─────────────────────────────────────────────────────────────

describe('isNativeMode', () => {
  test('returns true for a plain question', () => {
    expect(isNativeMode('what is the current version?')).toBe(true);
  });

  test('returns true for a greeting', () => {
    expect(isNativeMode('hey good morning')).toBe(true);
  });

  test('returns false for algorithm trigger phrases', () => {
    // ALGO_ACTION_RE matches: implement|build|create|architect|design|migrate|deploy|refactor
    expect(isNativeMode('implement the authentication system')).toBe(false);
    expect(isNativeMode('refactor the database layer')).toBe(false);
    expect(isNativeMode('deploy to production')).toBe(false);
  });

  test('returns true for empty string', () => {
    expect(isNativeMode('')).toBe(true);
  });
});

// ── sanitizePromptForNaming ───────────────────────────────────────────────────

describe('sanitizePromptForNaming', () => {
  test('removes system-reminder blocks including content', () => {
    const input = 'fix the bug <system-reminder>secret internal context here</system-reminder> please';
    const result = sanitizePromptForNaming(input);
    expect(result).not.toContain('system-reminder');
    expect(result).not.toContain('secret internal context');
    expect(result).toContain('fix the bug');
  });

  test('removes task-notification blocks including content', () => {
    const input = 'deploy <task-notification>agent spawned xyz123</task-notification> now';
    const result = sanitizePromptForNaming(input);
    expect(result).not.toContain('task-notification');
    expect(result).not.toContain('agent spawned');
  });

  test('removes UUIDs', () => {
    const input = 'session 550e8400-e29b-41d4-a716-446655440000 is active';
    const result = sanitizePromptForNaming(input);
    expect(result).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  test('removes long hex strings (commit hashes, task IDs)', () => {
    const input = 'commit a1b2c3d4e5f6a1b2 broke the build';
    const result = sanitizePromptForNaming(input);
    expect(result).not.toContain('a1b2c3d4e5f6a1b2');
    expect(result).toContain('broke the build');
  });

  test('removes file paths', () => {
    const input = 'edit /Users/dev/projects/kai/hooks/LoadContext.hook.ts';
    const result = sanitizePromptForNaming(input);
    expect(result).not.toContain('/Users/dev');
  });

  test('preserves meaningful content', () => {
    const result = sanitizePromptForNaming('refactor authentication system');
    expect(result).toBe('refactor authentication system');
  });

  test('handles empty string', () => {
    expect(sanitizePromptForNaming('')).toBe('');
  });

  test('collapses multiple spaces', () => {
    const result = sanitizePromptForNaming('fix   the    bug');
    expect(result).toBe('fix the bug');
  });
});

// ── extractFallbackName ───────────────────────────────────────────────────────

describe('extractFallbackName', () => {
  test('returns a 4-word name from meaningful content', () => {
    const name = extractFallbackName('implement authentication system for users');
    expect(name).not.toBeNull();
    const words = name!.split(' ');
    expect(words).toHaveLength(4);
  });

  test('capitalizes each word', () => {
    const name = extractFallbackName('refactor authentication middleware pipeline');
    expect(name).not.toBeNull();
    for (const word of name!.split(' ')) {
      expect(word[0]).toBe(word[0].toUpperCase());
    }
  });

  test('returns null for all-noise input', () => {
    // All words in NOISE_WORDS
    const name = extractFallbackName('the a an it');
    expect(name).toBeNull();
  });

  test('pads to 4 words when fewer meaningful words exist', () => {
    const name = extractFallbackName('authentication');
    expect(name).not.toBeNull();
    expect(name!.split(' ')).toHaveLength(4);
  });

  test('deduplicates repeated words', () => {
    const name = extractFallbackName('deploy deploy deploy deployment service');
    expect(name).not.toBeNull();
    const words = name!.split(' ');
    const lower = words.map(w => w.toLowerCase());
    // deploy should appear at most once
    expect(lower.filter(w => w === 'deploy').length).toBeLessThanOrEqual(1);
  });

  test('filters out short words (< 3 chars)', () => {
    const name = extractFallbackName('fix an authentication bug in system');
    expect(name).not.toBeNull();
    // 'an' and 'in' are too short; result should use authentication, bug, system
    expect(name!.toLowerCase()).not.toContain(' an ');
    expect(name!.toLowerCase()).not.toContain(' in ');
  });
});
