/**
 * ConfigLoader.test.ts — Tests for hooks/lib/config-loader.ts
 *
 * Covers: normal load, missing config, malformed config, empty config,
 * and graceful degradation (no crash, safe defaults) for all 5 exports.
 *
 * Run: bun test tests/ConfigLoader.test.ts
 */

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { clearConfigCache } from '../hooks/lib/config-loader';

// Each test suite uses an isolated temp dir as PAI_DIR
let testDir: string;

beforeEach(() => {
  clearConfigCache();
  testDir = join(tmpdir(), `config-loader-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(testDir, 'config'), { recursive: true });
  process.env.PAI_DIR = testDir;
});

afterEach(() => {
  clearConfigCache();
  delete process.env.PAI_DIR;
  try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function writeDomainsConfig(content: string): void {
  writeFileSync(join(testDir, 'config', 'domains.jsonc'), content, 'utf-8');
}

async function loader() {
  return await import('../hooks/lib/config-loader.ts');
}

// ── Normal load (kai domains.jsonc) ────────────────────────────────

describe('loadDomainKeywords — normal config', () => {
  beforeEach(() => {
    writeDomainsConfig(`{
      "definitions": {
        "ai-infrastructure": {
          "description": "KAI system",
          "keywords": ["kai", "hook", "skill"]
        },
        "devops": {
          "description": "CI/CD pipelines",
          "keywords": ["docker", "kubernetes", "ci"]
        }
      }
    }`);
  });

  test('returns keywords for all defined domains', async () => {
    const { loadDomainKeywords } = await loader();
    const result = loadDomainKeywords();
    expect(Object.keys(result)).toContain('ai-infrastructure');
    expect(Object.keys(result)).toContain('devops');
    expect(result['ai-infrastructure']).toEqual(['kai', 'hook', 'skill']);
    expect(result['devops']).toEqual(['docker', 'kubernetes', 'ci']);
  });

  test('returns non-empty object', async () => {
    const { loadDomainKeywords } = await loader();
    expect(Object.keys(loadDomainKeywords()).length).toBeGreaterThan(0);
  });
});

describe('loadDomainDescriptions — normal config', () => {
  beforeEach(() => {
    writeDomainsConfig(`{
      "definitions": {
        "security": {
          "description": "Security practices and vulnerabilities",
          "keywords": ["security", "cve"]
        }
      }
    }`);
  });

  test('returns description strings for defined domains', async () => {
    const { loadDomainDescriptions } = await loader();
    const result = loadDomainDescriptions();
    expect(result['security']).toBe('Security practices and vulnerabilities');
  });
});

describe('loadProjectMapping — normal config', () => {
  beforeEach(() => {
    writeDomainsConfig(`{
      "definitions": {},
      "projectMapping": [
        { "pattern": "kai", "domains": ["ai-infrastructure"] },
        { "pattern": "myapp", "domains": ["backend", "devops"] }
      ]
    }`);
  });

  test('returns array of pattern/domains entries', async () => {
    const { loadProjectMapping } = await loader();
    const result = loadProjectMapping();
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ pattern: 'kai', domains: ['ai-infrastructure'] });
    expect(result[1]).toEqual({ pattern: 'myapp', domains: ['backend', 'devops'] });
  });
});

describe('loadExcludedProjects — normal config', () => {
  beforeEach(() => {
    writeDomainsConfig(`{
      "definitions": {},
      "excludedProjects": ["personal-finance", "private-notes"]
    }`);
  });

  test('returns the excluded project list', async () => {
    const { loadExcludedProjects } = await loader();
    const result = loadExcludedProjects();
    expect(result).toContain('personal-finance');
    expect(result).toContain('private-notes');
  });
});

describe('getMaxDomainsPerSession — normal config', () => {
  test('returns configured value when present', async () => {
    writeDomainsConfig(`{ "definitions": {}, "maxDomainsPerSession": 5 }`);
    const { getMaxDomainsPerSession } = await loader();
    expect(getMaxDomainsPerSession()).toBe(5);
  });

  test('returns default 3 when field absent', async () => {
    writeDomainsConfig(`{ "definitions": {} }`);
    const { getMaxDomainsPerSession } = await loader();
    expect(getMaxDomainsPerSession()).toBe(3);
  });
});

// ── Graceful degradation: missing file ───────────────────────────────────

describe('graceful degradation — missing config/domains.jsonc', () => {
  // No writeDomainsConfig call — file does not exist

  test('loadDomainKeywords returns empty object', async () => {
    const { loadDomainKeywords } = await loader();
    expect(loadDomainKeywords()).toEqual({});
  });

  test('loadDomainDescriptions returns empty object', async () => {
    const { loadDomainDescriptions } = await loader();
    expect(loadDomainDescriptions()).toEqual({});
  });

  test('loadProjectMapping returns empty array', async () => {
    const { loadProjectMapping } = await loader();
    expect(loadProjectMapping()).toEqual([]);
  });

  test('loadExcludedProjects returns empty array', async () => {
    const { loadExcludedProjects } = await loader();
    expect(loadExcludedProjects()).toEqual([]);
  });

  test('getMaxDomainsPerSession returns default 3', async () => {
    const { getMaxDomainsPerSession } = await loader();
    expect(getMaxDomainsPerSession()).toBe(3);
  });
});

// ── Graceful degradation: malformed JSON ─────────────────────────────────

describe('graceful degradation — malformed config/domains.jsonc', () => {
  beforeEach(() => {
    writeDomainsConfig(`{ this is not valid json !!!`);
  });

  test('loadDomainKeywords returns empty object', async () => {
    const { loadDomainKeywords } = await loader();
    expect(loadDomainKeywords()).toEqual({});
  });

  test('loadDomainDescriptions returns empty object', async () => {
    const { loadDomainDescriptions } = await loader();
    expect(loadDomainDescriptions()).toEqual({});
  });

  test('loadProjectMapping returns empty array', async () => {
    const { loadProjectMapping } = await loader();
    expect(loadProjectMapping()).toEqual([]);
  });

  test('loadExcludedProjects returns empty array', async () => {
    const { loadExcludedProjects } = await loader();
    expect(loadExcludedProjects()).toEqual([]);
  });

  test('getMaxDomainsPerSession returns default 3', async () => {
    const { getMaxDomainsPerSession } = await loader();
    expect(getMaxDomainsPerSession()).toBe(3);
  });
});

// ── Graceful degradation: empty definitions object ────────────────────────

describe('graceful degradation — empty definitions', () => {
  beforeEach(() => {
    writeDomainsConfig(`{
      "definitions": {},
      "projectMapping": [],
      "excludedProjects": [],
      "maxDomainsPerSession": 3
    }`);
  });

  test('loadDomainKeywords returns empty object', async () => {
    const { loadDomainKeywords } = await loader();
    expect(loadDomainKeywords()).toEqual({});
  });

  test('loadDomainDescriptions returns empty object', async () => {
    const { loadDomainDescriptions } = await loader();
    expect(loadDomainDescriptions()).toEqual({});
  });

  test('loadProjectMapping returns empty array', async () => {
    const { loadProjectMapping } = await loader();
    expect(loadProjectMapping()).toEqual([]);
  });
});

// ── Actual kai domains.jsonc integration check ────────────────────

describe('integration — actual kai domains.jsonc', () => {
  beforeEach(() => {
    // Point PAI_DIR at the real kai repo root
    process.env.PAI_DIR = join(import.meta.dir, '..');
  });

  test('loads exactly 5 domains', async () => {
    const { loadDomainKeywords } = await loader();
    const result = loadDomainKeywords();
    expect(Object.keys(result)).toHaveLength(5);
  });

  test('all 5 expected domains are present', async () => {
    const { loadDomainKeywords } = await loader();
    const domains = Object.keys(loadDomainKeywords());
    const expected = ['ai-infrastructure', 'backend', 'devops', 'frontend', 'security'];
    for (const d of expected) {
      expect(domains).toContain(d);
    }
  });

  test('each domain has at least one keyword', async () => {
    const { loadDomainKeywords } = await loader();
    for (const [domain, keywords] of Object.entries(loadDomainKeywords())) {
      expect(keywords.length).toBeGreaterThan(0);
    }
  });

  test('each domain has a description', async () => {
    const { loadDomainDescriptions } = await loader();
    for (const [domain, desc] of Object.entries(loadDomainDescriptions())) {
      expect(typeof desc).toBe('string');
      expect(desc.length).toBeGreaterThan(0);
    }
  });

  test('kai project maps to ai-infrastructure', async () => {
    const { loadProjectMapping } = await loader();
    const mapping = loadProjectMapping();
    const paiEntry = mapping.find(e => e.pattern === 'kai');
    expect(paiEntry).toBeDefined();
    expect(paiEntry!.domains).toContain('ai-infrastructure');
  });

  test('maxDomainsPerSession is 3', async () => {
    const { getMaxDomainsPerSession } = await loader();
    expect(getMaxDomainsPerSession()).toBe(3);
  });
});

// ── JSONC comment stripping ───────────────────────────────────────────────

describe('JSONC comment handling', () => {
  test('line comments are stripped correctly', async () => {
    writeDomainsConfig(`{
      // This is a comment
      "definitions": {
        "backend": {
          "description": "Backend services", // inline comment
          "keywords": ["api", "server"]
        }
      }
    }`);
    const { loadDomainKeywords } = await loader();
    const result = loadDomainKeywords();
    expect(result['backend']).toEqual(['api', 'server']);
  });

  test('block comments are stripped correctly', async () => {
    writeDomainsConfig(`{
      /* block comment */
      "definitions": {
        "frontend": {
          "description": "Frontend",
          "keywords": ["react", "css"]
        }
      }
    }`);
    const { loadDomainKeywords } = await loader();
    expect(loadDomainKeywords()['frontend']).toEqual(['react', 'css']);
  });

  test('URLs with // in string values are preserved', async () => {
    writeDomainsConfig(`{
      "definitions": {
        "backend": {
          "description": "See https://example.com/docs for reference",
          "keywords": ["api", "http://internal", "service"]
        }
      }
    }`);
    const { loadDomainKeywords, loadDomainDescriptions } = await loader();
    expect(loadDomainKeywords()['backend']).toEqual(['api', 'http://internal', 'service']);
    expect(loadDomainDescriptions()['backend']).toBe('See https://example.com/docs for reference');
  });

  test('trailing commas in objects and arrays are handled', async () => {
    writeDomainsConfig(`{
      "definitions": {
        "backend": {
          "description": "Backend",
          "keywords": ["api", "server",],
        },
      },
    }`);
    const { loadDomainKeywords } = await loader();
    expect(loadDomainKeywords()['backend']).toEqual(['api', 'server']);
  });
});
