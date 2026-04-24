/**
 * ConfigLoader.test.ts — Tests for hooks/lib/config-loader.ts
 *
 * Run: bun test tests/ConfigLoader.test.ts
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let tmpDir: string;
let origPaiDir: string | undefined;

function setup() {
  tmpDir = mkdtempSync(join(tmpdir(), 'pai-config-loader-test-'));
  mkdirSync(join(tmpDir, 'config'), { recursive: true });
  origPaiDir = process.env.PAI_DIR;
  process.env.PAI_DIR = tmpDir;
}

function cleanup() {
  rmSync(tmpDir, { recursive: true, force: true });
  if (origPaiDir !== undefined) process.env.PAI_DIR = origPaiDir;
  else delete process.env.PAI_DIR;
}

async function freshImport() {
  const mod = await import('../hooks/lib/config-loader');
  mod._resetCache();
  return mod;
}

// ── parseJSONC ───────────────────────────────────────────────────────────────

describe('parseJSONC', () => {
  test('parses plain JSON', async () => {
    const { parseJSONC } = await freshImport();
    expect(parseJSONC('{"a": 1}')).toEqual({ a: 1 });
  });

  test('strips line comments', async () => {
    const { parseJSONC } = await freshImport();
    const result = parseJSONC('{\n  // comment\n  "key": "value"\n}');
    expect(result).toEqual({ key: 'value' });
  });

  test('strips block comments', async () => {
    const { parseJSONC } = await freshImport();
    const result = parseJSONC('{ /* block */ "key": "value" }');
    expect(result).toEqual({ key: 'value' });
  });

  test('handles trailing commas', async () => {
    const { parseJSONC } = await freshImport();
    const result = parseJSONC('{"a": 1, "b": 2,}');
    expect(result).toEqual({ a: 1, b: 2 });
  });

  test('preserves URLs in strings', async () => {
    const { parseJSONC } = await freshImport();
    const result = parseJSONC('{"url": "https://example.com"}') as Record<string, unknown>;
    expect(result.url).toBe('https://example.com');
  });
});

// ── Missing/invalid config → defaults ────────────────────────────────────────

describe('missing config file', () => {
  beforeEach(setup);
  afterEach(cleanup);

  test('returns empty definitions when domains.jsonc missing', async () => {
    const { loadDomainKeywords, _resetCache } = await freshImport();
    _resetCache();
    expect(loadDomainKeywords()).toEqual({});
  });

  test('returns empty descriptions when domains.jsonc missing', async () => {
    const { loadDomainDescriptions, _resetCache } = await freshImport();
    _resetCache();
    expect(loadDomainDescriptions()).toEqual({});
  });

  test('returns default maxDomainsPerSession when missing', async () => {
    const { getMaxDomainsPerSession, _resetCache } = await freshImport();
    _resetCache();
    expect(getMaxDomainsPerSession()).toBe(3);
  });

  test('returns empty arrays when missing', async () => {
    const { loadProjectMapping, loadExcludedProjects, _resetCache } = await freshImport();
    _resetCache();
    expect(loadProjectMapping()).toEqual([]);
    expect(loadExcludedProjects()).toEqual([]);
  });
});

describe('malformed config file', () => {
  beforeEach(setup);
  afterEach(cleanup);

  test('returns defaults on invalid JSON', async () => {
    writeFileSync(join(tmpDir, 'config', 'domains.jsonc'), 'NOT JSON {{{');
    const { loadDomainsConfig, _resetCache } = await freshImport();
    _resetCache();
    const config = loadDomainsConfig();
    expect(config.definitions).toEqual({});
    expect(config.maxDomainsPerSession).toBe(3);
  });
});

// ── Valid config ─────────────────────────────────────────────────────────────

describe('valid config', () => {
  beforeEach(() => {
    setup();
    writeFileSync(join(tmpDir, 'config', 'domains.jsonc'), JSON.stringify({
      definitions: {
        backend: {
          description: 'Backend services',
          keywords: ['api', 'server'],
        },
        frontend: {
          description: 'Frontend apps',
          keywords: ['react', 'css'],
        },
      },
      projectMapping: [
        { pattern: '*/api', domains: ['backend'] },
      ],
      excludedProjects: ['node_modules'],
      maxDomainsPerSession: 5,
    }));
  });
  afterEach(cleanup);

  test('loadDomainKeywords returns keyword map', async () => {
    const { loadDomainKeywords, _resetCache } = await freshImport();
    _resetCache();
    const keywords = loadDomainKeywords();
    expect(keywords.backend).toEqual(['api', 'server']);
    expect(keywords.frontend).toEqual(['react', 'css']);
  });

  test('loadDomainDescriptions returns description map', async () => {
    const { loadDomainDescriptions, _resetCache } = await freshImport();
    _resetCache();
    const descs = loadDomainDescriptions();
    expect(descs.backend).toBe('Backend services');
    expect(descs.frontend).toBe('Frontend apps');
  });

  test('loadDomainDefinitions returns array of definitions', async () => {
    const { loadDomainDefinitions, _resetCache } = await freshImport();
    _resetCache();
    const defs = loadDomainDefinitions();
    expect(defs).toHaveLength(2);
    expect(defs[0]).toEqual({ name: 'backend', description: 'Backend services', keywords: ['api', 'server'] });
  });

  test('loadProjectMapping returns mappings', async () => {
    const { loadProjectMapping, _resetCache } = await freshImport();
    _resetCache();
    const mappings = loadProjectMapping();
    expect(mappings).toHaveLength(1);
    expect(mappings[0].pattern).toBe('*/api');
  });

  test('loadExcludedProjects returns exclusion list', async () => {
    const { loadExcludedProjects, _resetCache } = await freshImport();
    _resetCache();
    expect(loadExcludedProjects()).toEqual(['node_modules']);
  });

  test('getMaxDomainsPerSession returns configured value', async () => {
    const { getMaxDomainsPerSession, _resetCache } = await freshImport();
    _resetCache();
    expect(getMaxDomainsPerSession()).toBe(5);
  });

  test('loadDomainsConfig returns full config', async () => {
    const { loadDomainsConfig, _resetCache } = await freshImport();
    _resetCache();
    const config = loadDomainsConfig();
    expect(Object.keys(config.definitions)).toHaveLength(2);
    expect(config.maxDomainsPerSession).toBe(5);
    expect(config.excludedProjects).toEqual(['node_modules']);
  });
});

// ── Partial config (missing fields use defaults) ─────────────────────────────

describe('partial config', () => {
  beforeEach(() => {
    setup();
    writeFileSync(join(tmpDir, 'config', 'domains.jsonc'), JSON.stringify({
      definitions: {
        devops: { description: 'DevOps', keywords: ['docker'] },
      },
    }));
  });
  afterEach(cleanup);

  test('missing fields fall back to defaults', async () => {
    const { loadDomainsConfig, _resetCache } = await freshImport();
    _resetCache();
    const config = loadDomainsConfig();
    expect(config.projectMapping).toEqual([]);
    expect(config.excludedProjects).toEqual([]);
    expect(config.maxDomainsPerSession).toBe(3);
    expect(Object.keys(config.definitions)).toEqual(['devops']);
  });
});

// ── JSONC with comments (real-world starter file format) ─────────────────────

describe('JSONC with comments', () => {
  beforeEach(() => {
    setup();
    writeFileSync(join(tmpDir, 'config', 'domains.jsonc'), `
// Domain config with comments
{
  // The definitions
  "definitions": {
    "backend": {
      "description": "Backend services",
      "keywords": ["api", "server"],
    },
  },
  /* block comment */
  "maxDomainsPerSession": 2,
}
`);
  });
  afterEach(cleanup);

  test('loads JSONC with line comments, block comments, and trailing commas', async () => {
    const { loadDomainsConfig, _resetCache } = await freshImport();
    _resetCache();
    const config = loadDomainsConfig();
    expect(config.definitions.backend.keywords).toEqual(['api', 'server']);
    expect(config.maxDomainsPerSession).toBe(2);
  });
});

// ── Cache behavior ───────────────────────────────────────────────────────────

describe('caching', () => {
  beforeEach(() => {
    setup();
    writeFileSync(join(tmpDir, 'config', 'domains.jsonc'), JSON.stringify({
      definitions: { a: { description: 'A', keywords: ['a'] } },
      maxDomainsPerSession: 7,
    }));
  });
  afterEach(cleanup);

  test('returns same object on repeated calls (cache hit)', async () => {
    const { loadDomainsConfig, _resetCache } = await freshImport();
    _resetCache();
    const first = loadDomainsConfig();
    const second = loadDomainsConfig();
    expect(first).toBe(second);
  });

  test('_resetCache forces re-read', async () => {
    const { loadDomainsConfig, _resetCache } = await freshImport();
    _resetCache();
    const first = loadDomainsConfig();
    expect(first.maxDomainsPerSession).toBe(7);

    writeFileSync(join(tmpDir, 'config', 'domains.jsonc'), JSON.stringify({
      definitions: {},
      maxDomainsPerSession: 10,
    }));
    _resetCache();
    const second = loadDomainsConfig();
    expect(second.maxDomainsPerSession).toBe(10);
    expect(first).not.toBe(second);
  });
});
