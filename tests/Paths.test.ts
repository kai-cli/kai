import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { expandPath, getPaiDir, getSettingsPath, paiPath, getHooksDir, getSkillsDir, getMemoryDir } from '../hooks/lib/paths';
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
});
