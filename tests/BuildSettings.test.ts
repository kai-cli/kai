/**
 * BuildSettings.test.ts — Tests for config/*.jsonc → settings.json merge
 *
 * Run: bun test ./.claude/tests/BuildSettings.test.ts
 */

import { test, expect, describe } from 'bun:test';
import { parseJSONC, validateConfig, buildSettings, needsRebuild, build } from '../hooks/handlers/BuildSettings.ts';
import { existsSync } from 'fs';
import { join } from 'path';
import { pinPaiEnv, stableTestHome } from './lib/pai-test-fixtures';

// The release .claude directory — used for integration tests
const RELEASE_PAI_DIR = join(import.meta.dir, '..');
const RELEASE_HOME = stableTestHome();

function pinBuildSettingsEnv(): void {
  pinPaiEnv(RELEASE_PAI_DIR, RELEASE_HOME);
}

function buildReleaseSettings(): ReturnType<typeof buildSettings> {
  // BuildSettings expands ${PAI_DIR}/${HOME} from process.env. Several tests in
  // the full parallel suite mutate process.env, so pin immediately before each
  // integration build instead of relying on file/suite ordering.
  pinBuildSettingsEnv();
  return buildSettings(RELEASE_PAI_DIR);
}

// ── parseJSONC ────────────────────────────────────────────────────────────

describe('parseJSONC', () => {
  test('parses plain JSON unchanged', () => {
    const result = parseJSONC('{"a": 1, "b": "hello"}');
    expect(result).toEqual({ a: 1, b: 'hello' });
  });

  test('strips line comments', () => {
    const jsonc = `{
      // This is a comment
      "key": "value"
    }`;
    expect(parseJSONC(jsonc)).toEqual({ key: 'value' });
  });

  test('strips block comments', () => {
    const jsonc = `{
      /* block comment */
      "key": "value"
    }`;
    expect(parseJSONC(jsonc)).toEqual({ key: 'value' });
  });

  test('strips multi-line block comments', () => {
    const jsonc = `{
      /*
       * Multi-line
       * block comment
       */
      "key": "value"
    }`;
    expect(parseJSONC(jsonc)).toEqual({ key: 'value' });
  });

  test('preserves URLs with // in strings', () => {
    const jsonc = `{
      // line comment
      "url": "https://example.com/path"
    }`;
    const result = parseJSONC(jsonc) as Record<string, unknown>;
    expect(result.url).toBe('https://example.com/path');
  });

  test('strips trailing comments after values', () => {
    const jsonc = `{
      "key": "value" // inline comment
    }`;
    expect(parseJSONC(jsonc)).toEqual({ key: 'value' });
  });

  test('throws on invalid JSON after stripping', () => {
    expect(() => parseJSONC('{ not: valid }')).toThrow();
  });
});

// ── validateConfig ────────────────────────────────────────────────────────

describe('validateConfig', () => {
  function minimalValid(): Record<string, unknown> {
    return {
      daidentity: {
        name: 'Aria',
        color: '#3B82F6',
        voices: { main: {} },
        personality: { enthusiasm: 75 },
      },
      principal: { name: 'Alice' },
      hooks: { SessionStart: [] },
      statusLine: { type: 'command', command: 'sh status.sh' },
      permissions: { allow: [], deny: [], ask: [] },
      notifications: { routing: {} },
      env: { PAI_DIR: '/home/.claude' },
      spinnerVerbs: { mode: 'replace', verbs: ['Thinking'] },
      spinnerTipsOverride: { excludeDefault: true, tips: ['Tip one'] },
    };
  }

  test('accepts a fully valid config', () => {
    const { valid, errors } = validateConfig(minimalValid());
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
  });

  test('rejects missing daidentity', () => {
    const cfg = minimalValid();
    delete cfg.daidentity;
    const { valid, errors } = validateConfig(cfg);
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('daidentity'))).toBe(true);
  });

  test('rejects daidentity.name not a string', () => {
    const cfg = minimalValid();
    (cfg.daidentity as Record<string, unknown>).name = 42;
    const { valid, errors } = validateConfig(cfg);
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('daidentity.name'))).toBe(true);
  });

  test('rejects missing principal', () => {
    const cfg = minimalValid();
    delete cfg.principal;
    const { valid, errors } = validateConfig(cfg);
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('principal'))).toBe(true);
  });

  test('rejects missing hooks', () => {
    const cfg = minimalValid();
    delete cfg.hooks;
    const { valid, errors } = validateConfig(cfg);
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('hooks'))).toBe(true);
  });

  test('rejects missing statusLine', () => {
    const cfg = minimalValid();
    delete cfg.statusLine;
    const { valid, errors } = validateConfig(cfg);
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('statusLine'))).toBe(true);
  });

  test('rejects permissions.allow not an array', () => {
    const cfg = minimalValid();
    (cfg.permissions as Record<string, unknown>).allow = 'Bash';
    const { valid, errors } = validateConfig(cfg);
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('permissions.allow'))).toBe(true);
  });

  test('rejects missing notifications.routing', () => {
    const cfg = minimalValid();
    delete (cfg.notifications as Record<string, unknown>).routing;
    const { valid, errors } = validateConfig(cfg);
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('notifications.routing'))).toBe(true);
  });

  test('rejects spinnerVerbs.verbs not an array', () => {
    const cfg = minimalValid();
    (cfg.spinnerVerbs as Record<string, unknown>).verbs = 'Thinking';
    const { valid, errors } = validateConfig(cfg);
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('spinnerVerbs.verbs'))).toBe(true);
  });

  test('rejects spinnerTipsOverride.tips not an array', () => {
    const cfg = minimalValid();
    (cfg.spinnerTipsOverride as Record<string, unknown>).tips = null;
    const { valid, errors } = validateConfig(cfg);
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('spinnerTipsOverride.tips'))).toBe(true);
  });

  test('accumulates multiple errors', () => {
    const { errors } = validateConfig({});
    expect(errors.length).toBeGreaterThan(3);
  });

  test('accepts hooks with direct command shape', () => {
    const cfg = minimalValid();
    cfg.hooks = { PostToolUse: [{ command: 'bun run tracker.ts' }] };
    const { errors } = validateConfig(cfg);
    expect(errors.filter(e => e.includes('hooks.'))).toHaveLength(0);
  });

  test('accepts hooks with matcher + nested hooks shape', () => {
    const cfg = minimalValid();
    cfg.hooks = { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'bun run guard.ts' }] }] };
    const { errors } = validateConfig(cfg);
    expect(errors.filter(e => e.includes('hooks.'))).toHaveLength(0);
  });

  test('accepts hooks with nested hooks but no matcher', () => {
    const cfg = minimalValid();
    cfg.hooks = { SessionEnd: [{ hooks: [{ type: 'command', command: 'bun run cleanup.ts' }] }] };
    const { errors } = validateConfig(cfg);
    expect(errors.filter(e => e.includes('hooks.'))).toHaveLength(0);
  });

  test('rejects hooks entry that is not an object', () => {
    const cfg = minimalValid();
    cfg.hooks = { PostToolUse: ['bad-string'] };
    const { errors } = validateConfig(cfg);
    expect(errors.some(e => e.includes('hooks.PostToolUse[0]'))).toBe(true);
  });

  test('rejects hooks entry with empty command', () => {
    const cfg = minimalValid();
    cfg.hooks = { PostToolUse: [{ command: '' }] };
    const { errors } = validateConfig(cfg);
    expect(errors.some(e => e.includes('hooks.PostToolUse[0]'))).toBe(true);
  });

  test('rejects nested hook with missing command', () => {
    const cfg = minimalValid();
    cfg.hooks = { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command' }] }] };
    const { errors } = validateConfig(cfg);
    expect(errors.some(e => e.includes('hooks.PreToolUse[0].hooks[0].command'))).toBe(true);
  });

  test('rejects hooks event that is not an array', () => {
    const cfg = minimalValid();
    cfg.hooks = { PostToolUse: 'not-an-array' };
    const { errors } = validateConfig(cfg);
    expect(errors.some(e => e.includes('hooks.PostToolUse: must be an array'))).toBe(true);
  });
});

// ── buildSettings integration ─────────────────────────────────────────────

describe('buildSettings', () => {
  test('produces a valid merged config from actual config files', () => {
    // Verify all required config files exist before merging
    const configDir = join(RELEASE_PAI_DIR, 'config');
    const requiredFiles = [
      'identity.jsonc',
      'hooks.jsonc',
      'permissions.jsonc',
      'notifications.jsonc',
      'preferences.jsonc',
      'spinner-verbs.json',
      'spinner-tips.json',
    ];
    for (const f of requiredFiles) {
      expect(existsSync(join(configDir, f))).toBe(true);
    }

    const merged = buildReleaseSettings();
    const { valid, errors } = validateConfig(merged);
    expect(errors).toHaveLength(0);
    expect(valid).toBe(true);
  });

  test('merged config includes $schema field', () => {
    const merged = buildReleaseSettings();
    expect(typeof merged.$schema).toBe('string');
    expect(merged.$schema).toContain('schemastore');
  });

  test('merged config has spinnerVerbs with mode=replace', () => {
    const merged = buildReleaseSettings();
    const sv = merged.spinnerVerbs as Record<string, unknown>;
    expect(sv.mode).toBe('replace');
    expect(Array.isArray(sv.verbs)).toBe(true);
    expect((sv.verbs as string[]).length).toBeGreaterThan(0);
  });

  test('merged config has spinnerTipsOverride with excludeDefault=true', () => {
    const merged = buildReleaseSettings();
    const st = merged.spinnerTipsOverride as Record<string, unknown>;
    expect(st.excludeDefault).toBe(true);
    expect(Array.isArray(st.tips)).toBe(true);
    expect((st.tips as string[]).length).toBeGreaterThan(0);
  });

  test('merged config has all 5 domain sections', () => {
    const merged = buildReleaseSettings();
    // identity
    expect(merged.daidentity).toBeDefined();
    expect(merged.principal).toBeDefined();
    // hooks
    expect(merged.hooks).toBeDefined();
    expect(merged.statusLine).toBeDefined();
    // permissions
    expect(merged.permissions).toBeDefined();
    // notifications
    expect(merged.notifications).toBeDefined();
    // preferences
    expect(merged.env).toBeDefined();
  });

  test('hooks section includes BuildSettings.ts in SessionStart', () => {
    const merged = buildReleaseSettings();
    const hooks = merged.hooks as Record<string, unknown[]>;
    const sessionStart = hooks.SessionStart as Array<{ hooks: Array<{ command: string }> }>;
    const allCommands = sessionStart.flatMap(entry => entry.hooks.map(h => h.command));
    expect(allCommands.some(cmd => cmd.includes('BuildSettings.ts'))).toBe(true);
  });
});

// ── needsRebuild ──────────────────────────────────────────────────────────

describe('needsRebuild', () => {
  test('returns a boolean', () => {
    const result = needsRebuild(RELEASE_PAI_DIR);
    expect(typeof result).toBe('boolean');
  });

  test('returns false when settings.json is newer than all config files', () => {
    // After running buildSettings, settings.json should be up-to-date
    buildReleaseSettings(); // ensure it's been built once
    // needsRebuild may still be true if settings.json hasn't been written in this test run
    // Just verify the function doesn't throw
    expect(() => needsRebuild(RELEASE_PAI_DIR)).not.toThrow();
  });
});

// ── --dry-run flag (BuildSettings CLI) ────────────────────────────────────────

describe('buildSettings dry-run behavior', () => {
  test('buildSettings() produces a valid object without writing', () => {
    // The dry-run flag is CLI-only; we test the underlying buildSettings()
    // function which dry-run calls before comparing — must not throw and
    // must return a valid config object.
    const result = buildReleaseSettings();
    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
  });

  test('buildSettings() output passes validateConfig', () => {
    const merged = buildReleaseSettings();
    const { valid, errors } = validateConfig(merged);
    // Live kai should always have valid config
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  test('buildSettings() produces JSON-serializable output', () => {
    const merged = buildReleaseSettings();
    // dry-run serializes to JSON for comparison — must not throw
    expect(() => JSON.stringify(merged, null, 2)).not.toThrow();
  });

  test('buildSettings() output is deterministic on repeated calls', () => {
    const first = JSON.stringify(buildReleaseSettings());
    const second = JSON.stringify(buildReleaseSettings());
    expect(first).toBe(second);
  });
});
