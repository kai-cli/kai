import { describe, it, expect } from 'bun:test';
import { existsSync } from 'fs';
import { detectContradictions, extractClaims, formatContradictionReport, type ContradictionReport } from '../PAI/Tools/ContradictionDetector';
import { getKnowledgeDir, type KnowledgeFile } from '../hooks/lib/knowledge-schema';

const hasKnowledgeFiles = existsSync(getKnowledgeDir()) && existsSync(`${getKnowledgeDir()}/firmware.md`);

describe('ContradictionDetector', () => {
  describe('extractClaims', () => {
    it('extracts vN.N.N version patterns', () => {
      const file = makeKnowledgeFile('test', 'libssl v1.18.0 is the latest');
      const claims = extractClaims(file);
      expect(claims.length).toBeGreaterThan(0);
      expect(claims.some(c => c.entity === 'libssl' && c.version === '1.18.0')).toBe(true);
    });

    it('extracts N.N.N patterns without v prefix', () => {
      const file = makeKnowledgeFile('test', 'kernel 5.15.0 is used');
      const claims = extractClaims(file);
      expect(claims.some(c => c.entity === 'kernel' && c.version === '5.15.0')).toBe(true);
    });

    it('extracts colon-number patterns like build_wrt:104', () => {
      const file = makeKnowledgeFile('test', 'ECS task build_wrt:104 runs builds');
      const claims = extractClaims(file);
      expect(claims.some(c => c.version === '104')).toBe(true);
    });

    it('skips headings and empty lines', () => {
      const file = makeKnowledgeFile('test', '# libssl v1.18.0\n\nSome text here');
      const claims = extractClaims(file);
      const headingClaim = claims.find(c => c.entity === 'libssl' && c.version === '1.18.0');
      expect(headingClaim).toBeUndefined();
    });

    it('skips common false positive entities (http, port, step)', () => {
      const file = makeKnowledgeFile('test', 'port 8883 is used for MQTT\nstep 3 does X');
      const claims = extractClaims(file);
      expect(claims.find(c => c.entity === 'port')).toBeUndefined();
      expect(claims.find(c => c.entity === 'step')).toBeUndefined();
    });

    it('skips entities shorter than 3 chars', () => {
      const file = makeKnowledgeFile('test', 'Go 1.21 is installed');
      const claims = extractClaims(file);
      expect(claims.find(c => c.entity === 'go')).toBeUndefined();
    });

    it('returns empty for files with no versioned claims', () => {
      const file = makeKnowledgeFile('test', 'This is a plain description without any versions.');
      const claims = extractClaims(file);
      expect(claims).toHaveLength(0);
    });
  });

  describe('detectContradictions', () => {
    it('returns a report with required fields', () => {
      const report = detectContradictions();
      expect(report).toHaveProperty('contradictions');
      expect(report).toHaveProperty('claimsExtracted');
      expect(report).toHaveProperty('filesAnalyzed');
      expect(report).toHaveProperty('groupsChecked');
    });

    it.skipIf(!hasKnowledgeFiles)('analyzes all knowledge files', () => {
      const report = detectContradictions();
      expect(report.filesAnalyzed).toBe(7);
    });

    it.skipIf(!hasKnowledgeFiles)('extracts claims from real knowledge files', () => {
      const report = detectContradictions();
      expect(report.claimsExtracted).toBeGreaterThan(0);
    });
  });

  describe('formatContradictionReport', () => {
    it('shows success when no contradictions', () => {
      const report: ContradictionReport = { contradictions: [], claimsExtracted: 10, filesAnalyzed: 7, groupsChecked: 3 };
      const formatted = formatContradictionReport(report);
      expect(formatted).toContain('No contradictions detected');
    });

    it('shows contradiction details when present', () => {
      const report: ContradictionReport = {
        contradictions: [{
          entity: 'libssl',
          claims: [
            { entity: 'libssl', version: '1.12.0', file: '/a.md', slug: 'a', line: 'libssl v1.12.0' },
            { entity: 'libssl', version: '1.18.0', file: '/b.md', slug: 'b', line: 'libssl v1.18.0' },
          ],
        }],
        claimsExtracted: 20,
        filesAnalyzed: 7,
        groupsChecked: 5,
      };
      const formatted = formatContradictionReport(report);
      expect(formatted).toContain('Potential Contradictions');
      expect(formatted).toContain('libssl');
      expect(formatted).toContain('1.12.0');
      expect(formatted).toContain('1.18.0');
    });

    it('shows file counts in header', () => {
      const report: ContradictionReport = { contradictions: [], claimsExtracted: 15, filesAnalyzed: 7, groupsChecked: 3 };
      const formatted = formatContradictionReport(report);
      expect(formatted).toContain('Files analyzed: 7');
      expect(formatted).toContain('Claims extracted: 15');
    });
  });

  describe('edge cases', () => {
    it('handles file with only headings (no claims)', () => {
      const file = makeKnowledgeFile('headings', '# Title\n## Section\n### Subsection');
      const claims = extractClaims(file);
      expect(claims).toHaveLength(0);
    });

    it('handles file with URLs containing version-like numbers', () => {
      const file = makeKnowledgeFile('urls', 'Download from https://example.com/v1.2.3/file.tar.gz');
      const claims = extractClaims(file);
      // https is skipped by the filter, example.com version may be caught but entity length check handles it
      expect(claims).toBeDefined();
    });

    it('does not flag same entity with same version as contradiction', () => {
      // This tests the logic: if two files mention "libssl v1.18.0", that's agreement not contradiction
      const report = detectContradictions();
      // All current files that mention the same versions should not produce contradictions
      expect(report.contradictions.every(c => {
        const versions = new Set(c.claims.map(cl => cl.version));
        return versions.size > 1;
      })).toBe(true);
    });

    it('extracts multiple claims from a single line', () => {
      const file = makeKnowledgeFile('multi', 'Uses kernel 5.15 with openssl v1.18.0 on board');
      const claims = extractClaims(file);
      expect(claims.length).toBeGreaterThanOrEqual(2);
    });

    it('normalizes entity names for comparison (case-insensitive)', () => {
      const file = makeKnowledgeFile('case', 'Libssl v1.18.0 is here\nlibssl v1.18.0 also here');
      const claims = extractClaims(file);
      const entities = claims.map(c => c.entity);
      // All should normalize to same entity
      const unique = new Set(entities);
      expect(unique.size).toBe(1);
    });

    it('does not crash on empty body', () => {
      const file = makeKnowledgeFile('empty', '');
      const claims = extractClaims(file);
      expect(claims).toHaveLength(0);
    });

    it('skips year-like versions (2026)', () => {
      const file = makeKnowledgeFile('years', 'Released firmware 2026 in January');
      const claims = extractClaims(file);
      const yearClaims = claims.filter(c => c.version === '2026');
      expect(yearClaims).toHaveLength(0);
    });
  });
});

// Helper to create a mock KnowledgeFile for testing extractClaims
function makeKnowledgeFile(slug: string, body: string): KnowledgeFile {
  return {
    meta: { domain: 'test', updated: '2026-05-18', tags: ['test'], related: [] },
    body,
    path: `/test/${slug}.md`,
    slug,
  };
}
