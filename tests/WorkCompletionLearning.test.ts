/**
 * WorkCompletionLearning.test.ts — Tests for hooks/WorkCompletionLearning.hook.ts
 *
 * Covers: parseYaml (YAML parser for WorkMeta), findStateFile (state file lookup)
 */

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseYaml, findStateFile, type WorkMeta } from '../hooks/WorkCompletionLearning.hook.ts';

// ── parseYaml ────────────────────────────────────────────────────────────────

describe('parseYaml', () => {
  test('parses a complete WorkMeta YAML', () => {
    const yaml = `id: "20260429-test-session"
title: "Refactor Auth System"
created_at: "2026-04-29T10:00:00Z"
completed_at: null
source: ALGORITHM
status: ACTIVE
session_id: "abc123"
lineage:
tools_used:
- Edit
- Bash
files_changed:
- hooks/auth.ts
agents_spawned: []
`;
    const result = parseYaml(yaml) as WorkMeta;
    expect(result.id).toBe('20260429-test-session');
    expect(result.title).toBe('Refactor Auth System');
    expect(result.source).toBe('ALGORITHM');
    expect(result.status).toBe('ACTIVE');
    expect(result.session_id).toBe('abc123');
    expect(result.completed_at).toBeNull();
  });

  test('parses lineage arrays correctly', () => {
    const yaml = `id: "test"
title: "Test Work"
created_at: "2026-04-29T00:00:00Z"
completed_at: null
source: MANUAL
status: ACTIVE
session_id: "sid"
lineage:
tools_used:
- Edit
- Write
- Bash
files_changed:
- hooks/foo.ts
- hooks/bar.ts
agents_spawned: []
`;
    const result = parseYaml(yaml) as WorkMeta;
    expect(result.lineage.tools_used).toEqual(['Edit', 'Write', 'Bash']);
    expect(result.lineage.files_changed).toEqual(['hooks/foo.ts', 'hooks/bar.ts']);
    expect(result.lineage.agents_spawned).toEqual([]);
  });

  test('handles empty arrays ([] syntax)', () => {
    const yaml = `id: "t"
title: "T"
created_at: "2026-04-29"
completed_at: null
source: MANUAL
status: ACTIVE
session_id: "s"
lineage:
tools_used: []
files_changed: []
agents_spawned: []
`;
    const result = parseYaml(yaml) as WorkMeta;
    expect(result.lineage.tools_used).toEqual([]);
    expect(result.lineage.files_changed).toEqual([]);
  });

  test('skips comment lines', () => {
    const yaml = `# This is a comment
id: "test"
# Another comment
title: "My Work"
created_at: "2026-04-29"
completed_at: null
source: MANUAL
status: ACTIVE
session_id: "s"
lineage:
tools_used: []
files_changed: []
agents_spawned: []
`;
    const result = parseYaml(yaml) as WorkMeta;
    expect(result.id).toBe('test');
    expect(result.title).toBe('My Work');
  });

  test('handles empty input gracefully', () => {
    const result = parseYaml('');
    expect(result).toBeDefined();
  });
});

// ── findStateFile ─────────────────────────────────────────────────────────────

describe('findStateFile', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `wcl-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(testDir, 'MEMORY', 'STATE'), { recursive: true });
    process.env.PAI_DIR = testDir;
  });

  afterEach(() => {
    delete process.env.PAI_DIR;
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  // findStateFile accepts optional stateDir to allow testing without module-level PATH coupling
  const stateDir = () => join(testDir, 'MEMORY', 'STATE');

  test('returns null when no state file exists', () => {
    const result = findStateFile('session-abc', stateDir());
    expect(result).toBeNull();
  });

  test('returns scoped state file when it exists', () => {
    const scopedPath = join(stateDir(), 'current-work-session-abc.json');
    writeFileSync(scopedPath, '{}');
    const result = findStateFile('session-abc', stateDir());
    expect(result).toBe(scopedPath);
  });

  test('falls back to legacy current-work.json when no scoped file', () => {
    const legacyPath = join(stateDir(), 'current-work.json');
    writeFileSync(legacyPath, '{}');
    const result = findStateFile('session-xyz', stateDir());
    expect(result).toBe(legacyPath);
  });

  test('prefers scoped file over legacy file', () => {
    const scopedPath = join(stateDir(), 'current-work-session-abc.json');
    const legacyPath = join(stateDir(), 'current-work.json');
    writeFileSync(scopedPath, '{"scoped": true}');
    writeFileSync(legacyPath, '{"legacy": true}');
    const result = findStateFile('session-abc', stateDir());
    expect(result).toBe(scopedPath);
  });

  test('returns null when called without sessionId and no legacy file', () => {
    const result = findStateFile(undefined, stateDir());
    expect(result).toBeNull();
  });
});
