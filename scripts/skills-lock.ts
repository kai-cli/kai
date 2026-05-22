#!/usr/bin/env bun
/**
 * skills-lock.ts — Skills Lock File generator/verifier
 *
 * Commands:
 *   bun scripts/skills-lock.ts generate                     Regenerate skills-lock.json
 *   bun scripts/skills-lock.ts verify                       Verify installation matches lock (exit 1 on drift)
 *   bun scripts/skills-lock.ts verify --strict              Verbose CI mode (exit 1 on drift)
 *   bun scripts/skills-lock.ts diff                         Show what changed since last generate
 *   bun scripts/skills-lock.ts validate-specialization <path/to/SKILL.md>
 *                                                           Validate a project skill's specializes/overrides
 *                                                           declarations against the lock file
 *
 * Hashing: SHA-256 of parsed content (frontmatter key-value pairs + body stripped of
 * trailing whitespace). Whitespace-only edits do NOT change the hash.
 */

import { createHash } from 'crypto';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join, resolve, basename } from 'path';

// ── Paths ──────────────────────────────────────────────────────

const REPO_ROOT = process.env.SKILLS_LOCK_ROOT ?? process.cwd();
const SKILLS_DIR = join(REPO_ROOT, 'skills');
const LOCK_FILE = join(REPO_ROOT, 'skills-lock.json');

// ── Types ──────────────────────────────────────────────────────

interface SkillEntry {
  source: string;
  path: string;
  hash: string;
  workflows: string[];
  workflowHashes: Record<string, string>;
  specializes: string | null;
}

interface LockFile {
  version: number;
  generated: string;
  skills: Record<string, SkillEntry>;
}

// ── Content normalization & hashing ───────────────────────────

/**
 * Extract frontmatter key-value pairs from a SKILL.md.
 * Returns a stable string representation for hashing.
 */
function normalizeFrontmatter(raw: string): string {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return '';

  const lines = match[1].split('\n');
  const pairs: Array<[string, string]> = [];

  for (const line of lines) {
    const m = line.match(/^(\w[\w-]*):\s*(.+)?$/);
    if (m) {
      pairs.push([m[1].trim(), (m[2] ?? '').trim()]);
    }
  }

  // Sort by key for stability across reformatted files
  pairs.sort((a, b) => a[0].localeCompare(b[0]));
  return pairs.map(([k, v]) => `${k}:${v}`).join('\n');
}

/**
 * Return the body content after frontmatter, with trailing whitespace removed per line.
 */
function normalizeBody(raw: string): string {
  const afterFm = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  return afterFm
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .trim();
}

function hashContent(raw: string): string {
  const fm = normalizeFrontmatter(raw);
  const body = normalizeBody(raw);
  const normalized = `${fm}\n---\n${body}`;
  return 'sha256:' + createHash('sha256').update(normalized, 'utf8').digest('hex');
}

// ── Skill discovery ───────────────────────────────────────────

interface DiscoveredSkill {
  name: string;
  skillPath: string;            // relative path: skills/Name/SKILL.md
  skillContent: string;
  workflows: Array<{ name: string; content: string }>;
  specializes: string | null;
}

function discoverSkills(): DiscoveredSkill[] {
  if (!existsSync(SKILLS_DIR)) {
    console.error(`Skills directory not found: ${SKILLS_DIR}`);
    process.exit(1);
  }

  const entries = readdirSync(SKILLS_DIR, { withFileTypes: true });
  const skills: DiscoveredSkill[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillName = entry.name;
    const skillMdPath = join(SKILLS_DIR, skillName, 'SKILL.md');
    if (!existsSync(skillMdPath)) continue;

    const skillContent = readFileSync(skillMdPath, 'utf8');

    // Extract `specializes:` from frontmatter
    const specializesMatch = skillContent.match(/^---[\s\S]*?^specializes:\s*(.+?)\s*$/m);
    const specializes = specializesMatch ? specializesMatch[1].replace(/^["']|["']$/g, '') : null;

    // Discover workflows
    const workflowsDir = join(SKILLS_DIR, skillName, 'Workflows');
    const workflows: Array<{ name: string; content: string }> = [];

    if (existsSync(workflowsDir)) {
      const wfEntries = readdirSync(workflowsDir, { withFileTypes: true });
      for (const wf of wfEntries) {
        if (!wf.isFile() || !wf.name.endsWith('.md')) continue;
        const wfContent = readFileSync(join(workflowsDir, wf.name), 'utf8');
        workflows.push({
          name: basename(wf.name, '.md'),
          content: wfContent,
        });
      }
      workflows.sort((a, b) => a.name.localeCompare(b.name));
    }

    skills.push({
      name: skillName,
      skillPath: `skills/${skillName}/SKILL.md`,
      skillContent,
      workflows,
      specializes,
    });
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

// ── Lock file operations ───────────────────────────────────────

function buildLockEntry(skill: DiscoveredSkill): SkillEntry {
  const workflowHashes: Record<string, string> = {};
  for (const wf of skill.workflows) {
    workflowHashes[wf.name] = hashContent(wf.content);
  }

  return {
    source: 'kai',
    path: skill.skillPath,
    hash: hashContent(skill.skillContent),
    workflows: skill.workflows.map(w => w.name),
    workflowHashes,
    specializes: skill.specializes,
  };
}

function generateLock(): LockFile {
  const skills = discoverSkills();
  const lockSkills: Record<string, SkillEntry> = {};
  for (const skill of skills) {
    lockSkills[skill.name] = buildLockEntry(skill);
  }
  return {
    version: 1,
    generated: new Date().toISOString(),
    skills: lockSkills,
  };
}

function readExistingLock(): LockFile | null {
  if (!existsSync(LOCK_FILE)) return null;
  try {
    return JSON.parse(readFileSync(LOCK_FILE, 'utf8')) as LockFile;
  } catch {
    return null;
  }
}

// ── Commands ──────────────────────────────────────────────────

function cmdGenerate() {
  const lock = generateLock();
  writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2) + '\n', 'utf8');
  const count = Object.keys(lock.skills).length;
  console.log(`Generated skills-lock.json — ${count} skills`);
}

interface DriftResult {
  added: string[];
  removed: string[];
  modified: string[];       // skill SKILL.md changed
  workflowsChanged: string[]; // workflow files changed
}

function computeDrift(existing: LockFile, current: LockFile): DriftResult {
  const drift: DriftResult = { added: [], removed: [], modified: [], workflowsChanged: [] };

  const existingNames = new Set(Object.keys(existing.skills));
  const currentNames = new Set(Object.keys(current.skills));

  for (const name of currentNames) {
    if (!existingNames.has(name)) {
      drift.added.push(name);
    } else {
      const e = existing.skills[name];
      const c = current.skills[name];
      if (e.hash !== c.hash) {
        drift.modified.push(name);
      }
      // Check workflow changes separately
      const eWfHashes = JSON.stringify(e.workflowHashes);
      const cWfHashes = JSON.stringify(c.workflowHashes);
      if (eWfHashes !== cWfHashes) {
        drift.workflowsChanged.push(name);
      }
    }
  }

  for (const name of existingNames) {
    if (!currentNames.has(name)) drift.removed.push(name);
  }

  return drift;
}

function cmdVerify(strict: boolean): boolean {
  const existing = readExistingLock();
  if (!existing) {
    console.error('skills-lock.json not found. Run: bun scripts/skills-lock.ts generate');
    process.exit(1);
  }

  const current = generateLock();
  const drift = computeDrift(existing, current);
  const hasDrift = drift.added.length > 0 || drift.removed.length > 0 ||
    drift.modified.length > 0 || drift.workflowsChanged.length > 0;

  if (!hasDrift) {
    if (strict) console.log('OK — skills match lock file');
    return true;
  }

  if (strict) {
    console.log('DRIFT DETECTED — skills-lock.json is out of date:\n');
    if (drift.added.length > 0) {
      console.log(`  Added (${drift.added.length}): ${drift.added.join(', ')}`);
    }
    if (drift.removed.length > 0) {
      console.log(`  Removed (${drift.removed.length}): ${drift.removed.join(', ')}`);
    }
    if (drift.modified.length > 0) {
      console.log(`  Modified SKILL.md (${drift.modified.length}): ${drift.modified.join(', ')}`);
    }
    if (drift.workflowsChanged.length > 0) {
      console.log(`  Workflows changed (${drift.workflowsChanged.length}): ${drift.workflowsChanged.join(', ')}`);
    }
    console.log('\nRun: bun scripts/skills-lock.ts generate');
  } else {
    const total = drift.added.length + drift.removed.length +
      drift.modified.length + drift.workflowsChanged.length;
    console.error(`skills-lock drift detected (${total} changes). Run: bun scripts/skills-lock.ts verify --strict`);
  }

  return false;
}

function cmdDiff() {
  const existing = readExistingLock();
  if (!existing) {
    console.log('No skills-lock.json found — run generate first');
    return;
  }

  const current = generateLock();
  const drift = computeDrift(existing, current);
  const hasAny = drift.added.length > 0 || drift.removed.length > 0 ||
    drift.modified.length > 0 || drift.workflowsChanged.length > 0;

  if (!hasAny) {
    console.log('No changes — skills match lock file');
    return;
  }

  if (drift.added.length > 0) {
    for (const name of drift.added) {
      const wfCount = current.skills[name].workflows.length;
      console.log(`+ ${name} (${wfCount} workflows)`);
    }
  }
  if (drift.removed.length > 0) {
    for (const name of drift.removed) {
      console.log(`- ${name}`);
    }
  }
  if (drift.modified.length > 0) {
    for (const name of drift.modified) {
      console.log(`~ ${name} (SKILL.md changed)`);
    }
  }
  if (drift.workflowsChanged.length > 0) {
    for (const name of drift.workflowsChanged) {
      const e = existing.skills[name];
      const c = current.skills[name];
      const eSet = new Set(Object.keys(e.workflowHashes));
      const cSet = new Set(Object.keys(c.workflowHashes));
      const wfAdded = [...cSet].filter(w => !eSet.has(w));
      const wfRemoved = [...eSet].filter(w => !cSet.has(w));
      const wfMod = [...cSet].filter(w => eSet.has(w) && e.workflowHashes[w] !== c.workflowHashes[w]);
      const parts: string[] = [];
      if (wfAdded.length) parts.push(`+${wfAdded.join(', +')}`);
      if (wfRemoved.length) parts.push(`-${wfRemoved.join(', -')}`);
      if (wfMod.length) parts.push(`~${wfMod.join(', ~')}`);
      console.log(`~ ${name} workflows: ${parts.join(' ')}`);
    }
  }
}

// ── Specialization validation ─────────────────────────────────

interface SpecializationDecl {
  skillName: string;
  specializes: string;
  overrides: string[];
  extends_: string[];
}

/**
 * Parse specialization fields from a project SKILL.md.
 * Returns null if the file has no `specializes:` field.
 */
export function parseSpecializationDecl(skillMdPath: string): SpecializationDecl | null {
  if (!existsSync(skillMdPath)) {
    console.error(`File not found: ${skillMdPath}`);
    process.exit(1);
  }

  const content = readFileSync(skillMdPath, 'utf8');
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return null;

  const fm = fmMatch[1];

  const specializesMatch = fm.match(/^specializes:\s*(.+?)\s*$/m);
  if (!specializesMatch) return null;

  const nameMatch = fm.match(/^name:\s*(.+?)\s*$/m);
  const skillName = nameMatch ? nameMatch[1].replace(/^["']|["']$/g, '') : basename(skillMdPath, '.md');
  const specializes = specializesMatch[1].replace(/^["']|["']$/g, '');

  // Parse YAML list fields: handles both inline [A, B] and block list (- A)
  function parseList(fieldName: string): string[] {
    const inlineMatch = fm.match(new RegExp(`^${fieldName}:\\s*\\[(.+?)\\]\\s*$`, 'm'));
    if (inlineMatch) {
      return inlineMatch[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    }
    // Block list: collect "  - item" lines that immediately follow "fieldName:"
    const lines = fm.split('\n');
    const fieldIdx = lines.findIndex(l => new RegExp(`^${fieldName}:\\s*$`).test(l));
    if (fieldIdx === -1) return [];
    const items: string[] = [];
    for (let i = fieldIdx + 1; i < lines.length; i++) {
      const m = lines[i].match(/^\s+-\s+(.+)/);
      if (!m) break; // stop at first non-list line
      items.push(m[1].trim().replace(/^["']|["']$/g, ''));
    }
    return items;
  }

  return {
    skillName,
    specializes,
    overrides: parseList('overrides'),
    extends_: parseList('extends'),
  };
}

export interface ValidationError {
  type: 'missing_parent' | 'invalid_override';
  message: string;
}

/**
 * Validate a specialization declaration against the lock file.
 * Returns array of errors (empty = valid).
 */
export function validateSpecialization(
  decl: SpecializationDecl,
  lock: LockFile,
  projectLabel?: string
): ValidationError[] {
  const errors: ValidationError[] = [];
  const label = projectLabel ? `${decl.skillName} (project:${projectLabel})` : decl.skillName;

  const parent = lock.skills[decl.specializes];
  if (!parent) {
    errors.push({
      type: 'missing_parent',
      message: `${label} specializes '${decl.specializes}' but no system skill found with that name. Available: [${Object.keys(lock.skills).sort().join(', ')}]`,
    });
    return errors; // Can't validate overrides without parent
  }

  const parentWorkflows = new Set(parent.workflows);
  for (const wf of decl.overrides) {
    if (!parentWorkflows.has(wf)) {
      errors.push({
        type: 'invalid_override',
        message: `${label} overrides '${wf}' but parent '${decl.specializes}' has no such workflow. Available: [${parent.workflows.sort().join(', ')}]`,
      });
    }
  }

  return errors;
}

function cmdValidateSpecialization(skillMdPath: string): boolean {
  const lock = readExistingLock();
  if (!lock) {
    console.error('skills-lock.json not found. Run: bun scripts/skills-lock.ts generate');
    process.exit(1);
  }

  const decl = parseSpecializationDecl(skillMdPath);
  if (!decl) {
    console.log(`No 'specializes:' field in ${skillMdPath} — nothing to validate`);
    return true;
  }

  const errors = validateSpecialization(decl, lock);
  if (errors.length === 0) {
    console.log(`OK — ${decl.skillName} specializes '${decl.specializes}' (${decl.overrides.length} overrides, ${decl.extends_.length} extends)`);
    return true;
  }

  for (const err of errors) {
    console.error(`ERROR [${err.type}]: ${err.message}`);
  }
  return false;
}

// ── Entry point ───────────────────────────────────────────────

// Only run CLI logic when this file is the entry point (not when imported by tests)
if (import.meta.main) {

// argv: [bun, script, cmd, ...rest]
const cmd = process.argv[2];
const rest = process.argv.slice(3);
const strict = rest.includes('--strict');
// positional args are non-flag entries
const positional = rest.filter(a => !a.startsWith('--'));

switch (cmd) {
  case 'generate':
    cmdGenerate();
    break;
  case 'verify':
    if (!cmdVerify(strict)) process.exit(1);
    break;
  case 'diff':
    cmdDiff();
    break;
  case 'validate-specialization': {
    const skillPath = positional[0];
    if (!skillPath) {
      console.error('Usage: bun scripts/skills-lock.ts validate-specialization <path/to/SKILL.md>');
      process.exit(1);
    }
    if (!cmdValidateSpecialization(skillPath)) process.exit(1);
    break;
  }
  default:
    console.log('Usage: bun scripts/skills-lock.ts <generate|verify|diff|validate-specialization> [--strict]');
    process.exit(1);
}

} // end import.meta.main
