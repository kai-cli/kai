/**
 * SettingsSchema.test.ts — Tests for settings-schema.ts and settings-validate.ts
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { SETTINGS_SCHEMA } from '../scripts/settings-schema';
import { validateSettings, validateSettingsFile } from '../scripts/settings-validate';

const TMP = join(import.meta.dir, '../.tmp-settings-schema-test');
const VALIDATE_SCRIPT = join(import.meta.dir, '../scripts/settings-validate.ts');

function run(args: string[] = []): { stdout: string; stderr: string; code: number } {
  const result = spawnSync('bun', [VALIDATE_SCRIPT, ...args], {
    encoding: 'utf8',
    timeout: 10000,
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    code: result.status ?? 1,
  };
}

beforeAll(() => mkdirSync(TMP, { recursive: true }));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

// ── Schema structure ──────────────────────────────────────────

describe('SETTINGS_SCHEMA structure', () => {
  test('exports a schema object', () => {
    expect(typeof SETTINGS_SCHEMA).toBe('object');
    expect(SETTINGS_SCHEMA).not.toBeNull();
  });

  test('has correct $schema declaration', () => {
    expect(SETTINGS_SCHEMA.$schema).toContain('json-schema.org');
  });

  test('hooks propertyNames enum includes all Claude Code events', () => {
    const events = (SETTINGS_SCHEMA as any).properties.hooks.propertyNames.enum as string[];
    const required = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'SessionStart', 'SessionEnd', 'Stop', 'PreCompact', 'ConfigChange', 'WorktreeCreate', 'WorktreeRemove', 'TaskCompleted', 'TeammateIdle'];
    for (const e of required) {
      expect(events).toContain(e);
    }
  });

  test('permissions allows allow, deny, ask, defaultMode', () => {
    const perms = (SETTINGS_SCHEMA as any).properties.permissions.properties;
    expect(perms).toHaveProperty('allow');
    expect(perms).toHaveProperty('deny');
    expect(perms).toHaveProperty('ask');
    expect(perms).toHaveProperty('defaultMode');
  });

  test('has $defs for hookEntry and mcpServer', () => {
    const defs = (SETTINGS_SCHEMA as any).$defs;
    expect(defs).toHaveProperty('hookEntry');
    expect(defs).toHaveProperty('mcpServer');
  });

  test('pai key has version and algorithmVersion fields', () => {
    const pai = (SETTINGS_SCHEMA as any).properties.pai.properties;
    expect(pai).toHaveProperty('version');
    expect(pai).toHaveProperty('algorithmVersion');
  });
});

// ── validateSettings unit tests ───────────────────────────────

describe('validateSettings', () => {
  test('returns valid for minimal settings object', () => {
    const result = validateSettings({});
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('returns valid for settings with correct permissions', () => {
    const result = validateSettings({
      permissions: { allow: ['Read', 'Bash'], deny: [], defaultMode: 'default' },
    });
    expect(result.valid).toBe(true);
  });

  test('returns error when permissions.allow is not an array', () => {
    const result = validateSettings({
      permissions: { allow: 'Read' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('allow'))).toBe(true);
  });

  test('returns error when permissions.defaultMode is invalid enum value', () => {
    const result = validateSettings({
      permissions: { defaultMode: 'invalid-mode' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('defaultMode'))).toBe(true);
  });

  test('returns warning for unknown hook event name', () => {
    const result = validateSettings({
      hooks: {
        UnknownEvent: [{ hooks: [{ type: 'command', command: 'echo test' }] }],
      },
    });
    expect(result.warnings.some(w => w.includes('UnknownEvent'))).toBe(true);
  });

  test('returns error when hook entry missing required hooks array', () => {
    const result = validateSettings({
      hooks: {
        PreToolUse: [{ matcher: 'Bash' }],
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('hooks'))).toBe(true);
  });

  test('returns error when env value is not a string', () => {
    const result = validateSettings({
      env: { MY_VAR: 123 },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('MY_VAR'))).toBe(true);
  });

  test('returns valid for complete settings with all PAI-custom keys', () => {
    const result = validateSettings({
      env: { PAI_DIR: '/home/user/.claude' },
      permissions: { allow: ['Read'], deny: [] },
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo test' }] }],
      },
      pai: { version: '5.9.0', algorithmVersion: '3.13.0', productName: 'KAI', repoUrl: 'github.com/x' },
      daidentity: { name: 'KAI', color: 'blue' },
      counts: { skills: 44, updatedAt: '2026-01-01T00:00:00Z' },
      unknownKey: 'allowed by additionalProperties: true',
    });
    expect(result.valid).toBe(true);
  });
});

// ── validateSettingsFile unit tests ──────────────────────────

describe('validateSettingsFile', () => {
  test('returns invalid when file does not exist', () => {
    const result = validateSettingsFile(join(TMP, 'nonexistent.json'));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('not found');
  });

  test('returns invalid when file contains invalid JSON', () => {
    const path = join(TMP, 'bad.json');
    writeFileSync(path, '{ invalid json }', 'utf8');
    const result = validateSettingsFile(path);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Invalid JSON');
  });

  test('returns valid for well-formed settings file', () => {
    const path = join(TMP, 'good.json');
    writeFileSync(path, JSON.stringify({
      permissions: { allow: ['Read'], deny: [] },
      env: { MY_VAR: 'value' },
    }), 'utf8');
    const result = validateSettingsFile(path);
    expect(result.valid).toBe(true);
  });

  test('returns invalid for malformed settings file', () => {
    const path = join(TMP, 'malformed.json');
    writeFileSync(path, JSON.stringify({
      permissions: { allow: 'not-an-array' },
    }), 'utf8');
    const result = validateSettingsFile(path);
    expect(result.valid).toBe(false);
  });
});

// ── CLI tests ─────────────────────────────────────────────────

describe('settings-validate CLI', () => {
  test('exits 0 on valid settings file', () => {
    const path = join(TMP, 'cli-valid.json');
    writeFileSync(path, JSON.stringify({ env: { FOO: 'bar' } }), 'utf8');
    const r = run(['--path', path]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('OK');
  });

  test('exits 1 on invalid settings file', () => {
    const path = join(TMP, 'cli-invalid.json');
    writeFileSync(path, JSON.stringify({ permissions: { allow: 42 } }), 'utf8');
    const r = run(['--path', path]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('INVALID');
  });

  test('exits 1 on missing file', () => {
    const r = run(['--path', join(TMP, 'does-not-exist.json')]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('INVALID');
  });

  test('--json flag outputs JSON result', () => {
    const path = join(TMP, 'json-output.json');
    writeFileSync(path, JSON.stringify({ env: { X: 'y' } }), 'utf8');
    const r = run(['--path', path, '--json']);
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.valid).toBe(true);
    expect(Array.isArray(parsed.errors)).toBe(true);
    expect(Array.isArray(parsed.warnings)).toBe(true);
  });
});
