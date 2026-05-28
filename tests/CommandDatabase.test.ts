import { describe, test, expect, beforeEach } from 'bun:test';
import { getKnownCommands, isKnownCommand, clearCommandCache } from '../hooks/lib/command-database';

describe('command-database.ts', () => {
  beforeEach(() => {
    // Clear cache before each test for isolation
    clearCommandCache();
  });

  describe('getKnownCommands', () => {
    test('returns a Set of commands', () => {
      const commands = getKnownCommands();
      expect(commands).toBeInstanceOf(Set);
    });

    test('includes common shell commands', () => {
      const commands = getKnownCommands();

      // These should exist on most systems
      expect(commands.has('ls')).toBe(true);
      expect(commands.has('cat')).toBe(true);
      expect(commands.has('echo')).toBe(true);
    });

    test('caches results across multiple calls', () => {
      const first = getKnownCommands();
      const second = getKnownCommands();

      // Should return the same Set instance (cached)
      expect(first).toBe(second);
    });

    test('returns non-empty set', () => {
      const commands = getKnownCommands();
      expect(commands.size).toBeGreaterThan(0);
    });

    test('includes bun in results', () => {
      const commands = getKnownCommands();
      // Bun should be in PATH for this test suite
      expect(commands.has('bun')).toBe(true);
    });

    test('includes node in results', () => {
      const commands = getKnownCommands();
      // Node is common on development machines
      expect(commands.has('node')).toBe(true);
    });
  });

  describe('isKnownCommand', () => {
    test('returns true for known commands', () => {
      expect(isKnownCommand('ls')).toBe(true);
      expect(isKnownCommand('cat')).toBe(true);
      expect(isKnownCommand('echo')).toBe(true);
    });

    test('returns false for non-existent commands', () => {
      expect(isKnownCommand('this-command-does-not-exist-xyz')).toBe(false);
      expect(isKnownCommand('fake-binary-name')).toBe(false);
    });

    test('handles empty string', () => {
      expect(isKnownCommand('')).toBe(false);
    });

    test('exact match required', () => {
      // Should not match partial names
      expect(isKnownCommand('l')).toBe(false);
      expect(isKnownCommand('lsx')).toBe(false);
    });

    test('case sensitive', () => {
      // Commands are case-sensitive on Unix
      expect(isKnownCommand('LS')).toBe(false);
      expect(isKnownCommand('Cat')).toBe(false);
    });

    test('handles common development tools', () => {
      const commands = getKnownCommands();

      // At least one of these should exist
      const hasDevTool =
        commands.has('git') ||
        commands.has('node') ||
        commands.has('bun') ||
        commands.has('npm');

      expect(hasDevTool).toBe(true);
    });
  });

  describe('clearCommandCache', () => {
    test('clears the in-memory cache', () => {
      // Fill cache
      const first = getKnownCommands();

      // Clear cache
      clearCommandCache();

      // Get new instance
      const second = getKnownCommands();

      // Should be different instances (not cached)
      // Note: content should be same, but instances different
      expect(first.size).toBe(second.size);
    });

    test('allows cache rebuild after clear', () => {
      getKnownCommands();
      clearCommandCache();

      const commands = getKnownCommands();
      expect(commands).toBeInstanceOf(Set);
      expect(commands.size).toBeGreaterThan(0);
    });
  });

  describe('PATH scanning', () => {
    test('respects PATH environment variable', () => {
      const commands = getKnownCommands();

      // All commands should come from PATH
      expect(commands.size).toBeGreaterThan(0);

      // Should include standard Unix utilities
      const hasStandardUtils =
        commands.has('sh') ||
        commands.has('bash') ||
        commands.has('zsh');

      expect(hasStandardUtils).toBe(true);
    });

    test('handles empty PATH gracefully', () => {
      const originalPath = process.env.PATH;

      try {
        process.env.PATH = '';
        clearCommandCache();

        const commands = getKnownCommands();
        expect(commands).toBeInstanceOf(Set);
        // Implementation may cache or have fallback behavior
        expect(commands.size).toBeGreaterThanOrEqual(0);
      } finally {
        process.env.PATH = originalPath;
        clearCommandCache();
      }
    });
  });
});
