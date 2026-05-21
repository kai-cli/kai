import { describe, it, expect, afterEach } from 'bun:test';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import {
  loadVectorCache,
  saveVectorCache,
  invalidateVector,
  cosineSimilarity,
  DEDUP_THRESHOLD,
} from '../hooks/lib/instinct-dedup';
import type { Instinct } from '../hooks/lib/instinct-store';

const TMP = join('/tmp', 'test-instinct-dedup-' + Date.now());

function mkPaiDir(): string {
  const dir = join(TMP, Math.random().toString(36).slice(2));
  mkdirSync(join(dir, 'MEMORY', 'STATE', 'embeddings'), { recursive: true });
  return dir;
}

afterEach(() => {
  try { rmSync(TMP, { recursive: true, force: true }); } catch { }
});

describe('instinct-dedup', () => {
  describe('cosineSimilarity', () => {
    it('returns 1 for identical vectors', () => {
      const v = [1, 2, 3, 4, 5];
      expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
    });

    it('returns 0 for orthogonal vectors', () => {
      const a = [1, 0, 0];
      const b = [0, 1, 0];
      expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
    });

    it('returns -1 for opposite vectors', () => {
      const a = [1, 0, 0];
      const b = [-1, 0, 0];
      expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
    });

    it('returns 0 for zero vectors', () => {
      expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    });

    it('handles high-dimensional vectors', () => {
      const a = Array.from({ length: 512 }, (_, i) => Math.sin(i));
      const b = Array.from({ length: 512 }, (_, i) => Math.sin(i + 0.1));
      const sim = cosineSimilarity(a, b);
      expect(sim).toBeGreaterThan(0.9);
      expect(sim).toBeLessThanOrEqual(1.0);
    });
  });

  describe('vector cache', () => {
    it('returns empty array when no cache exists', () => {
      const paiDir = mkPaiDir();
      expect(loadVectorCache(paiDir)).toEqual([]);
    });

    it('saves and loads vector entries', () => {
      const paiDir = mkPaiDir();
      const entries = [
        { id: 'inst_abc', text: 'test instinct', vector: [0.1, 0.2, 0.3] },
        { id: 'inst_def', text: 'another instinct', vector: [0.4, 0.5, 0.6] },
      ];
      saveVectorCache(paiDir, entries);
      const loaded = loadVectorCache(paiDir);
      expect(loaded).toHaveLength(2);
      expect(loaded[0].id).toBe('inst_abc');
      expect(loaded[1].vector).toEqual([0.4, 0.5, 0.6]);
    });

    it('invalidateVector removes specific entry', () => {
      const paiDir = mkPaiDir();
      const entries = [
        { id: 'inst_abc', text: 'keep', vector: [0.1, 0.2, 0.3] },
        { id: 'inst_def', text: 'remove', vector: [0.4, 0.5, 0.6] },
      ];
      saveVectorCache(paiDir, entries);
      invalidateVector(paiDir, 'inst_def');
      const loaded = loadVectorCache(paiDir);
      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe('inst_abc');
    });
  });

  describe('DEDUP_THRESHOLD', () => {
    it('is 0.85', () => {
      expect(DEDUP_THRESHOLD).toBe(0.85);
    });
  });
});
