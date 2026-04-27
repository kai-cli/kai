#!/usr/bin/env bun

/**
 * BuildSettings.ts — Merges config/*.jsonc domain files into settings.json
 *
 * Domain files (source of truth):
 *   config/identity.jsonc      → daidentity, principal
 *   config/hooks.jsonc         → hooks, statusLine
 *   config/permissions.jsonc   → permissions
 *   config/notifications.jsonc → notifications
 *   config/preferences.jsonc   → env, voice, memory, preferences, techStack, etc.
 *   config/spinner-verbs.json  → spinnerVerbs.verbs
 *   config/spinner-tips.json   → spinnerTipsOverride.tips
 *
 * Runtime state preserved from existing settings.json:
 *   feedbackSurveyState, counts
 *
 * Run manually: bun ~/.claude/hooks/handlers/BuildSettings.ts
 * Also called at SessionStart to auto-rebuild when config files change.
 */

import { readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { atomicWriteJSON } from '../lib/atomic.ts';

// ── Path resolution ────────────────────────────────────────────────────────

const DEFAULT_PAI_DIR = process.env.PAI_DIR ?? join(process.env.HOME ?? '~', '.claude');

// ── JSONC parser ───────────────────────────────────────────────────────────

/**
 * Parse JSONC (JSON with Comments) by stripping line and block comments
 * before passing to JSON.parse. Handles the comment styles Bun uses natively.
 */
export function parseJSONC(text: string): unknown {
  // Remove block comments /* ... */ (non-greedy, dotall)
  // Remove line comments // ... (careful not to strip URLs like https://)
  // Strip trailing commas before } or ] (standard JSONC behavior)
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(?<!:)\/\/[^\n]*/g, '')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(stripped);
}

// ── File utilities ─────────────────────────────────────────────────────────

function readJSONC(path: string): unknown {
  try {
    const text = readFileSync(path, 'utf-8');
    return parseJSONC(text);
  } catch {
    return {};
  }
}

function readJSON(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return {};
  }
}

/** Expand ${VAR} and $VAR references in string values using process.env. */
function expandEnvVars(value: string): string {
  return value
    .replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? '')
    .replace(/\$(\w+)/g, (_, name) => process.env[name] ?? '');
}

/** Recursively expand env var references in all string values of an object. */
function expandEnvInObject(obj: unknown): unknown {
  if (typeof obj === 'string') return expandEnvVars(obj);
  if (Array.isArray(obj)) return obj.map(expandEnvInObject);
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      result[k] = expandEnvInObject(v);
    }
    return result;
  }
  return obj;
}

/** Return the mtime of a file, or 0 if it doesn't exist. */
function mtime(path: string): number {
  return existsSync(path) ? statSync(path).mtimeMs : 0;
}

/** Deep merge b into a. Arrays in b replace arrays in a (no concat). */
function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const result = { ...a };
  for (const [key, val] of Object.entries(b)) {
    if (val && typeof val === 'object' && !Array.isArray(val) && a[key] && typeof a[key] === 'object' && !Array.isArray(a[key])) {
      result[key] = deepMerge(a[key] as Record<string, unknown>, val as Record<string, unknown>);
    } else {
      result[key] = val;
    }
  }
  return result;
}

// ── Rebuild detection ──────────────────────────────────────────────────────

const CONFIG_FILES = [
  'identity.jsonc',
  'hooks.jsonc',
  'permissions.jsonc',
  'notifications.jsonc',
  'preferences.jsonc',
  'spinner-verbs.json',
  'spinner-tips.json',
];

// Local override file — machine-specific settings that survive git pulls.
// Gitignored. Created by installer migration or manually by the user.
const LOCAL_OVERRIDE_FILE = 'preferences.local.jsonc';

/**
 * Returns true if any config/*.jsonc file is newer than settings.json,
 * or if settings.json does not yet exist.
 */
export function needsRebuild(paiDir = DEFAULT_PAI_DIR): boolean {
  const settingsPath = join(paiDir, 'settings.json');
  const configDir = join(paiDir, 'config');
  const settingsMtime = mtime(settingsPath);
  if (settingsMtime === 0) return true;
  // Check all domain configs AND the local override file
  const allFiles = [...CONFIG_FILES, LOCAL_OVERRIDE_FILE];
  return allFiles.some(f => mtime(join(configDir, f)) > settingsMtime);
}

// ── Validation ─────────────────────────────────────────────────────────────

type ValidationResult = { valid: boolean; errors: string[] };

/** Structural validation — fail fast with descriptive messages. */
export function validateConfig(merged: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  // identity
  const da = merged.daidentity as Record<string, unknown> | undefined;
  if (!da) errors.push('daidentity: missing');
  else {
    if (typeof da.name !== 'string') errors.push('daidentity.name: must be a string');
    if (typeof da.color !== 'string') errors.push('daidentity.color: must be a string');
  }

  const principal = merged.principal as Record<string, unknown> | undefined;
  if (!principal) errors.push('principal: missing');
  else {
    if (typeof principal.name !== 'string') errors.push('principal.name: must be a string');
  }

  // hooks
  if (!merged.hooks || typeof merged.hooks !== 'object') errors.push('hooks: missing or not an object');
  if (!merged.statusLine || typeof merged.statusLine !== 'object') errors.push('statusLine: missing or not an object');

  // permissions
  const perms = merged.permissions as Record<string, unknown> | undefined;
  if (!perms) errors.push('permissions: missing');
  else {
    if (!Array.isArray(perms.allow)) errors.push('permissions.allow: must be an array');
    if (!Array.isArray(perms.deny)) errors.push('permissions.deny: must be an array');
    if (!Array.isArray(perms.ask)) errors.push('permissions.ask: must be an array');
  }

  // notifications
  const notif = merged.notifications as Record<string, unknown> | undefined;
  if (!notif) errors.push('notifications: missing');
  else {
    if (!notif.routing || typeof notif.routing !== 'object') errors.push('notifications.routing: missing or not an object');
  }

  // preferences
  if (!merged.env || typeof merged.env !== 'object') errors.push('env: missing or not an object');
  else {
    // AWS Bedrock vars — only required when Bedrock is explicitly enabled
    const envObj = merged.env as Record<string, unknown>;
    if (envObj['CLAUDE_CODE_USE_BEDROCK'] === '1') {
      const bedrockKeys = ['AWS_REGION', 'AWS_PROFILE', 'ANTHROPIC_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL'];
      for (const key of bedrockKeys) {
        if (!envObj[key]) errors.push(`env.${key}: required when CLAUDE_CODE_USE_BEDROCK=1`);
      }
    }
  }

  // spinnerVerbs
  const sv = merged.spinnerVerbs as Record<string, unknown> | undefined;
  if (!sv) errors.push('spinnerVerbs: missing');
  else if (!Array.isArray(sv.verbs)) errors.push('spinnerVerbs.verbs: must be an array');

  // spinnerTipsOverride
  const st = merged.spinnerTipsOverride as Record<string, unknown> | undefined;
  if (!st) errors.push('spinnerTipsOverride: missing');
  else if (!Array.isArray(st.tips)) errors.push('spinnerTipsOverride.tips: must be an array');

  return { valid: errors.length === 0, errors };
}

// ── Merge ──────────────────────────────────────────────────────────────────

/**
 * Build a merged settings object from all domain config files.
 * Preserves runtime state (counts, feedbackSurveyState) from existing settings.json.
 */
export function buildSettings(paiDir = DEFAULT_PAI_DIR): Record<string, unknown> {
  const configDir = join(paiDir, 'config');
  const settingsPath = join(paiDir, 'settings.json');

  // Load domain configs
  const identity = readJSONC(join(configDir, 'identity.jsonc')) as Record<string, unknown>;
  const hooks = readJSONC(join(configDir, 'hooks.jsonc')) as Record<string, unknown>;
  const permissions = readJSONC(join(configDir, 'permissions.jsonc')) as Record<string, unknown>;
  const notifications = readJSONC(join(configDir, 'notifications.jsonc')) as Record<string, unknown>;
  const prefs = readJSONC(join(configDir, 'preferences.jsonc')) as Record<string, unknown>;

  // Load spinner data from dedicated json files
  const spinnerVerbs = readJSON(join(configDir, 'spinner-verbs.json')) as string[];
  const spinnerTips = readJSON(join(configDir, 'spinner-tips.json')) as string[];

  // Preserve runtime state from existing settings.json
  let existingCounts: unknown = undefined;
  let existingFeedbackState: unknown = undefined;
  let existingEnv: Record<string, unknown> | undefined = undefined;
  if (existsSync(settingsPath)) {
    try {
      const existing = readJSON(settingsPath) as Record<string, unknown>;
      existingCounts = existing.counts;
      existingFeedbackState = existing.feedbackSurveyState;
      if (existing.env && typeof existing.env === 'object') {
        existingEnv = existing.env as Record<string, unknown>;
      }
    } catch {
      // settings.json corrupted — proceed without preserving runtime state
    }
  }

  // Expand ${HOME}, ${PAI_DIR}, etc. in hooks and env values
  const expandedHooks = expandEnvInObject(hooks) as Record<string, unknown>;
  const expandedPrefs = expandEnvInObject(prefs) as Record<string, unknown>;

  // Assemble in canonical field order (matching original settings.json)
  const merged: Record<string, unknown> = {
    $schema: 'https://json.schemastore.org/claude-code-settings.json',

    // From preferences.jsonc (with env vars expanded)
    ...expandedPrefs,

    // From permissions.jsonc
    ...permissions,

    // From identity.jsonc
    ...identity,

    // From hooks.jsonc (with env vars expanded)
    ...expandedHooks,

    // From notifications.jsonc
    ...notifications,

    // Spinner UI data (composed from dedicated files)
    spinnerVerbs: {
      mode: 'replace',
      verbs: spinnerVerbs,
    },
    spinnerTipsOverride: {
      excludeDefault: true,
      tips: spinnerTips,
    },

    // Runtime state — preserved across rebuilds
    counts: existingCounts,
    feedbackSurveyState: existingFeedbackState,
  };

  // Remove undefined runtime state fields if they were absent
  if (merged.counts === undefined) delete merged.counts;
  if (merged.feedbackSurveyState === undefined) delete merged.feedbackSurveyState;

  // Preserve env vars from existing settings.json that aren't in source configs.
  // Prevents manually-added vars (e.g. Bedrock) from being wiped on rebuild.
  if (existingEnv && merged.env && typeof merged.env === 'object') {
    const mergedEnv = merged.env as Record<string, unknown>;
    for (const [key, value] of Object.entries(existingEnv)) {
      if (!(key in mergedEnv)) {
        mergedEnv[key] = value;
      }
    }
  }

  // Apply local overrides (machine-specific settings that survive git pulls)
  const localOverridePath = join(configDir, LOCAL_OVERRIDE_FILE);
  if (existsSync(localOverridePath)) {
    try {
      const localOverrides = expandEnvInObject(
        readJSONC(localOverridePath) as Record<string, unknown>
      ) as Record<string, unknown>;
      return deepMerge(merged, localOverrides);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`BuildSettings: WARNING — ${LOCAL_OVERRIDE_FILE} parse error: ${msg}`);
      console.error('  Skipping local overrides. Fix the file or delete it.');
    }
  }

  return merged;
}

// ── Main ───────────────────────────────────────────────────────────────────

/** Build and write settings.json. Returns true if settings were rebuilt. */
export function build(paiDir = DEFAULT_PAI_DIR): { rebuilt: boolean; errors: string[] } {
  if (!needsRebuild(paiDir)) {
    return { rebuilt: false, errors: [] };
  }

  let merged: Record<string, unknown>;
  try {
    merged = buildSettings(paiDir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { rebuilt: false, errors: [`Failed to build settings: ${msg}`] };
  }

  const { valid, errors } = validateConfig(merged);
  if (!valid) {
    return { rebuilt: false, errors };
  }

  atomicWriteJSON(join(paiDir, 'settings.json'), merged);
  return { rebuilt: true, errors: [] };
}

// ── CLI entry point ────────────────────────────────────────────────────────

if (import.meta.main) {
  const result = build();
  if (result.errors.length > 0) {
    console.error('BuildSettings: validation errors:');
    for (const e of result.errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  if (result.rebuilt) {
    console.error('BuildSettings: settings.json rebuilt from config/*.jsonc');
  }
  // Silence on no-op (config unchanged) — avoid noise on every SessionStart
}
