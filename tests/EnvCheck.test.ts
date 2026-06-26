import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { execFileSync } from 'child_process';
import { checkEnvironment, formatStatus, detectCwdMismatch, detectLiveCheckoutDrift, type EnvStatus } from '../hooks/lib/env-check';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('env-check.ts', () => {
  const testDir = join(tmpdir(), 'pai-test-env-check');
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });

    // Save original env
    [
      'ANTHROPIC_API_KEY',
      'GITHUB_TOKEN',
      'OPENAI_API_KEY',
      'GEMINI_API_KEY',
      'XAI_API_KEY',
      'PERPLEXITY_API_KEY',
      'DEEPSEEK_API_KEY',
      'MISTRAL_API_KEY',
      'CLAUDE_CODE_USE_BEDROCK',
    ].forEach(key => {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    });
  });

  afterEach(() => {
    // Restore original env
    Object.entries(originalEnv).forEach(([key, value]) => {
      if (value !== undefined) {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    });

    rmSync(testDir, { recursive: true, force: true });
  });

  describe('checkEnvironment', () => {
    test('returns zero keys when none are set', () => {
      const status = checkEnvironment(testDir);
      expect(status.keys.set).toBe(0);
      expect(status.keys.total).toBe(8);
    });

    test('counts set API keys', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      process.env.GITHUB_TOKEN = 'test-token';

      const status = checkEnvironment(testDir);
      expect(status.keys.set).toBe(2);
      expect(status.keys.total).toBe(8);
    });

    test('counts all keys when all are set', () => {
      process.env.ANTHROPIC_API_KEY = 'key1';
      process.env.GITHUB_TOKEN = 'key2';
      process.env.OPENAI_API_KEY = 'key3';
      process.env.GEMINI_API_KEY = 'key4';
      process.env.XAI_API_KEY = 'key5';
      process.env.PERPLEXITY_API_KEY = 'key6';
      process.env.DEEPSEEK_API_KEY = 'key7';
      process.env.MISTRAL_API_KEY = 'key8';

      const status = checkEnvironment(testDir);
      expect(status.keys.set).toBe(8);
      expect(status.keys.total).toBe(8);
    });

    test('detects bedrock mode', () => {
      process.env.CLAUDE_CODE_USE_BEDROCK = '1';

      const status = checkEnvironment(testDir);
      expect(status.bedrock).toBe(true);
    });

    test('bedrock is false when not set', () => {
      const status = checkEnvironment(testDir);
      expect(status.bedrock).toBe(false);
    });

    test('reads MCP server count from settings.json', () => {
      const settingsPath = join(testDir, 'settings.json');
      const settings = {
        mcpServers: {
          github: {},
          playwright: {},
          router: {},
        },
      };
      writeFileSync(settingsPath, JSON.stringify(settings));

      const status = checkEnvironment(testDir);
      expect(status.mcp.configured).toBe(3);
    });

    test('returns zero MCP servers when settings.json missing', () => {
      const status = checkEnvironment(testDir);
      expect(status.mcp.configured).toBe(0);
    });

    test('returns zero MCP servers when mcpServers field missing', () => {
      const settingsPath = join(testDir, 'settings.json');
      writeFileSync(settingsPath, JSON.stringify({}));

      const status = checkEnvironment(testDir);
      expect(status.mcp.configured).toBe(0);
    });

    test('handles malformed settings.json gracefully', () => {
      const settingsPath = join(testDir, 'settings.json');
      writeFileSync(settingsPath, 'not valid json');

      const status = checkEnvironment(testDir);
      expect(status.mcp.configured).toBe(0);
    });

    test('sets critical warning when ANTHROPIC_API_KEY missing and not bedrock', () => {
      const status = checkEnvironment(testDir);
      expect(status.critical).toBeDefined();
      expect(status.critical).toContain('ANTHROPIC_API_KEY');
    });

    test('no critical warning when ANTHROPIC_API_KEY is set', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';

      const status = checkEnvironment(testDir);
      expect(status.critical).toBeUndefined();
    });

    test('no critical warning when bedrock mode is active', () => {
      process.env.CLAUDE_CODE_USE_BEDROCK = '1';

      const status = checkEnvironment(testDir);
      expect(status.critical).toBeUndefined();
    });
  });

  describe('detectCwdMismatch', () => {
    const home = join(testDir, 'home');
    beforeEach(() => mkdirSync(home, { recursive: true }));

    test('warns when cwd IS the home dir with no project marker', () => {
      const warning = detectCwdMismatch(home, home);
      expect(warning).toBeDefined();
      expect(warning).toContain('home directory');
    });

    test('warns when cwd is an immediate child of home with no marker (~/Projects)', () => {
      const projects = join(home, 'Projects');
      mkdirSync(projects, { recursive: true });
      const warning = detectCwdMismatch(projects, home);
      expect(warning).toBeDefined();
      expect(warning).toContain('non-project directory');
    });

    test('silent for a real project dir with .git (even directly under home)', () => {
      const proj = join(home, 'myproject');
      mkdirSync(join(proj, '.git'), { recursive: true });
      expect(detectCwdMismatch(proj, home)).toBeUndefined();
    });

    test('still WARNS for ~/Projects even with a .claude dir (the rayhunter case)', () => {
      // .claude is NOT a project marker — it's a side-effect of running claude anywhere.
      // ~/Projects/.claude exists on the real machine and is exactly the catch-all that lost data.
      const proj = join(home, 'Projects');
      mkdirSync(join(proj, '.claude'), { recursive: true });
      const warning = detectCwdMismatch(proj, home);
      expect(warning).toBeDefined();
      expect(warning).toContain('non-project directory');
    });

    test('silent for a child-of-home dir that has a real project marker (package.json)', () => {
      const proj = join(home, 'standalone');
      mkdirSync(proj, { recursive: true });
      writeFileSync(join(proj, 'package.json'), '{}');
      expect(detectCwdMismatch(proj, home)).toBeUndefined();
    });

    test('WARNS for a marker-less deep dir under ~/Projects (nested-domain blind spot)', () => {
      // A reorg into ~/Projects/<Domain>/ creates marker-less containers at depth >= 2.
      // The old immediate-child-only check went silent here — re-arming the rayhunter catch-all.
      const container = join(home, 'Projects', 'LinksysPrograms');
      mkdirSync(container, { recursive: true });
      expect(detectCwdMismatch(container, home)).toBeDefined();
    });

    test('silent for a deep dir with .git (real project, depth >= 2)', () => {
      const deep = join(home, 'Projects', 'OpenSource', 'mvt');
      mkdirSync(join(deep, '.git'), { recursive: true });
      expect(detectCwdMismatch(deep, home)).toBeUndefined();
    });

    test('silent for a deep dir with a .pai-project sentinel (non-git project leaf)', () => {
      const leaf = join(home, 'Projects', 'LinksysPrograms', 'qa');
      mkdirSync(leaf, { recursive: true });
      writeFileSync(join(leaf, '.pai-project'), '');
      expect(detectCwdMismatch(leaf, home)).toBeUndefined();
    });

    test('silent for a marker-less dir OUTSIDE the ~/Projects tree', () => {
      const elsewhere = join(home, 'Documents', 'notes');
      mkdirSync(elsewhere, { recursive: true });
      expect(detectCwdMismatch(elsewhere, home)).toBeUndefined();
    });

    test('silent when cwd or home is empty', () => {
      expect(detectCwdMismatch('', home)).toBeUndefined();
      expect(detectCwdMismatch(home, '')).toBeUndefined();
    });

    test('trailing slashes do not break home-equality detection', () => {
      const warning = detectCwdMismatch(home + '/', home);
      expect(warning).toBeDefined();
    });

    test('checkEnvironment surfaces cwdWarning for a parent dir', () => {
      process.env.ANTHROPIC_API_KEY = 'k'; // suppress critical
      const prevHome = process.env.HOME;
      process.env.HOME = home;
      try {
        const status = checkEnvironment(testDir, home);
        expect(status.cwdWarning).toBeDefined();
      } finally {
        if (prevHome !== undefined) process.env.HOME = prevHome; else delete process.env.HOME;
      }
    });
  });

  describe('detectLiveCheckoutDrift', () => {
    function git(dir: string, args: string[]): string {
      return execFileSync('git', ['-C', dir, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    }

    function makeRepo(name: string): string {
      const repo = join(testDir, name);
      mkdirSync(repo, { recursive: true });
      git(repo, ['init', '-b', 'main']);
      git(repo, ['config', 'user.name', 'Test User']);
      git(repo, ['config', 'user.email', 'test@example.com']);
      writeFileSync(join(repo, 'README.md'), '# test\n');
      git(repo, ['add', 'README.md']);
      git(repo, ['commit', '-m', 'initial']);
      return repo;
    }

    test('silent for non-git directories', () => {
      expect(detectLiveCheckoutDrift(testDir)).toBeUndefined();
    });

    test('silent for live checkout on expected branch with no upstream drift', () => {
      const repo = makeRepo('live-main-clean');
      expect(detectLiveCheckoutDrift(repo)).toBeUndefined();
    });

    test('warns when live checkout is on a feature branch', () => {
      const repo = makeRepo('live-feature');
      git(repo, ['switch', '-c', 'fix/test']);
      const warning = detectLiveCheckoutDrift(repo);
      expect(warning).toContain('fix/test');
      expect(warning).toContain('expected clean/synced `main`');
    });

    test('warns when live checkout is behind its upstream', () => {
      const remote = makeRepo('remote-behind');
      const repo = join(testDir, 'live-behind');
      execFileSync('git', ['clone', remote, repo], { stdio: ['ignore', 'pipe', 'pipe'] });
      git(repo, ['switch', 'main']);

      writeFileSync(join(remote, 'next.md'), 'new\n');
      git(remote, ['add', 'next.md']);
      git(remote, ['commit', '-m', 'remote update']);
      git(repo, ['fetch']);

      const warning = detectLiveCheckoutDrift(repo);
      expect(warning).toContain('1 commit(s) behind');
    });

    test('warns when live checkout has local commits ahead of upstream', () => {
      const remote = makeRepo('remote-ahead');
      const repo = join(testDir, 'live-ahead');
      execFileSync('git', ['clone', remote, repo], { stdio: ['ignore', 'pipe', 'pipe'] });
      git(repo, ['switch', 'main']);
      git(repo, ['config', 'user.name', 'Test User']);
      git(repo, ['config', 'user.email', 'test@example.com']);

      writeFileSync(join(repo, 'local.md'), 'local\n');
      git(repo, ['add', 'local.md']);
      git(repo, ['commit', '-m', 'local update']);

      const warning = detectLiveCheckoutDrift(repo);
      expect(warning).toContain('1 local commit(s) ahead');
    });

    test('checkEnvironment surfaces live checkout drift', () => {
      process.env.ANTHROPIC_API_KEY = 'k';
      const repo = makeRepo('env-live-feature');
      git(repo, ['switch', '-c', 'stale-pr']);
      const status = checkEnvironment(repo);
      expect(status.liveCheckoutWarning).toContain('stale-pr');
    });
  });

  describe('formatStatus', () => {
    test('formats basic status', () => {
      const status: EnvStatus = {
        keys: { set: 2, total: 8 },
        mcp: { configured: 3 },
        bedrock: false,
      };

      const formatted = formatStatus(status);
      expect(formatted).toContain('2/8 active');
      expect(formatted).toContain('3 configured');
      expect(formatted).toContain('Direct API');
    });

    test('shows bedrock mode', () => {
      const status: EnvStatus = {
        keys: { set: 0, total: 8 },
        mcp: { configured: 0 },
        bedrock: true,
      };

      const formatted = formatStatus(status);
      expect(formatted).toContain('Bedrock');
    });

    test('formats zero state', () => {
      const status: EnvStatus = {
        keys: { set: 0, total: 8 },
        mcp: { configured: 0 },
        bedrock: false,
      };

      const formatted = formatStatus(status);
      expect(formatted).toContain('0/8 active');
      expect(formatted).toContain('0 configured');
    });

    test('includes emoji indicators', () => {
      const status: EnvStatus = {
        keys: { set: 5, total: 8 },
        mcp: { configured: 2 },
        bedrock: false,
      };

      const formatted = formatStatus(status);
      expect(formatted).toContain('🔑');
      expect(formatted).toContain('🔌');
      expect(formatted).toContain('⚡');
    });

    test('formats with pipe separators', () => {
      const status: EnvStatus = {
        keys: { set: 3, total: 8 },
        mcp: { configured: 1 },
        bedrock: false,
      };

      const formatted = formatStatus(status);
      const parts = formatted.split('|');
      expect(parts.length).toBe(3);
      expect(parts[0].trim()).toContain('Keys');
      expect(parts[1].trim()).toContain('MCP');
      expect(parts[2].trim()).toContain('API');
    });
  });
});
