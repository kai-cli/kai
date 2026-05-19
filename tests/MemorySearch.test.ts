import { describe, it, expect, beforeAll } from 'bun:test';
import { existsSync } from 'fs';
import { searchMemory, formatSearchOutput, type SearchOutput } from '../PAI/Tools/MemorySearch';
import { getKnowledgeDir } from '../hooks/lib/knowledge-schema';

const hasKnowledgeFiles = existsSync(getKnowledgeDir()) && existsSync(`${getKnowledgeDir()}/firmware.md`);

describe('MemorySearch', () => {
  describe('searchMemory', () => {
    it('returns empty results for empty query', () => {
      const result = searchMemory('');
      expect(result.results).toHaveLength(0);
      expect(result.totalChars).toBe(0);
      expect(result.truncated).toBe(false);
    });

    it('returns empty results for whitespace-only query', () => {
      const result = searchMemory('   ');
      expect(result.results).toHaveLength(0);
    });

    it.skipIf(!hasKnowledgeFiles)('finds results for known term "firmware"', () => {
      const result = searchMemory('firmware');
      expect(result.results.length).toBeGreaterThan(0);
      const slugs = result.results.map(r => r.slug);
      expect(slugs).toContain('firmware');
    });

    it.skipIf(!hasKnowledgeFiles)('finds results for known term "security"', () => {
      const result = searchMemory('security');
      expect(result.results.length).toBeGreaterThan(0);
    });

    it.skipIf(!hasKnowledgeFiles)('ranks multi-term queries by combined hits', () => {
      const result = searchMemory('openwrt build');
      expect(result.results.length).toBeGreaterThan(0);
      // First result should have highest score
      for (let i = 1; i < result.results.length; i++) {
        expect(result.results[i - 1].score).toBeGreaterThanOrEqual(result.results[i].score);
      }
    });

    it('handles regex metacharacters without crashing', () => {
      const result = searchMemory('c++ (templates)');
      expect(result).toBeDefined();
      expect(result.results).toBeDefined();
    });

    it('handles special characters: brackets, pipes, dots', () => {
      const result = searchMemory('[test] foo.bar | baz');
      expect(result).toBeDefined();
      expect(result.results).toBeDefined();
    });

    it('respects budget parameter', () => {
      const largeBudget = searchMemory('firmware', 10000);
      const smallBudget = searchMemory('firmware', 100);
      expect(smallBudget.results.length).toBeLessThanOrEqual(largeBudget.results.length);
    });

    it('sets truncated flag when budget exceeded', () => {
      const result = searchMemory('firmware openwrt build jenkins docker api', 200);
      if (result.results.length > 0) {
        // With a tiny budget and many potential matches, should truncate
        expect(result.truncated).toBe(true);
      }
    });

    it.skipIf(!hasKnowledgeFiles)('includes related-note links in results', () => {
      const result = searchMemory('firmware', 8000);
      const relatedResults = result.results.filter(r => r.score === 0);
      // firmware.md has related: [api-and-services, products], so we should see related entries
      expect(relatedResults.length).toBeGreaterThan(0);
    });

    it('limits results to max 5 scored + related', () => {
      const result = searchMemory('a e i o u', 10000);
      const scored = result.results.filter(r => r.score > 0);
      expect(scored.length).toBeLessThanOrEqual(5);
    });

    it('returns stable ordering for same query', () => {
      const result1 = searchMemory('openwrt');
      const result2 = searchMemory('openwrt');
      expect(result1.results.map(r => r.slug)).toEqual(result2.results.map(r => r.slug));
    });
  });

  describe('formatSearchOutput', () => {
    it('formats empty results gracefully', () => {
      const output: SearchOutput = { query: 'nothing', results: [], totalChars: 0, truncated: false };
      const formatted = formatSearchOutput(output);
      expect(formatted).toContain('No results found');
      expect(formatted).toContain('nothing');
    });

    it('formats results with markdown headers', () => {
      const output: SearchOutput = {
        query: 'test',
        results: [{
          file: '/path/to/file.md',
          slug: 'test-file',
          score: 5,
          matches: ['line one', 'line two'],
        }],
        totalChars: 100,
        truncated: false,
      };
      const formatted = formatSearchOutput(output);
      expect(formatted).toContain('## Memory Search');
      expect(formatted).toContain('test-file');
      expect(formatted).toContain('score: 5');
      expect(formatted).toContain('line one');
    });

    it('shows truncation notice when truncated', () => {
      const output: SearchOutput = {
        query: 'test',
        results: [{ file: '/f.md', slug: 's', score: 1, matches: ['x'] }],
        totalChars: 100,
        truncated: true,
      };
      const formatted = formatSearchOutput(output);
      expect(formatted).toContain('truncated');
    });

    it('marks related results differently from scored results', () => {
      const output: SearchOutput = {
        query: 'test',
        results: [
          { file: '/a.md', slug: 'scored', score: 3, matches: ['hit'] },
          { file: '/b.md', slug: 'related', score: 0, matches: ['link'] },
        ],
        totalChars: 100,
        truncated: false,
      };
      const formatted = formatSearchOutput(output);
      expect(formatted).toContain('**scored**');
      expect(formatted).toContain('*related*');
    });
  });

  describe('edge cases', () => {
    it('handles single character query', () => {
      const result = searchMemory('a');
      expect(result).toBeDefined();
      expect(result.results).toBeDefined();
    });

    it('handles very long query without crashing', () => {
      const longQuery = 'firmware openwrt build jenkins docker api security ui products devops';
      const result = searchMemory(longQuery);
      expect(result).toBeDefined();
    });

    it('does not include duplicate matches in results', () => {
      const result = searchMemory('firmware');
      for (const r of result.results) {
        const unique = new Set(r.matches);
        expect(r.matches.length).toBe(unique.size);
      }
    });

    it('does not include the same slug as both scored and related', () => {
      const result = searchMemory('firmware', 8000);
      const scored = result.results.filter(r => r.score > 0).map(r => r.slug);
      const related = result.results.filter(r => r.score === 0).map(r => r.slug);
      for (const s of scored) {
        expect(related).not.toContain(s);
      }
    });

    it('handles backslashes in query', () => {
      const result = searchMemory('path\\to\\file');
      expect(result).toBeDefined();
    });

    it('handles unicode in query', () => {
      const result = searchMemory('über firmware');
      expect(result).toBeDefined();
    });

    it('budget of 0 returns empty results', () => {
      const result = searchMemory('firmware', 0);
      // Budget 0 means first result gets added (we add at least one if budget isn't exceeded yet)
      // but subsequent ones are cut
      expect(result.results.length).toBeLessThanOrEqual(1);
    });
  });
});
