/**
 * HookEventCoverage.test.ts — 7.4.0 §0 C1.1 (PAI-SR-013).
 *
 * Release gate: every hook event REGISTERED in settings.json must have a payload schema in
 * payload-schema.ts. Without this, a hook can be wired to an event whose payload shape PAI has
 * never validated against the current Claude Code contract (the PAI-SR-006/007 class of bug:
 * reading legacy field names the live event no longer sends).
 *
 * This fails loudly when someone registers a new event without adding its schema.
 */
import { describe, test, expect } from 'bun:test';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { buildSettings } from '../hooks/handlers/BuildSettings';
import { PAYLOAD_SCHEMAS } from '../hooks/lib/payload-schema';
import { pinPaiEnv } from './lib/pai-test-fixtures';

const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

function registeredEvents(): string[] {
  const settingsPath = join(REPO, 'settings.json');
  pinPaiEnv(REPO);
  const settings = existsSync(settingsPath)
    ? JSON.parse(readFileSync(settingsPath, 'utf-8'))
    : buildSettings(REPO);
  return Object.keys(settings.hooks ?? {});
}

describe('hook-event schema coverage (PAI-SR-013 release gate)', () => {
  test('every settings-registered event has a payload schema', () => {
    const covered = new Set(Object.keys(PAYLOAD_SCHEMAS));
    const uncovered = registeredEvents().filter(e => !covered.has(e));
    // If this fails: add the event + its current-2.1.185 field shape to PAYLOAD_SCHEMAS.
    expect(uncovered).toEqual([]);
  });

  test('all 12 currently-registered events are present', () => {
    // Snapshot of the known-registered set; tightens the gate so silent registration is caught.
    const events = registeredEvents().sort();
    expect(events).toEqual([
      'ConfigChange', 'PostToolUse', 'PreCompact', 'PreToolUse', 'SessionEnd',
      'SessionStart', 'Stop', 'TaskCompleted', 'TeammateIdle', 'UserPromptExpansion',
      'UserPromptSubmit', 'WorktreeRemove',
    ].sort());
  });

  test('schemas use current field names, not retired legacy ones', () => {
    // PAI-SR-006/007 regression guard: the current 2.1.185 fields, not the legacy ones.
    const taskFields = PAYLOAD_SCHEMAS.TaskCompleted.map(f => f.field);
    expect(taskFields).toContain('task_subject');   // current
    expect(taskFields).not.toContain('subject');     // legacy
    expect(taskFields).not.toContain('owner');       // legacy

    const cfgFields = PAYLOAD_SCHEMAS.ConfigChange.map(f => f.field);
    expect(cfgFields).toContain('source');           // current
    expect(cfgFields).not.toContain('config_path');  // legacy
  });
});
