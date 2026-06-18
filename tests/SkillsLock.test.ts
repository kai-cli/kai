/**
 * SkillsLock.test.ts — Tests for skills-lock.ts generate/verify/diff/validate-specialization logic
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import {
  parseSpecializationDecl,
  validateSpecialization,
  type ValidationError,
} from '../scripts/skills-lock';

// ── Test helpers ──────────────────────────────────────────────

const TMP = join(import.meta.dir, '../.tmp-skills-lock-test');
const TMP_SKILLS = join(TMP, 'skills');
const TMP_LOCK = join(TMP, 'skills-lock.json');
const SCRIPT = join(import.meta.dir, '../scripts/skills-lock.ts');

function run(cmd: string, args: string[] = []): { stdout: string; stderr: string; code: number } {
  const result = spawnSync('bun', [SCRIPT, cmd, ...args], {
    cwd: TMP,
    encoding: 'utf8',
    timeout: 15000,
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    code: result.status ?? 1,
  };
}

function makeSkill(name: string, content: string, workflows: Record<string, string> = {}) {
  const dir = join(TMP_SKILLS, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), content, 'utf8');
  if (Object.keys(workflows).length > 0) {
    const wfDir = join(dir, 'Workflows');
    mkdirSync(wfDir, { recursive: true });
    for (const [wfName, wfContent] of Object.entries(workflows)) {
      writeFileSync(join(wfDir, `${wfName}.md`), wfContent, 'utf8');
    }
  }
}

function readLock() {
  return JSON.parse(readFileSync(TMP_LOCK, 'utf8'));
}

// ── Setup / Teardown ──────────────────────────────────────────

beforeAll(() => {
  mkdirSync(TMP_SKILLS, { recursive: true });
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

beforeEach(() => {
  // Clear skills and lock file before each test
  rmSync(TMP_SKILLS, { recursive: true, force: true });
  mkdirSync(TMP_SKILLS, { recursive: true });
  if (existsSync(TMP_LOCK)) rmSync(TMP_LOCK);
});

// ── Tests ─────────────────────────────────────────────────────

describe('generate', () => {
  test('exits 0 and writes skills-lock.json', () => {
    makeSkill('Alpha', '---\nname: Alpha\ndescription: Test skill\n---\n# Alpha\n');
    const r = run('generate');
    expect(r.code).toBe(0);
    expect(existsSync(TMP_LOCK)).toBe(true);
  });

  test('lock contains entry for every skill', () => {
    makeSkill('Alpha', '---\nname: Alpha\n---\n');
    makeSkill('Beta', '---\nname: Beta\n---\n');
    run('generate');
    const lock = readLock();
    expect(Object.keys(lock.skills)).toContain('Alpha');
    expect(Object.keys(lock.skills)).toContain('Beta');
    expect(Object.keys(lock.skills)).toHaveLength(2);
  });

  test('each entry has required fields', () => {
    makeSkill('Alpha', '---\nname: Alpha\n---\n', { Workflow1: '# W1\nstuff' });
    run('generate');
    const lock = readLock();
    const entry = lock.skills['Alpha'];
    expect(entry.source).toBe('pai-config');
    expect(entry.path).toBe('skills/Alpha/SKILL.md');
    expect(entry.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(Array.isArray(entry.workflows)).toBe(true);
    expect(typeof entry.workflowHashes).toBe('object');
    expect(entry.specializes).toBeNull();
  });

  test('workflows are listed and hashed', () => {
    makeSkill('Alpha', '---\nname: Alpha\n---\n', {
      WorkflowA: '# WA\ncontent',
      WorkflowB: '# WB\ncontent',
    });
    run('generate');
    const lock = readLock();
    const entry = lock.skills['Alpha'];
    expect(entry.workflows).toContain('WorkflowA');
    expect(entry.workflows).toContain('WorkflowB');
    expect(entry.workflowHashes['WorkflowA']).toMatch(/^sha256:/);
    expect(entry.workflowHashes['WorkflowB']).toMatch(/^sha256:/);
  });

  test('generate is deterministic — same content → same hashes on re-run', () => {
    makeSkill('Alpha', '---\nname: Alpha\n---\nBody content here\n');
    run('generate');
    const lock1 = readLock();
    run('generate');
    const lock2 = readLock();
    expect(lock1.skills['Alpha'].hash).toBe(lock2.skills['Alpha'].hash);
  });

  test('specializes field captured when present', () => {
    makeSkill('Beta', '---\nname: Beta\nspecializes: Alpha\n---\n');
    run('generate');
    const lock = readLock();
    expect(lock.skills['Beta'].specializes).toBe('Alpha');
  });

  test('specializes is null when not present', () => {
    makeSkill('Alpha', '---\nname: Alpha\n---\n');
    run('generate');
    const lock = readLock();
    expect(lock.skills['Alpha'].specializes).toBeNull();
  });
});

describe('hashing stability', () => {
  test('whitespace-only change to SKILL.md does NOT change hash', () => {
    const base = '---\nname: Alpha\ndescription: Test\n---\n# Alpha\nSome body text\n';
    makeSkill('Alpha', base);
    run('generate');
    const lock1 = readLock();
    const hashBefore = lock1.skills['Alpha'].hash;

    // Add trailing whitespace to lines — should not change hash
    const whitespaceOnly = '---\nname: Alpha\ndescription: Test\n---\n# Alpha\nSome body text  \n\n';
    writeFileSync(join(TMP_SKILLS, 'Alpha', 'SKILL.md'), whitespaceOnly, 'utf8');
    run('generate');
    const lock2 = readLock();
    expect(lock2.skills['Alpha'].hash).toBe(hashBefore);
  });

  test('semantic content change DOES change hash', () => {
    makeSkill('Alpha', '---\nname: Alpha\n---\n# Alpha\nOriginal content\n');
    run('generate');
    const lock1 = readLock();
    const hashBefore = lock1.skills['Alpha'].hash;

    writeFileSync(join(TMP_SKILLS, 'Alpha', 'SKILL.md'),
      '---\nname: Alpha\n---\n# Alpha\nChanged content\n', 'utf8');
    run('generate');
    const lock2 = readLock();
    expect(lock2.skills['Alpha'].hash).not.toBe(hashBefore);
  });
});

describe('verify', () => {
  test('exits 0 when installation matches lock', () => {
    makeSkill('Alpha', '---\nname: Alpha\n---\n');
    run('generate');
    const r = run('verify');
    expect(r.code).toBe(0);
  });

  test('exits 1 when a skill SKILL.md differs from lock', () => {
    makeSkill('Alpha', '---\nname: Alpha\n---\nOriginal\n');
    run('generate');
    writeFileSync(join(TMP_SKILLS, 'Alpha', 'SKILL.md'),
      '---\nname: Alpha\n---\nModified\n', 'utf8');
    const r = run('verify');
    expect(r.code).toBe(1);
  });

  test('exits 1 when a new skill is added after lock generation', () => {
    makeSkill('Alpha', '---\nname: Alpha\n---\n');
    run('generate');
    makeSkill('Beta', '---\nname: Beta\n---\n');
    const r = run('verify');
    expect(r.code).toBe(1);
  });

  test('exits 1 when a skill is removed after lock generation', () => {
    makeSkill('Alpha', '---\nname: Alpha\n---\n');
    makeSkill('Beta', '---\nname: Beta\n---\n');
    run('generate');
    rmSync(join(TMP_SKILLS, 'Beta'), { recursive: true });
    const r = run('verify');
    expect(r.code).toBe(1);
  });

  test('does NOT fail on whitespace-only changes', () => {
    makeSkill('Alpha', '---\nname: Alpha\n---\nContent\n');
    run('generate');
    // Add trailing whitespace — should not be detected as drift
    writeFileSync(join(TMP_SKILLS, 'Alpha', 'SKILL.md'),
      '---\nname: Alpha\n---\nContent  \n\n', 'utf8');
    const r = run('verify');
    expect(r.code).toBe(0);
  });

  test('--strict outputs human-readable diff when drift detected', () => {
    makeSkill('Alpha', '---\nname: Alpha\n---\nOriginal\n');
    run('generate');
    writeFileSync(join(TMP_SKILLS, 'Alpha', 'SKILL.md'),
      '---\nname: Alpha\n---\nModified\n', 'utf8');
    const r = run('verify', ['--strict']);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('DRIFT DETECTED');
    expect(r.stdout).toContain('Alpha');
  });

  test('--strict outputs OK message when no drift', () => {
    makeSkill('Alpha', '---\nname: Alpha\n---\n');
    run('generate');
    const r = run('verify', ['--strict']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('OK');
  });

  test('exits 1 when lock file is missing', () => {
    const r = run('verify');
    expect(r.code).toBe(1);
  });
});

describe('diff', () => {
  test('shows no changes when skills match lock', () => {
    makeSkill('Alpha', '---\nname: Alpha\n---\n');
    run('generate');
    const r = run('diff');
    expect(r.stdout).toContain('No changes');
  });

  test('shows + for added skills', () => {
    makeSkill('Alpha', '---\nname: Alpha\n---\n');
    run('generate');
    makeSkill('Beta', '---\nname: Beta\n---\n');
    const r = run('diff');
    expect(r.stdout).toContain('+ Beta');
  });

  test('shows - for removed skills', () => {
    makeSkill('Alpha', '---\nname: Alpha\n---\n');
    makeSkill('Beta', '---\nname: Beta\n---\n');
    run('generate');
    rmSync(join(TMP_SKILLS, 'Beta'), { recursive: true });
    const r = run('diff');
    expect(r.stdout).toContain('- Beta');
  });

  test('shows ~ for modified SKILL.md', () => {
    makeSkill('Alpha', '---\nname: Alpha\n---\nOriginal\n');
    run('generate');
    writeFileSync(join(TMP_SKILLS, 'Alpha', 'SKILL.md'),
      '---\nname: Alpha\n---\nModified\n', 'utf8');
    const r = run('diff');
    expect(r.stdout).toContain('~ Alpha');
  });

  test('shows ~ with workflow details for workflow changes', () => {
    makeSkill('Alpha', '---\nname: Alpha\n---\n', {
      WorkflowA: '# WA\ncontent',
    });
    run('generate');
    writeFileSync(
      join(TMP_SKILLS, 'Alpha', 'Workflows', 'WorkflowA.md'),
      '# WA\nchanged content\n', 'utf8'
    );
    const r = run('diff');
    expect(r.stdout).toContain('~ Alpha workflows');
    expect(r.stdout).toContain('WorkflowA');
  });
});

// ── Specialization validation ─────────────────────────────────

describe('parseSpecializationDecl', () => {
  test('returns null when no specializes field', () => {
    const path = join(TMP, 'plain.SKILL.md');
    writeFileSync(path, '---\nname: Alpha\n---\n# Alpha\n', 'utf8');
    expect(parseSpecializationDecl(path)).toBeNull();
  });

  test('parses specializes field', () => {
    const path = join(TMP, 'specialized.SKILL.md');
    writeFileSync(path, '---\nname: Beta\nspecializes: Alpha\n---\n', 'utf8');
    const decl = parseSpecializationDecl(path);
    expect(decl).not.toBeNull();
    expect(decl!.specializes).toBe('Alpha');
    expect(decl!.skillName).toBe('Beta');
  });

  test('parses overrides as YAML block list', () => {
    const path = join(TMP, 'overrides.SKILL.md');
    writeFileSync(path,
      '---\nname: Beta\nspecializes: Alpha\noverrides:\n  - WorkflowA\n  - WorkflowB\n---\n',
      'utf8'
    );
    const decl = parseSpecializationDecl(path);
    expect(decl!.overrides).toContain('WorkflowA');
    expect(decl!.overrides).toContain('WorkflowB');
  });

  test('parses overrides as inline YAML list', () => {
    const path = join(TMP, 'overrides-inline.SKILL.md');
    writeFileSync(path,
      '---\nname: Beta\nspecializes: Alpha\noverrides: [WorkflowA, WorkflowB]\n---\n',
      'utf8'
    );
    const decl = parseSpecializationDecl(path);
    expect(decl!.overrides).toContain('WorkflowA');
    expect(decl!.overrides).toContain('WorkflowB');
  });

  test('parses extends field', () => {
    const path = join(TMP, 'extends.SKILL.md');
    writeFileSync(path,
      '---\nname: Beta\nspecializes: Alpha\nextends:\n  - NewWorkflow\n---\n',
      'utf8'
    );
    const decl = parseSpecializationDecl(path);
    expect(decl!.extends_).toContain('NewWorkflow');
  });
});

describe('validateSpecialization', () => {
  const mockLock = {
    version: 1 as const,
    generated: '2026-01-01T00:00:00Z',
    skills: {
      Alpha: {
        source: 'pai-config',
        path: 'skills/Alpha/SKILL.md',
        hash: 'sha256:abc',
        workflows: ['WorkflowA', 'WorkflowB', 'WorkflowC'],
        workflowHashes: {
          WorkflowA: 'sha256:1',
          WorkflowB: 'sha256:2',
          WorkflowC: 'sha256:3',
        },
        specializes: null,
      },
    },
  };

  test('returns no errors for valid specialization', () => {
    const errors = validateSpecialization(
      { skillName: 'Beta', specializes: 'Alpha', overrides: ['WorkflowA'], extends_: ['NewWorkflow'] },
      mockLock
    );
    expect(errors).toHaveLength(0);
  });

  test('errors when parent skill does not exist', () => {
    const errors = validateSpecialization(
      { skillName: 'Beta', specializes: 'NonExistent', overrides: [], extends_: [] },
      mockLock
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].type).toBe('missing_parent');
    expect(errors[0].message).toContain('NonExistent');
    expect(errors[0].message).toContain('Alpha'); // mentions available skills
  });

  test('errors when overrides references nonexistent parent workflow', () => {
    const errors = validateSpecialization(
      { skillName: 'Beta', specializes: 'Alpha', overrides: ['WorkflowA', 'BadWorkflow'], extends_: [] },
      mockLock
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].type).toBe('invalid_override');
    expect(errors[0].message).toContain('BadWorkflow');
    expect(errors[0].message).toContain('WorkflowA'); // mentions available workflows
    expect(errors[0].message).toContain('WorkflowB');
    expect(errors[0].message).toContain('WorkflowC');
  });

  test('multiple invalid overrides produce multiple errors', () => {
    const errors = validateSpecialization(
      { skillName: 'Beta', specializes: 'Alpha', overrides: ['BadA', 'BadB'], extends_: [] },
      mockLock
    );
    expect(errors).toHaveLength(2);
  });

  test('extends referencing nonexistent parent workflow is NOT an error (extends = adds new)', () => {
    const errors = validateSpecialization(
      { skillName: 'Beta', specializes: 'Alpha', overrides: [], extends_: ['BrandNewWorkflow'] },
      mockLock
    );
    expect(errors).toHaveLength(0);
  });

  test('project label appears in error message when provided', () => {
    const errors = validateSpecialization(
      { skillName: 'Beta', specializes: 'NoSuchSkill', overrides: [], extends_: [] },
      mockLock,
      'my-project'
    );
    expect(errors[0].message).toContain('project:my-project');
  });
});

describe('validate-specialization CLI command', () => {
  test('exits 0 and prints OK for valid specialization', () => {
    makeSkill('Parent', '---\nname: Parent\n---\n', {
      WorkflowX: '# WX',
      WorkflowY: '# WY',
    });
    run('generate');

    const childPath = join(TMP, 'child.SKILL.md');
    writeFileSync(childPath,
      '---\nname: Child\nspecializes: Parent\noverrides:\n  - WorkflowX\nextends:\n  - NewWorkflow\n---\n',
      'utf8'
    );
    const r = run('validate-specialization', [childPath]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('OK');
  });

  test('exits 1 and prints ERROR when overrides references nonexistent workflow', () => {
    makeSkill('Parent', '---\nname: Parent\n---\n', {
      WorkflowX: '# WX',
    });
    run('generate');

    const childPath = join(TMP, 'bad-child.SKILL.md');
    writeFileSync(childPath,
      '---\nname: Child\nspecializes: Parent\noverrides:\n  - BadWorkflow\n---\n',
      'utf8'
    );
    const r = run('validate-specialization', [childPath]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('ERROR');
    expect(r.stderr).toContain('BadWorkflow');
    expect(r.stderr).toContain('WorkflowX'); // available workflows listed
  });

  test('exits 1 and prints ERROR when parent skill does not exist', () => {
    makeSkill('Parent', '---\nname: Parent\n---\n');
    run('generate');

    const childPath = join(TMP, 'orphan.SKILL.md');
    writeFileSync(childPath,
      '---\nname: Child\nspecializes: NoSuchParent\n---\n',
      'utf8'
    );
    const r = run('validate-specialization', [childPath]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('NoSuchParent');
  });

  test('exits 0 with informational message when no specializes field', () => {
    const path = join(TMP, 'plain-skill.SKILL.md');
    writeFileSync(path, '---\nname: Plain\n---\n# Plain\n', 'utf8');
    makeSkill('AnySkill', '---\nname: AnySkill\n---\n');
    run('generate');
    const r = run('validate-specialization', [path]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('nothing to validate');
  });
});
