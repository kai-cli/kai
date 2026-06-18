/**
 * KnowledgeSchema.test.ts — Tests for hooks/lib/knowledge-schema.ts
 *
 * Covers: parse, validate, write, loadAll, roundtrip, edge cases,
 * malformed frontmatter, partial fields, and boundary conditions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir: string;
let knowledgeDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `knowledge-schema-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  knowledgeDir = join(testDir, 'MEMORY', 'KNOWLEDGE');
  mkdirSync(knowledgeDir, { recursive: true });
  process.env.PAI_DIR = testDir;
});

afterEach(() => {
  delete process.env.PAI_DIR;
  try { rmSync(testDir, { recursive: true, force: true }); } catch {}
});

function writeKnowledgeFixture(filename: string, content: string): string {
  const path = join(knowledgeDir, filename);
  writeFileSync(path, content, 'utf-8');
  return path;
}

async function schema() {
  return await import('../hooks/lib/knowledge-schema');
}

describe('KnowledgeSchema', () => {
  describe('parseKnowledgeFile', () => {
    it('parses valid frontmatter with all fields', async () => {
      const { parseKnowledgeFile } = await schema();
      const path = writeKnowledgeFixture('test.md', [
        '---',
        'domain: firmware',
        'updated: 2026-05-18',
        'tags: [openwrt, embedded, yourcompany]',
        'related: [api-and-services]',
        '---',
        '## Content here',
        'Some body text.',
      ].join('\n'));

      const result = parseKnowledgeFile(path);
      expect(result).not.toBeNull();
      expect(result!.meta.domain).toBe('firmware');
      expect(result!.meta.updated).toBe('2026-05-18');
      expect(result!.meta.tags).toEqual(['openwrt', 'embedded', 'yourcompany']);
      expect(result!.meta.related).toEqual(['api-and-services']);
      expect(result!.body).toContain('## Content here');
      expect(result!.slug).toBe('test');
    });

    it('returns null for file without frontmatter', async () => {
      const { parseKnowledgeFile } = await schema();
      const path = writeKnowledgeFixture('no-fm.md', '## Just content\nNo frontmatter here.');
      const result = parseKnowledgeFile(path);
      expect(result).toBeNull();
    });

    it('returns null for non-existent file', async () => {
      const { parseKnowledgeFile } = await schema();
      const result = parseKnowledgeFile('/does/not/exist.md');
      expect(result).toBeNull();
    });

    it('returns null for incomplete frontmatter (missing closing ---)', async () => {
      const { parseKnowledgeFile } = await schema();
      const path = writeKnowledgeFixture('broken.md', [
        '---',
        'domain: test',
        'updated: 2026-01-01',
        'tags: [a]',
        'related: []',
        '## No closing delimiter',
      ].join('\n'));
      const result = parseKnowledgeFile(path);
      expect(result).toBeNull();
    });

    it('returns null when required field domain is missing', async () => {
      const { parseKnowledgeFile } = await schema();
      const path = writeKnowledgeFixture('no-domain.md', [
        '---',
        'updated: 2026-01-01',
        'tags: [a]',
        'related: []',
        '---',
        'body',
      ].join('\n'));
      const result = parseKnowledgeFile(path);
      expect(result).toBeNull();
    });

    it('returns null when required field tags is missing', async () => {
      const { parseKnowledgeFile } = await schema();
      const path = writeKnowledgeFixture('no-tags.md', [
        '---',
        'domain: test',
        'updated: 2026-01-01',
        'related: []',
        '---',
        'body',
      ].join('\n'));
      const result = parseKnowledgeFile(path);
      expect(result).toBeNull();
    });

    it('handles empty related array', async () => {
      const { parseKnowledgeFile } = await schema();
      const path = writeKnowledgeFixture('empty-related.md', [
        '---',
        'domain: test',
        'updated: 2026-05-01',
        'tags: [foo, bar]',
        'related: []',
        '---',
        'body',
      ].join('\n'));
      const result = parseKnowledgeFile(path);
      expect(result).not.toBeNull();
      expect(result!.meta.related).toEqual([]);
    });

    it('preserves body content including empty lines', async () => {
      const { parseKnowledgeFile } = await schema();
      const body = '## Heading\n\nParagraph one.\n\nParagraph two.\n';
      const path = writeKnowledgeFixture('preserve.md', [
        '---',
        'domain: test',
        'updated: 2026-01-01',
        'tags: [x]',
        'related: []',
        '---',
        body,
      ].join('\n'));
      const result = parseKnowledgeFile(path);
      expect(result).not.toBeNull();
      expect(result!.body).toBe(body);
    });
  });

  describe('validateKnowledgeMeta', () => {
    it('returns empty array for valid meta', async () => {
      const { validateKnowledgeMeta } = await schema();
      const errors = validateKnowledgeMeta({
        domain: 'test',
        updated: '2026-05-18',
        tags: ['a', 'b'],
        related: [],
      });
      expect(errors).toHaveLength(0);
    });

    it('reports missing domain', async () => {
      const { validateKnowledgeMeta } = await schema();
      const errors = validateKnowledgeMeta({ updated: '2026-01-01', tags: ['a'], related: [] });
      expect(errors.some(e => e.includes('domain'))).toBe(true);
    });

    it('reports empty domain', async () => {
      const { validateKnowledgeMeta } = await schema();
      const errors = validateKnowledgeMeta({ domain: '', updated: '2026-01-01', tags: ['a'], related: [] });
      expect(errors.some(e => e.includes('domain'))).toBe(true);
    });

    it('reports invalid date format', async () => {
      const { validateKnowledgeMeta } = await schema();
      const errors = validateKnowledgeMeta({ domain: 'x', updated: 'May 2026', tags: ['a'], related: [] });
      expect(errors.some(e => e.includes('YYYY-MM-DD'))).toBe(true);
    });

    it('reports date with slashes as invalid', async () => {
      const { validateKnowledgeMeta } = await schema();
      const errors = validateKnowledgeMeta({ domain: 'x', updated: '2026/05/18', tags: ['a'], related: [] });
      expect(errors.some(e => e.includes('YYYY-MM-DD'))).toBe(true);
    });

    it('reports empty tags array', async () => {
      const { validateKnowledgeMeta } = await schema();
      const errors = validateKnowledgeMeta({ domain: 'x', updated: '2026-01-01', tags: [], related: [] });
      expect(errors.some(e => e.includes('tags'))).toBe(true);
    });

    it('reports non-string items in tags', async () => {
      const { validateKnowledgeMeta } = await schema();
      const errors = validateKnowledgeMeta({ domain: 'x', updated: '2026-01-01', tags: [1, 'b'], related: [] });
      expect(errors.some(e => e.includes('strings'))).toBe(true);
    });

    it('reports missing related field', async () => {
      const { validateKnowledgeMeta } = await schema();
      const errors = validateKnowledgeMeta({ domain: 'x', updated: '2026-01-01', tags: ['a'] });
      expect(errors.some(e => e.includes('related'))).toBe(true);
    });

    it('reports non-object input', async () => {
      const { validateKnowledgeMeta } = await schema();
      expect(validateKnowledgeMeta(null)).toHaveLength(1);
      expect(validateKnowledgeMeta(undefined)).toHaveLength(1);
      expect(validateKnowledgeMeta('string')).toHaveLength(1);
    });
  });

  describe('writeKnowledgeFile', () => {
    it('writes frontmatter and body to disk', async () => {
      const { writeKnowledgeFile } = await schema();
      const path = join(knowledgeDir, 'write-test.md');
      writeKnowledgeFile({
        meta: { domain: 'test', updated: '2026-05-18', tags: ['a', 'b'], related: ['other'] },
        body: '## Hello\nWorld\n',
        path,
        slug: 'write-test',
      });
      const content = readFileSync(path, 'utf-8');
      expect(content).toStartWith('---\n');
      expect(content).toContain('domain: test');
      expect(content).toContain('tags: [a, b]');
      expect(content).toContain('related: [other]');
      expect(content).toContain('## Hello\nWorld\n');
    });

    it('write then parse roundtrip preserves all fields', async () => {
      const { writeKnowledgeFile, parseKnowledgeFile } = await schema();
      const path = join(knowledgeDir, 'roundtrip.md');
      const original = {
        meta: { domain: 'firmware', updated: '2026-05-18', tags: ['openwrt', 'sdk'], related: ['devops'] },
        body: '## Build System\n\nDetails here.\n\n## Packages\n\nMore details.\n',
        path,
        slug: 'roundtrip',
      };

      writeKnowledgeFile(original);
      const parsed = parseKnowledgeFile(path);

      expect(parsed).not.toBeNull();
      expect(parsed!.meta).toEqual(original.meta);
      expect(parsed!.body).toBe(original.body);
      expect(parsed!.slug).toBe('roundtrip');
    });

    it('double write-read roundtrip is stable (no trailing newline drift)', async () => {
      const { writeKnowledgeFile, parseKnowledgeFile } = await schema();
      const path = join(knowledgeDir, 'stable.md');
      const file = {
        meta: { domain: 'x', updated: '2026-01-01', tags: ['t'], related: [] },
        body: 'body\n',
        path,
        slug: 'stable',
      };

      writeKnowledgeFile(file);
      const first = readFileSync(path, 'utf-8');

      const parsed = parseKnowledgeFile(path)!;
      writeKnowledgeFile(parsed);
      const second = readFileSync(path, 'utf-8');

      expect(second).toBe(first);
    });
  });

  describe('loadAllKnowledge', () => {
    it('loads all .md files except INDEX.md', async () => {
      const { loadAllKnowledge } = await schema();
      writeKnowledgeFixture('domain-a.md', '---\ndomain: a\nupdated: 2026-01-01\ntags: [x]\nrelated: []\n---\nbody');
      writeKnowledgeFixture('domain-b.md', '---\ndomain: b\nupdated: 2026-01-01\ntags: [y]\nrelated: []\n---\nbody');
      writeKnowledgeFixture('INDEX.md', '# Index\nThis should be skipped.');

      const all = loadAllKnowledge();
      expect(all.length).toBe(2);
      expect(all.map(f => f.slug).sort()).toEqual(['domain-a', 'domain-b']);
    });

    it('skips files without valid frontmatter', async () => {
      const { loadAllKnowledge } = await schema();
      writeKnowledgeFixture('valid.md', '---\ndomain: v\nupdated: 2026-01-01\ntags: [x]\nrelated: []\n---\nbody');
      writeKnowledgeFixture('invalid.md', '# No frontmatter here');

      const all = loadAllKnowledge();
      expect(all.length).toBe(1);
      expect(all[0].slug).toBe('valid');
    });

    it('returns empty array when directory does not exist', async () => {
      const { loadAllKnowledge } = await schema();
      process.env.PAI_DIR = '/nonexistent/path';
      const all = loadAllKnowledge();
      expect(all).toEqual([]);
    });

    it('returns empty array when directory is empty', async () => {
      const { loadAllKnowledge } = await schema();
      // knowledgeDir exists but has no .md files
      const all = loadAllKnowledge();
      expect(all).toEqual([]);
    });
  });
});
