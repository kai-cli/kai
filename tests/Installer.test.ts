/**
 * Installer.test.ts — Tests for PAI-Install/main.ts pure functions
 *
 * Tests the non-interactive parts: scaffold creation, identity config writing,
 * settings migration, Bedrock config, memory dirs, and timezone detection.
 *
 * Run: bun test tests/Installer.test.ts
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  writeIdentityConfig,
  createUserScaffold,
  createMemoryDirs,
  enableBedrockInPreferences,
  migrateExistingSettings,
  guessTimezone,
  USER_SCAFFOLD,
} from '../PAI-Install/main';

let tmpDir: string;

function setup() {
  tmpDir = mkdtempSync(join(tmpdir(), 'pai-installer-test-'));
  mkdirSync(join(tmpDir, 'config'), { recursive: true });
}

function cleanup() {
  rmSync(tmpDir, { recursive: true, force: true });
}

// ── writeIdentityConfig ──────────────────────────────────────────────────────

describe('writeIdentityConfig', () => {
  beforeEach(setup);
  afterEach(cleanup);

  test('writes identity.jsonc with correct values', () => {
    writeIdentityConfig(tmpDir, {
      daName: 'Orion',
      daFullName: 'Orion AI',
      daDisplayName: 'Orion',
      daColor: '#FF5733',
      daCatchphrase: 'Orion ready',
      principalName: 'Alice',
      principalTimezone: 'America/New_York',
    });

    const content = readFileSync(join(tmpDir, 'config', 'identity.jsonc'), 'utf-8');
    expect(content).toContain('"name": "Orion"');
    expect(content).toContain('"fullName": "Orion AI"');
    expect(content).toContain('"color": "#FF5733"');
    expect(content).toContain('"startupCatchphrase": "Orion ready"');
    expect(content).toContain('"name": "Alice"');
    expect(content).toContain('"timezone": "America/New_York"');
  });

  test('handles special characters in names', () => {
    writeIdentityConfig(tmpDir, {
      daName: 'O\'Reilly "The Bot"',
      daFullName: 'O\'Reilly',
      daDisplayName: 'O\'Reilly',
      daColor: '#000',
      daCatchphrase: 'Hello\nWorld',
      principalName: 'José García',
      principalTimezone: 'Europe/Madrid',
    });

    const content = readFileSync(join(tmpDir, 'config', 'identity.jsonc'), 'utf-8');
    expect(content).toContain("O'Reilly");
    expect(content).toContain('José García');
  });

  test('output is parseable as JSONC', () => {
    writeIdentityConfig(tmpDir, {
      daName: 'Test',
      daFullName: 'Test',
      daDisplayName: 'Test',
      daColor: '#FFF',
      daCatchphrase: 'Go',
      principalName: 'User',
      principalTimezone: 'UTC',
    });

    const raw = readFileSync(join(tmpDir, 'config', 'identity.jsonc'), 'utf-8');
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(?<!:)\/\/[^\n]*/g, '')
      .replace(/,(\s*[}\]])/g, '$1');
    const parsed = JSON.parse(stripped);
    expect(parsed.daidentity.name).toBe('Test');
    expect(parsed.principal.name).toBe('User');
  });
});

// ── createUserScaffold ───────────────────────────────────────────────────────

describe('createUserScaffold', () => {
  beforeEach(setup);
  afterEach(cleanup);

  test('creates all scaffold files in empty directory', () => {
    const count = createUserScaffold(tmpDir);
    expect(count).toBe(Object.keys(USER_SCAFFOLD).length);

    for (const relPath of Object.keys(USER_SCAFFOLD)) {
      expect(existsSync(join(tmpDir, relPath))).toBe(true);
    }
  });

  test('skips files that already exist', () => {
    createUserScaffold(tmpDir);
    const secondCount = createUserScaffold(tmpDir);
    expect(secondCount).toBe(0);
  });

  test('creates only missing files on partial scaffold', () => {
    const firstFile = Object.keys(USER_SCAFFOLD)[0];
    const dir = join(tmpDir, firstFile.substring(0, firstFile.lastIndexOf('/')));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(tmpDir, firstFile), 'custom content');

    const count = createUserScaffold(tmpDir);
    expect(count).toBe(Object.keys(USER_SCAFFOLD).length - 1);

    const preserved = readFileSync(join(tmpDir, firstFile), 'utf-8');
    expect(preserved).toBe('custom content');
  });

  test('creates nested directory structure', () => {
    createUserScaffold(tmpDir);
    expect(existsSync(join(tmpDir, 'PAI', 'USER', 'TELOS'))).toBe(true);
    expect(existsSync(join(tmpDir, 'PAI', 'USER', 'PROJECTS'))).toBe(true);
  });
});

// ── createMemoryDirs ─────────────────────────────────────────────────────────

describe('createMemoryDirs', () => {
  beforeEach(setup);
  afterEach(cleanup);

  test('creates all MEMORY subdirectories', () => {
    createMemoryDirs(tmpDir);
    const expected = ['STATE', 'WORK', 'DECISIONS', 'SNAPSHOTS', 'RESEARCH'];
    for (const sub of expected) {
      expect(existsSync(join(tmpDir, 'MEMORY', sub))).toBe(true);
    }
  });

  test('creates .gitkeep in each directory', () => {
    createMemoryDirs(tmpDir);
    expect(existsSync(join(tmpDir, 'MEMORY', 'STATE', '.gitkeep'))).toBe(true);
    expect(existsSync(join(tmpDir, 'MEMORY', 'WORK', '.gitkeep'))).toBe(true);
  });

  test('is idempotent — does not overwrite existing dirs', () => {
    createMemoryDirs(tmpDir);
    writeFileSync(join(tmpDir, 'MEMORY', 'STATE', 'test.txt'), 'preserve me');
    createMemoryDirs(tmpDir);
    expect(readFileSync(join(tmpDir, 'MEMORY', 'STATE', 'test.txt'), 'utf-8')).toBe('preserve me');
  });
});

// ── migrateExistingSettings ──────────────────────────────────────────────────

describe('migrateExistingSettings', () => {
  beforeEach(setup);
  afterEach(cleanup);

  test('returns 0 for missing settings file', () => {
    const count = migrateExistingSettings(join(tmpDir, 'nonexistent.json'), tmpDir);
    expect(count).toBe(0);
  });

  test('returns 0 for invalid JSON', () => {
    const settingsPath = join(tmpDir, 'settings.json');
    writeFileSync(settingsPath, 'NOT JSON');
    expect(migrateExistingSettings(settingsPath, tmpDir)).toBe(0);
  });

  test('returns 0 for empty settings', () => {
    const settingsPath = join(tmpDir, 'settings.json');
    writeFileSync(settingsPath, '{}');
    expect(migrateExistingSettings(settingsPath, tmpDir)).toBe(0);
  });

  test('migrates custom env vars but skips PAI-managed keys', () => {
    const settingsPath = join(tmpDir, 'settings.json');
    writeFileSync(settingsPath, JSON.stringify({
      env: {
        PAI_DIR: '/should/be/skipped',
        PROJECTS_DIR: '/also/skipped',
        MY_CUSTOM_VAR: 'keep-this',
        ANOTHER_VAR: 'also-keep',
      },
    }));

    const count = migrateExistingSettings(settingsPath, tmpDir);
    expect(count).toBe(1);

    const local = readFileSync(join(tmpDir, 'config', 'preferences.local.jsonc'), 'utf-8');
    expect(local).toContain('MY_CUSTOM_VAR');
    expect(local).toContain('ANOTHER_VAR');
    expect(local).not.toContain('PAI_DIR');
    expect(local).not.toContain('PROJECTS_DIR');
  });

  test('migrates MCP servers', () => {
    const settingsPath = join(tmpDir, 'settings.json');
    writeFileSync(settingsPath, JSON.stringify({
      mcpServers: {
        myServer: { command: 'node', args: ['server.js'] },
      },
    }));

    const count = migrateExistingSettings(settingsPath, tmpDir);
    expect(count).toBe(1);

    const local = readFileSync(join(tmpDir, 'config', 'preferences.local.jsonc'), 'utf-8');
    expect(local).toContain('myServer');
  });

  test('migrates max_tokens', () => {
    const settingsPath = join(tmpDir, 'settings.json');
    writeFileSync(settingsPath, JSON.stringify({ max_tokens: 4096 }));

    const count = migrateExistingSettings(settingsPath, tmpDir);
    expect(count).toBe(1);

    const local = readFileSync(join(tmpDir, 'config', 'preferences.local.jsonc'), 'utf-8');
    expect(local).toContain('4096');
  });

  test('migrates multiple groups and counts correctly', () => {
    const settingsPath = join(tmpDir, 'settings.json');
    writeFileSync(settingsPath, JSON.stringify({
      env: { CUSTOM: 'val' },
      mcpServers: { s: {} },
      techStack: { lang: 'ts' },
      max_tokens: 8192,
      preferences: { theme: 'dark' },
      counts: { sessions: 42 },
    }));

    const count = migrateExistingSettings(settingsPath, tmpDir);
    expect(count).toBe(6);
  });
});

// ── enableBedrockInPreferences ───────────────────────────────────────────────

describe('enableBedrockInPreferences', () => {
  beforeEach(setup);
  afterEach(cleanup);

  test('uncomments and fills Bedrock block', () => {
    const prefsPath = join(tmpDir, 'config', 'preferences.jsonc');
    writeFileSync(prefsPath, `{
  "env": {
    // "CLAUDE_CODE_USE_BEDROCK": "1",
    // "AWS_REGION": "us-west-2",
    // "AWS_PROFILE": "default",
    // "ANTHROPIC_MODEL": "us.anthropic.claude-opus-4-6-v1",
    // "ANTHROPIC_SMALL_FAST_MODEL": "us.anthropic.claude-haiku-4-5-20251001-v1:0"
  }
}`);

    enableBedrockInPreferences(tmpDir, 'eu-west-1', 'my-profile', 'my-model', 'my-small-model');
    const result = readFileSync(prefsPath, 'utf-8');
    expect(result).toContain('"CLAUDE_CODE_USE_BEDROCK": "1"');
    expect(result).toContain('"AWS_REGION": "eu-west-1"');
    expect(result).toContain('"AWS_PROFILE": "my-profile"');
    expect(result).toContain('"ANTHROPIC_MODEL": "my-model"');
    expect(result).toContain('"ANTHROPIC_SMALL_FAST_MODEL": "my-small-model"');
    expect(result).not.toContain('// "CLAUDE_CODE_USE_BEDROCK"');
  });
});

// ── guessTimezone ────────────────────────────────────────────────────────────

describe('guessTimezone', () => {
  test('returns a valid IANA timezone string', () => {
    const tz = guessTimezone();
    expect(tz.length).toBeGreaterThan(0);
    expect(typeof tz).toBe('string');
  });
});
