/**
 * SettingsReproducibility.test.ts — 7.3.4 #3 (PAI-SR-001).
 *
 * Guards: (1) buildSettings reproduces the machine-local root keys (model,
 * autoMemoryDirectory) from preferences.local.jsonc; (2) expandEnvVars fails closed
 * on empty path-critical vars instead of collapsing paths; (3) the equivalence gate
 * detects source↔generated divergence.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { spawn, spawnSync } from 'bun';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { buildSettings, findSettingsDivergence } from '../hooks/handlers/BuildSettings.ts';
import { makePaiConfigFixture, pinPaiEnv, stableTestHome } from './lib/pai-test-fixtures';

const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

const HOME = stableTestHome();
const LIVE_PAI_DIR = REPO;
const FIXTURE = makePaiConfigFixture(REPO, {
  model: 'test-claude-model',
  autoMemoryDirectory: '${PAI_DIR}/auto-memory',
});

function pinSettingsEnv(): void {
  pinPaiEnv(FIXTURE.dir, HOME);
}

function buildFixtureSettings(): Record<string, unknown> {
  // BuildSettings expands ${PAI_DIR}/${HOME} from process.env. Several tests in
  // the full parallel suite mutate process.env, so pin immediately before each
  // reproducibility build instead of relying on file/suite ordering.
  pinSettingsEnv();
  return buildSettings(FIXTURE.dir) as Record<string, unknown>;
}

function normalizeHookRunnerPaths(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\/[^\s"']+\/hooks\/lib\/run-hook\.sh/g, '${PAI_DIR}/hooks/lib/run-hook.sh');
  }
  if (Array.isArray(value)) return value.map(normalizeHookRunnerPaths);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        normalizeHookRunnerPaths(nested),
      ])
    );
  }
  return value;
}

// buildSettings expands ${PAI_DIR}/${HOME} from process.env and (by design, PAI-SR-001)
// THROWS when they resolve empty. In the full parallel suite another test can clear those
// env vars in-process, making these tests flaky. Pin them for this suite and restore after.
// (Same class as [[feedback_parallel_test_home_env]].)
let savedPaiDir: string | undefined;
let savedHome: string | undefined;
beforeAll(() => {
  savedPaiDir = process.env.PAI_DIR;
  savedHome = process.env.HOME;
  pinSettingsEnv();
});
afterAll(() => {
  if (savedPaiDir === undefined) delete process.env.PAI_DIR; else process.env.PAI_DIR = savedPaiDir;
  if (savedHome === undefined) delete process.env.HOME; else process.env.HOME = savedHome;
  FIXTURE.cleanup();
});

describe('settings reproducibility (PAI-SR-001)', () => {
  test('buildSettings reproduces top-level model', () => {
    const built = buildFixtureSettings();
    expect(built.model).toBeDefined();
    expect(typeof built.model).toBe('string');
  });

  test('buildSettings reproduces top-level autoMemoryDirectory', () => {
    const built = buildFixtureSettings();
    expect(built.autoMemoryDirectory).toBeDefined();
    expect(String(built.autoMemoryDirectory)).toContain('auto-memory');
  });

  test('a rebuild does not drop model or autoMemoryDirectory', () => {
    // Two independent builds must both carry the keys (idempotent reproduction).
    const a = buildFixtureSettings();
    const b = buildFixtureSettings();
    expect(a.model).toBe(b.model);
    expect(a.autoMemoryDirectory).toBe(b.autoMemoryDirectory);
  });

  test('divergence vs live is limited to known-benign keys', () => {
    const settingsPath = join(LIVE_PAI_DIR, 'settings.json');
    if (!existsSync(settingsPath)) return; // skip if no live settings (CI without install)
    // Run in a subprocess with fixed env. The full Bun suite runs files in parallel and
    // several tests intentionally mutate process.env; this live-settings gate must not
    // inherit those in-process races.
    const code = `
      const { buildSettings, findSettingsDivergence } = require(${JSON.stringify(join(REPO, 'hooks/handlers/BuildSettings.ts'))});
      const { readFileSync } = require('fs');
      const normalizeHookRunnerPaths = ${normalizeHookRunnerPaths.toString()};
      const built = buildSettings(${JSON.stringify(LIVE_PAI_DIR)});
      const live = JSON.parse(readFileSync(${JSON.stringify(settingsPath)}, 'utf-8'));
      const builtComparable = { ...built, hooks: normalizeHookRunnerPaths(built.hooks) };
      const liveComparable = { ...live, hooks: normalizeHookRunnerPaths(live.hooks) };
      console.log(JSON.stringify(findSettingsDivergence(builtComparable, liveComparable)));
    `;
    const proc = spawnSync(['bun', '-e', code], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, PAI_DIR: LIVE_PAI_DIR, HOME },
    });
    expect(proc.exitCode).toBe(0);
    const divergent = JSON.parse(proc.stdout.toString()) as string[];
    // Allowed: spinnerTipsOverride (version-string staleness). Local installs may also carry
    // environment-specific statusLine/autoMemoryDirectory drift. Any OTHER key is a new defect.
    const ALLOWED = new Set(['spinnerTipsOverride', 'autoMemoryDirectory', 'statusLine']);
    const unexpected = divergent.filter(k => !ALLOWED.has(k));
    expect(unexpected).toEqual([]);
  });
});

describe('empty PAI_DIR is rejected, not silently collapsed (PAI-SR-001)', () => {
  test('buildSettings throws when PAI_DIR env is empty', async () => {
    // Real config dir present, but PAI_DIR env = "" → ${PAI_DIR} would collapse to /hooks/...
    const code = `
      const { buildSettings } = require(${JSON.stringify(join(REPO, 'hooks/handlers/BuildSettings.ts'))});
      try { buildSettings(${JSON.stringify(REPO)}); console.log('NO_THROW'); }
      catch (e) { console.log('THREW'); }
    `;
    const proc = spawn(['bun', '-e', code], {
      stdout: 'pipe', stderr: 'pipe',
      env: { ...process.env, PAI_DIR: '' },
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    expect(out.trim()).toContain('THREW');
  });
});

describe('findSettingsDivergence', () => {
  test('returns empty for identical (sans runtime fields)', () => {
    const a = { x: 1, counts: { a: 5 } };
    const b = { x: 1, counts: { a: 999 } }; // counts is runtime-only → ignored
    expect(findSettingsDivergence(a, b)).toEqual([]);
  });

  test('detects a key present only on one side', () => {
    expect(findSettingsDivergence({ model: 'm' }, {})).toEqual(['model']);
  });

  test('ignores key ordering', () => {
    expect(findSettingsDivergence({ a: 1, b: 2 }, { b: 2, a: 1 })).toEqual([]);
  });
});
