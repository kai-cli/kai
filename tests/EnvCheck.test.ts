import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { checkEnvironment, formatStatus, type EnvStatus } from '../hooks/lib/env-check';
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
