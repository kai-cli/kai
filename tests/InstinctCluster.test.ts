import { describe, it, expect, afterEach } from 'bun:test';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import {
  clusterByEmbedding,
  CLUSTER_THRESHOLD,
  MAX_CLUSTER_SIZE,
  MIN_CLUSTER_SIZE,
} from '../hooks/lib/instinct-cluster';
import { saveVectorCache } from '../hooks/lib/instinct-dedup';
import type { Instinct } from '../hooks/lib/instinct-store';

const TMP = join('/tmp', 'test-instinct-cluster-' + Date.now());

function mkPaiDir(): string {
  const dir = join(TMP, Math.random().toString(36).slice(2));
  mkdirSync(join(dir, 'MEMORY', 'STATE', 'embeddings'), { recursive: true });
  return dir;
}

function makeInstinct(id: string, text: string, confidence = 0.9, triggerCount = 5): Instinct {
  return {
    id,
    text,
    confidence,
    tags: ['test'],
    created: '2026-05-20T00:00:00Z',
    last_triggered: '2026-05-20T00:00:00Z',
    last_decayed_at: '2026-05-20T00:00:00Z',
    trigger_count: triggerCount,
    source: 'correction',
    context: 'test',
    active: true,
  };
}

afterEach(() => {
  try { rmSync(TMP, { recursive: true, force: true }); } catch { }
});

describe('instinct-cluster', () => {
  describe('constants', () => {
    it('CLUSTER_THRESHOLD is 0.7', () => {
      expect(CLUSTER_THRESHOLD).toBe(0.7);
    });

    it('MAX_CLUSTER_SIZE is 8', () => {
      expect(MAX_CLUSTER_SIZE).toBe(8);
    });

    it('MIN_CLUSTER_SIZE is 2', () => {
      expect(MIN_CLUSTER_SIZE).toBe(2);
    });
  });

  describe('clusterByEmbedding', () => {
    it('returns empty for fewer than 2 instincts', () => {
      const paiDir = mkPaiDir();
      const instincts = [makeInstinct('inst_1', 'solo instinct')];
      expect(clusterByEmbedding(paiDir, instincts)).toEqual([]);
    });

    it('returns empty when no vectors cached', () => {
      const paiDir = mkPaiDir();
      const instincts = [
        makeInstinct('inst_1', 'first'),
        makeInstinct('inst_2', 'second'),
      ];
      expect(clusterByEmbedding(paiDir, instincts)).toEqual([]);
    });

    it('clusters similar vectors together', () => {
      const paiDir = mkPaiDir();
      // Two similar vectors (high cosine) and one dissimilar
      const v1 = Array.from({ length: 10 }, () => 0.5);
      const v2 = Array.from({ length: 10 }, () => 0.51);
      const v3 = Array.from({ length: 10 }, (_, i) => i % 2 === 0 ? -0.5 : 0.5);

      saveVectorCache(paiDir, [
        { id: 'inst_a', text: 'run tests first', vector: v1 },
        { id: 'inst_b', text: 'always test before push', vector: v2 },
        { id: 'inst_c', text: 'use dark mode', vector: v3 },
      ]);

      const instincts = [
        makeInstinct('inst_a', 'run tests first'),
        makeInstinct('inst_b', 'always test before push'),
        makeInstinct('inst_c', 'use dark mode'),
      ];

      const clusters = clusterByEmbedding(paiDir, instincts);
      expect(clusters.length).toBeGreaterThanOrEqual(1);
      // inst_a and inst_b should cluster together
      const firstCluster = clusters[0];
      expect(firstCluster.instincts.length).toBeGreaterThanOrEqual(2);
      const ids = firstCluster.instincts.map(i => i.id);
      expect(ids).toContain('inst_a');
      expect(ids).toContain('inst_b');
    });

    it('marks cluster as promotable when all instincts qualify', () => {
      const paiDir = mkPaiDir();
      const v = Array.from({ length: 10 }, () => 0.5);

      saveVectorCache(paiDir, [
        { id: 'inst_a', text: 'a', vector: v },
        { id: 'inst_b', text: 'b', vector: v },
      ]);

      const instincts = [
        makeInstinct('inst_a', 'a', 0.9, 5),
        makeInstinct('inst_b', 'b', 0.85, 4),
      ];

      const clusters = clusterByEmbedding(paiDir, instincts);
      expect(clusters.length).toBe(1);
      expect(clusters[0].promotable).toBe(true);
    });

    it('marks cluster as not promotable when any instinct is below threshold', () => {
      const paiDir = mkPaiDir();
      const v = Array.from({ length: 10 }, () => 0.5);

      saveVectorCache(paiDir, [
        { id: 'inst_a', text: 'a', vector: v },
        { id: 'inst_b', text: 'b', vector: v },
      ]);

      const instincts = [
        makeInstinct('inst_a', 'a', 0.9, 5),
        makeInstinct('inst_b', 'b', 0.6, 2), // below 0.8 confidence
      ];

      const clusters = clusterByEmbedding(paiDir, instincts);
      expect(clusters.length).toBe(1);
      expect(clusters[0].promotable).toBe(false);
    });

    it('splits clusters exceeding MAX_CLUSTER_SIZE', () => {
      const paiDir = mkPaiDir();
      // Create 10 nearly-identical vectors — should force a split
      const entries = Array.from({ length: 10 }, (_, i) => ({
        id: `inst_${i}`,
        text: `instinct ${i}`,
        vector: Array.from({ length: 10 }, () => 0.5 + i * 0.001),
      }));
      saveVectorCache(paiDir, entries);

      const instincts = entries.map(e => makeInstinct(e.id, e.text));
      const clusters = clusterByEmbedding(paiDir, instincts);

      for (const cluster of clusters) {
        expect(cluster.instincts.length).toBeLessThanOrEqual(MAX_CLUSTER_SIZE);
      }
    });
  });
});
