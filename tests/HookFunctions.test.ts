import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// --- AlgorithmTracker tests ---
import { detectPhaseFromBash, parseCriterion } from '../hooks/AlgorithmTracker.hook';

describe('detectPhaseFromBash', () => {
  test('detects OBSERVE phase from curl command', () => {
    const cmd = `curl -s -X POST http://localhost:8888/notify -d '{"message": "Entering the Observe phase"}'`;
    const result = detectPhaseFromBash(cmd);
    expect(result.phase).toBe('OBSERVE');
    expect(result.isAlgorithmEntry).toBe(false);
  });

  test('detects THINK phase', () => {
    const cmd = `curl -s http://localhost:8888/notify -d '{"message": "Entering the Think phase"}'`;
    expect(detectPhaseFromBash(cmd).phase).toBe('THINK');
  });

  test('detects PLAN phase', () => {
    const cmd = `curl -s http://localhost:8888/notify -d '{"message": "Entering the Plan phase"}'`;
    expect(detectPhaseFromBash(cmd).phase).toBe('PLAN');
  });

  test('detects BUILD phase', () => {
    const cmd = `curl -s http://localhost:8888/notify -d '{"message": "Entering the Build phase"}'`;
    expect(detectPhaseFromBash(cmd).phase).toBe('BUILD');
  });

  test('detects EXECUTE phase', () => {
    const cmd = `curl -s http://localhost:8888/notify -d '{"message": "Entering the Execute phase"}'`;
    expect(detectPhaseFromBash(cmd).phase).toBe('EXECUTE');
  });

  test('detects VERIFY phase', () => {
    const cmd = `curl -s http://localhost:8888/notify -d '{"message": "Entering the Verify phase"}'`;
    expect(detectPhaseFromBash(cmd).phase).toBe('VERIFY');
  });

  test('detects VERIFY phase with trailing period', () => {
    const cmd = `curl -s http://localhost:8888/notify -d '{"message": "Entering the Verify phase."}'`;
    expect(detectPhaseFromBash(cmd).phase).toBe('VERIFY');
  });

  test('detects LEARN phase', () => {
    const cmd = `curl -s http://localhost:8888/notify -d '{"message": "Entering the Learn phase"}'`;
    expect(detectPhaseFromBash(cmd).phase).toBe('LEARN');
  });

  test('detects algorithm entry', () => {
    const cmd = `curl -s http://localhost:8888/notify -d '{"message": "Entering the PAI Algorithm"}'`;
    const result = detectPhaseFromBash(cmd);
    expect(result.phase).toBeNull();
    expect(result.isAlgorithmEntry).toBe(true);
  });

  test('returns null for non-notification commands', () => {
    const cmd = `curl -s http://localhost:8888/api/status`;
    const result = detectPhaseFromBash(cmd);
    expect(result.phase).toBeNull();
    expect(result.isAlgorithmEntry).toBe(false);
  });

  test('returns null for non-curl commands', () => {
    const cmd = `echo "entering the observe phase"`;
    const result = detectPhaseFromBash(cmd);
    expect(result.phase).toBeNull();
    expect(result.isAlgorithmEntry).toBe(false);
  });

  test('returns null for unrelated curl', () => {
    const cmd = `curl -s https://api.github.com/repos`;
    const result = detectPhaseFromBash(cmd);
    expect(result.phase).toBeNull();
    expect(result.isAlgorithmEntry).toBe(false);
  });

  test('handles message with extra content', () => {
    const cmd = `curl -s http://localhost:8888/notify -d '{"message": "Now entering the Build phase for task X"}'`;
    expect(detectPhaseFromBash(cmd).phase).toBe('BUILD');
  });
});

describe('parseCriterion', () => {
  test('parses ISC-C1 format', () => {
    const result = parseCriterion('ISC-C1: Tests pass at 100%');
    expect(result).toEqual({ id: 'C1', description: 'Tests pass at 100%' });
  });

  test('parses ISC-A1 format', () => {
    const result = parseCriterion('ISC-A1: No regressions in existing tests');
    expect(result).toEqual({ id: 'A1', description: 'No regressions in existing tests' });
  });

  test('parses ISC-C12 multi-digit', () => {
    const result = parseCriterion('ISC-C12: Large criterion ID');
    expect(result).toEqual({ id: 'C12', description: 'Large criterion ID' });
  });

  test('parses domain-named ISC format', () => {
    const result = parseCriterion('ISC-Hooks-1: Hook tests pass');
    expect(result).toEqual({ id: 'Hooks-1', description: 'Hook tests pass' });
  });

  test('parses ISC-A-Integration-1 format', () => {
    const result = parseCriterion('ISC-A-Integration-1: Integration works');
    expect(result).toEqual({ id: 'A-Integration-1', description: 'Integration works' });
  });

  test('parses bare C1 format', () => {
    const result = parseCriterion('C1: Simple criterion');
    expect(result).toEqual({ id: 'C1', description: 'Simple criterion' });
  });

  test('parses bare A2 format', () => {
    const result = parseCriterion('A2: Anti-criterion example');
    expect(result).toEqual({ id: 'A2', description: 'Anti-criterion example' });
  });

  test('returns null for non-criterion text', () => {
    expect(parseCriterion('Just a regular task')).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(parseCriterion('')).toBeNull();
  });

  test('trims description whitespace', () => {
    const result = parseCriterion('ISC-C1:   Padded description   ');
    expect(result?.description).toBe('Padded description');
  });
});

// --- SkillGuard tests ---
import { shouldBlockSkill, BLOCKED_SKILLS } from '../hooks/SkillGuard.hook';

describe('shouldBlockSkill', () => {
  test('blocks keybindings-help', () => {
    expect(shouldBlockSkill('keybindings-help')).toBe(true);
  });

  test('blocks with mixed case', () => {
    expect(shouldBlockSkill('Keybindings-Help')).toBe(true);
  });

  test('blocks with whitespace', () => {
    expect(shouldBlockSkill('  keybindings-help  ')).toBe(true);
  });

  test('allows legitimate skills', () => {
    expect(shouldBlockSkill('pai:end')).toBe(false);
  });

  test('allows deliberate skill', () => {
    expect(shouldBlockSkill('deliberate')).toBe(false);
  });

  test('allows empty string', () => {
    expect(shouldBlockSkill('')).toBe(false);
  });

  test('BLOCKED_SKILLS contains keybindings-help', () => {
    expect(BLOCKED_SKILLS).toContain('keybindings-help');
  });
});

// --- LocalContextFirst tests ---
import { buildDomainContext, loadDomainPatterns, matchesDomainTopics, readDomainKnowledge } from '../hooks/LocalContextFirst.hook';

describe('matchesDomainTopics', () => {
  const patterns = [
    { domain: 'firmware', keywords: ['openwrt', 'bbfdm', 'ubus', 'router'] },
    { domain: 'usp', keywords: ['obuspa', 'tr-369', 'usp protocol'] },
    { domain: 'flutter', keywords: ['flutter', 'dart', 'widget'] },
  ];

  test('matches single domain', () => {
    const matched = matchesDomainTopics('How do I configure the openwrt feed?', patterns);
    expect(matched).toEqual(['firmware']);
  });

  test('matches multiple domains', () => {
    const matched = matchesDomainTopics('openwrt router with obuspa agent', patterns);
    expect(matched).toContain('firmware');
    expect(matched).toContain('usp');
  });

  test('case insensitive matching', () => {
    const matched = matchesDomainTopics('Fix the FLUTTER build issue', patterns);
    expect(matched).toEqual(['flutter']);
  });

  test('returns empty for no matches', () => {
    const matched = matchesDomainTopics('How do I use git rebase?', patterns);
    expect(matched).toEqual([]);
  });

  test('matches multi-word keywords', () => {
    const matched = matchesDomainTopics('Implement the USP protocol handler', patterns);
    expect(matched).toEqual(['usp']);
  });

  test('handles empty prompt', () => {
    expect(matchesDomainTopics('', patterns)).toEqual([]);
  });

  test('handles empty patterns', () => {
    expect(matchesDomainTopics('openwrt stuff', [])).toEqual([]);
  });
});

describe('loadDomainPatterns', () => {
  test('returns array (may be empty if no config)', () => {
    const patterns = loadDomainPatterns();
    expect(Array.isArray(patterns)).toBe(true);
  });
});

describe('LocalContextFirst domain knowledge injection', () => {
  test('buildDomainContext injects matched domain body content', () => {
    const dir = join(tmpdir(), `local-context-domain-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    try {
      writeFileSync(join(dir, 'firmware.md'), 'Firmware local facts go here.\nUse release_v1.1 for builds.\n');
      const result = buildDomainContext(['firmware'], 4000, dir);
      expect(result.injected).toEqual(['firmware']);
      expect(result.missing).toEqual([]);
      expect(result.context).toContain('Retrieved domain knowledge');
      expect(result.context).toContain('## firmware');
      expect(result.context).toContain('Firmware local facts go here');
      expect(result.context).toContain('Use the injected local knowledge below before web research');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('buildDomainContext reports missing matched domain files without dropping the hint', () => {
    const dir = join(tmpdir(), `local-context-missing-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    try {
      const result = buildDomainContext(['missing-domain'], 4000, dir);
      expect(result.injected).toEqual([]);
      expect(result.missing).toEqual(['missing-domain']);
      expect(result.context).toContain('Topic matches configured domains: [missing-domain]');
      expect(result.context).toContain('Missing knowledge files for matched domains: [missing-domain]');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('readDomainKnowledge truncates and redacts credential-shaped content', () => {
    const dir = join(tmpdir(), `local-context-redact-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    try {
      const fixtureSecret = ['super', 'secret', 'value'].join('');
      writeFileSync(join(dir, 'security.md'), `password="${fixtureSecret}"\n` + 'x'.repeat(80));
      const content = readDomainKnowledge('security', 40, dir)!;
      expect(content).toContain('[REDACTED:Password assignment]');
      expect(content).not.toContain(fixtureSecret);
      expect(content).toContain('[... truncated domain knowledge to 40 chars]');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --- PreCompact tests ---
import { loadIdentity, loadAlgorithmState } from '../hooks/PreCompact.hook';

describe('loadIdentity', () => {
  test('returns object with expected shape', () => {
    const identity = loadIdentity();
    expect(identity).toHaveProperty('daName');
    expect(identity).toHaveProperty('principalName');
    expect(identity).toHaveProperty('timezone');
  });

  test('returns string values', () => {
    const identity = loadIdentity();
    expect(typeof identity.daName).toBe('string');
    expect(typeof identity.principalName).toBe('string');
    expect(typeof identity.timezone).toBe('string');
  });

  test('returns non-empty defaults', () => {
    const identity = loadIdentity();
    expect(identity.daName.length).toBeGreaterThan(0);
    expect(identity.principalName.length).toBeGreaterThan(0);
  });
});

describe('loadAlgorithmState', () => {
  test('returns null for non-existent session', () => {
    const state = loadAlgorithmState('nonexistent-session-id-xyz-000');
    expect(state).toBeNull();
  });

  test('returns null for empty session ID', () => {
    const state = loadAlgorithmState('');
    expect(state).toBeNull();
  });
});
