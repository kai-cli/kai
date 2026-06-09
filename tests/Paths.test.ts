import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { expandPath, getPaiDir, getSettingsPath, paiPath, getHooksDir, getSkillsDir, getMemoryDir, encodeProjectDir, projectMemoryDir } from '../hooks/lib/paths';
import { homedir } from 'os';

describe('paths.ts', () => {
  const originalPaiDir = process.env.PAI_DIR;

  afterAll(() => {
    if (originalPaiDir) {
      process.env.PAI_DIR = originalPaiDir;
    } else {
      delete process.env.PAI_DIR;
    }
  });

  describe('expandPath', () => {
    test('expands $HOME at start of path', () => {
      const home = homedir();
      expect(expandPath('$HOME/test')).toBe(`${home}/test`);
    });

    test('expands ${HOME} at start of path', () => {
      const home = homedir();
      expect(expandPath('${HOME}/test')).toBe(`${home}/test`);
    });

    test('expands ~ at start of path', () => {
      const home = homedir();
      expect(expandPath('~/test')).toBe(`${home}/test`);
    });

    test('does not expand $HOME in middle of path', () => {
      expect(expandPath('/prefix/$HOME/test')).toBe('/prefix/$HOME/test');
    });

    test('handles $HOME without trailing slash', () => {
      const home = homedir();
      expect(expandPath('$HOME')).toBe(home);
    });

    test('handles path without variables', () => {
      expect(expandPath('/absolute/path')).toBe('/absolute/path');
    });

    test('handles empty string', () => {
      expect(expandPath('')).toBe('');
    });
  });

  describe('getPaiDir', () => {
    test('returns PAI_DIR when set', () => {
      process.env.PAI_DIR = '/custom/pai';
      expect(getPaiDir()).toBe('/custom/pai');
    });

    test('expands $HOME in PAI_DIR', () => {
      const home = homedir();
      process.env.PAI_DIR = '$HOME/.custom-pai';
      expect(getPaiDir()).toBe(`${home}/.custom-pai`);
    });

    test('defaults to ~/.claude when PAI_DIR not set', () => {
      delete process.env.PAI_DIR;
      const home = homedir();
      expect(getPaiDir()).toBe(`${home}/.claude`);
    });
  });

  describe('getSettingsPath', () => {
    test('returns settings.json in PAI_DIR', () => {
      process.env.PAI_DIR = '/test/pai';
      expect(getSettingsPath()).toBe('/test/pai/settings.json');
    });

    test('returns settings.json in default dir when PAI_DIR not set', () => {
      delete process.env.PAI_DIR;
      const home = homedir();
      expect(getSettingsPath()).toBe(`${home}/.claude/settings.json`);
    });
  });

  describe('paiPath', () => {
    test('joins segments relative to PAI_DIR', () => {
      process.env.PAI_DIR = '/test/pai';
      expect(paiPath('hooks', 'test.ts')).toBe('/test/pai/hooks/test.ts');
    });

    test('handles single segment', () => {
      process.env.PAI_DIR = '/test/pai';
      expect(paiPath('hooks')).toBe('/test/pai/hooks');
    });

    test('handles empty segments', () => {
      process.env.PAI_DIR = '/test/pai';
      expect(paiPath()).toBe('/test/pai');
    });
  });

  describe('getHooksDir', () => {
    test('returns hooks directory in PAI_DIR', () => {
      process.env.PAI_DIR = '/test/pai';
      expect(getHooksDir()).toBe('/test/pai/hooks');
    });
  });

  describe('getSkillsDir', () => {
    test('returns skills directory in PAI_DIR', () => {
      process.env.PAI_DIR = '/test/pai';
      expect(getSkillsDir()).toBe('/test/pai/skills');
    });
  });

  describe('getMemoryDir', () => {
    test('returns MEMORY directory in PAI_DIR', () => {
      process.env.PAI_DIR = '/test/pai';
      expect(getMemoryDir()).toBe('/test/pai/MEMORY');
    });
  });

  // REGRESSION: a system-wide bug where 6 sites encoded the project dir with
  // replace(/[/_]/g,'-'), which left the '.' in the username (and spaces) intact,
  // computed a nonexistent store dir, and silently fell back to GLOBAL memory.
  // That broke ALL per-project memory loading + MemoryRecall. The canonical encoder
  // replaces EVERY non-alphanumeric char, matching how Claude Code names projects/<dir>.
  describe('encodeProjectDir', () => {
    // NOTE: use a generic dotted username (`a.b`) not a real one — these assertions are
    // scrub-safe (the kai sync rewrites real usernames, which would otherwise desync the
    // expected string from the encoder's actual output).
    test('encodes the dotted username (the bug that broke memory)', () => {
      // The previous /[/_]/ encoder left the '.' -> nonexistent dir -> global fallback.
      // The dot MUST become '-' (that was the whole bug).
      expect(encodeProjectDir('/Users/a.b/Projects/Instant_Help'))
        .toBe('-Users-a-b-Projects-Instant-Help');
    });

    test('encodes spaces (which /[/._]/ would have missed)', () => {
      expect(encodeProjectDir('/Users/a.b/Projects/Du meeting'))
        .toBe('-Users-a-b-Projects-Du-meeting');
    });

    test('encodes underscores and hyphens consistently', () => {
      expect(encodeProjectDir('/a/b_c/d-e')).toBe('-a-b-c-d-e');
    });

    test('output contains only [A-Za-z0-9-] — no dot, space, slash or underscore survives', () => {
      const encoded = encodeProjectDir('/Users/x.y/Projects/A_b C.d');
      expect(encoded).toMatch(/^[A-Za-z0-9-]+$/);
    });

    test('preserves case (real store dirs are case-sensitive)', () => {
      expect(encodeProjectDir('/Users/x/Projects/PrivacyGUI'))
        .toBe('-Users-x-Projects-PrivacyGUI');
    });
  });

  describe('projectMemoryDir', () => {
    test('resolves <paiDir>/projects/<encoded>/memory', () => {
      process.env.PAI_DIR = '/test/pai';
      expect(projectMemoryDir('/Users/a.b/Projects/Instant_Help'))
        .toBe('/test/pai/projects/-Users-a-b-Projects-Instant-Help/memory');
    });
  });
});
