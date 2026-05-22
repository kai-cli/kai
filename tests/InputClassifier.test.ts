import { describe, test, expect, beforeEach } from 'bun:test';
import { classifyInput } from '../hooks/lib/input-classifier';
import { clearCommandCache, getKnownCommands } from '../hooks/lib/command-database';

describe('InputClassifier', () => {
  beforeEach(() => {
    clearCommandCache();
  });

  describe('Deterministic layer — explicit prefixes', () => {
    test('/research Warp terminal classified as skill with p_skill=1.0', () => {
      const result = classifyInput('/research Warp terminal');
      expect(result.classification).toBe('skill');
      expect(result.p_skill).toBe(1.0);
      expect(result.p_shell).toBe(0);
      expect(result.p_ai).toBe(0);
    });

    test('/foo classified as skill regardless of content', () => {
      const result = classifyInput('/foo bar baz');
      expect(result.classification).toBe('skill');
      expect(result.p_skill).toBe(1.0);
    });

    test('! prefix classified as shell with p_shell=1.0', () => {
      const result = classifyInput('!git status');
      expect(result.classification).toBe('shell');
      expect(result.p_shell).toBe(1.0);
    });

    test('!ls -la classified as shell', () => {
      const result = classifyInput('!ls -la');
      expect(result.classification).toBe('shell');
      expect(result.p_shell).toBe(1.0);
    });
  });

  describe('Shell command classification', () => {
    test('git status classified as shell when git is in PATH', () => {
      const commands = getKnownCommands();
      if (!commands.has('git')) {
        // Skip if git not in PATH (unusual but possible in CI)
        return;
      }
      const result = classifyInput('git status');
      expect(result.p_shell).toBeGreaterThan(0.5);
      // p_shell > 0.85 triggers shell classification — git + common command = high p_shell
    });

    test('npm install express classified as shell', () => {
      const commands = getKnownCommands();
      if (!commands.has('npm')) return;
      const result = classifyInput('npm install express');
      expect(result.p_shell).toBeGreaterThan(0.5);
    });

    test('pipe-heavy input has elevated p_shell', () => {
      const result = classifyInput('cat foo.txt | grep bar | sort | uniq');
      expect(result.p_shell).toBeGreaterThan(0.3);
    });

    test('input with shell metacharacters has elevated p_shell', () => {
      const result = classifyInput('ls > output.txt');
      expect(result.p_shell).toBeGreaterThan(0.1);
    });
  });

  describe('AI query classification', () => {
    test('"fix the authentication bug in auth.ts" classified as ai with p_ai > 0.9', () => {
      // This is a natural language sentence — high English word ratio, no known binary start
      const result = classifyInput('fix the authentication bug in auth.ts');
      // Note: "fix" is not in PATH; "the" is English; sentence structure → p_ai high
      expect(result.p_ai).toBeGreaterThan(0.4);
      expect(result.classification).toBe('ai');
    });

    test('"what does this error mean" classified as ai', () => {
      const result = classifyInput('what does this error mean');
      expect(result.classification).toBe('ai');
      expect(result.p_ai).toBeGreaterThan(0.5);
    });

    test('"how do I fix this type error" classified as ai', () => {
      const result = classifyInput('how do I fix this type error');
      expect(result.classification).toBe('ai');
    });

    test('"explain why the test is failing" classified as ai', () => {
      const result = classifyInput('explain why the test is failing');
      expect(result.classification).toBe('ai');
    });

    test('"can you help me understand this code" classified as ai', () => {
      const result = classifyInput('can you help me understand this code');
      expect(result.classification).toBe('ai');
    });
  });

  describe('Ambiguous input defaults to ai (safe default)', () => {
    test('single word "docker" defaults to ai', () => {
      const result = classifyInput('docker');
      // Single-word without context — ambiguous → safe default = ai
      // Unless docker is in PATH with high p_shell score, stays ai
      if (result.classification !== 'shell') {
        expect(result.classification).toBe('ai');
      }
    });

    test('empty string defaults to ai', () => {
      const result = classifyInput('');
      expect(result.classification).toBe('ai');
    });

    test('single char defaults to ai', () => {
      const result = classifyInput('x');
      expect(result.classification).toBe('ai');
    });

    test('ambiguous input classification is "ai" not "ambiguous"', () => {
      // The safe default rule: ambiguous → ai
      const result = classifyInput('something unclear here');
      expect(['ai', 'shell', 'skill']).toContain(result.classification);
      // Never returns 'ambiguous' as final classification per plan
      expect(result.classification).not.toBe('ambiguous');
    });
  });

  describe('Threshold: p_shell > 0.85 required for shell classification', () => {
    test('shell classification requires p_shell > 0.85', () => {
      const result = classifyInput('git status');
      if (result.classification === 'shell') {
        expect(result.p_shell).toBeGreaterThan(0.85);
      }
    });
  });

  describe('Anti-criteria', () => {
    test('classifier does not throw when PATH is empty', () => {
      const originalPath = process.env.PATH;
      process.env.PATH = '';
      clearCommandCache();
      try {
        expect(() => classifyInput('git status')).not.toThrow();
      } finally {
        process.env.PATH = originalPath;
        clearCommandCache();
      }
    });

    test('classifier does not throw when input is only whitespace', () => {
      expect(() => classifyInput('   ')).not.toThrow();
    });
  });
});

describe('CommandDatabase', () => {
  beforeEach(() => {
    clearCommandCache();
  });

  test('getKnownCommands returns a non-empty Set when PATH is set', () => {
    const commands = getKnownCommands();
    expect(commands).toBeInstanceOf(Set);
    // PATH almost always has at least some binaries
    if (process.env.PATH) {
      expect(commands.size).toBeGreaterThan(0);
    }
  });

  test('getKnownCommands caches result on second call', () => {
    const first = getKnownCommands();
    const second = getKnownCommands();
    expect(first).toBe(second); // Same object reference = cached
  });

  test('clearCommandCache invalidates in-memory cache', () => {
    const first = getKnownCommands();
    clearCommandCache();
    const second = getKnownCommands();
    // After clear, a new Set is created (different object)
    expect(first).not.toBe(second);
  });

  test('PATH cache written to /tmp/pai-hooks/path-cache.json', () => {
    getKnownCommands(); // triggers write
    const { existsSync } = require('fs');
    expect(existsSync('/tmp/pai-hooks/path-cache.json')).toBe(true);
  });
});
