/**
 * instinct-cluster.ts — Embedding-based instinct clustering for /evolve
 *
 * Replaces tag-overlap clustering with cosine similarity grouping.
 * Uses cached instinct vectors from instinct-dedup.ts.
 *
 * Algorithm: agglomerative clustering with 0.7 cosine threshold.
 * Max cluster size: 8 (split by highest internal distance if exceeded).
 * Min cluster size for promotion: 2.
 */

import type { Instinct } from './instinct-store';
import { loadVectorCache, type VectorEntry } from './instinct-dedup';
import { cosineSimilarity } from './similarity';

const CLUSTER_THRESHOLD = 0.7;
const MAX_CLUSTER_SIZE = 8;
const MIN_CLUSTER_SIZE = 2;

export interface InstinctCluster {
  instincts: Instinct[];
  centroidScore: number;
  promotable: boolean;
}

// cosineSimilarity moved to lib/similarity.ts (W1 consolidation — imported above)

function buildSimilarityMatrix(vectors: Map<string, number[]>, ids: string[]): Map<string, Map<string, number>> {
  const matrix = new Map<string, Map<string, number>>();
  for (let i = 0; i < ids.length; i++) {
    const row = new Map<string, number>();
    const vecA = vectors.get(ids[i])!;
    for (let j = 0; j < ids.length; j++) {
      if (i === j) continue;
      const vecB = vectors.get(ids[j])!;
      row.set(ids[j], cosineSimilarity(vecA, vecB));
    }
    matrix.set(ids[i], row);
  }
  return matrix;
}

function splitOversizedCluster(cluster: Instinct[], vectors: Map<string, number[]>): Instinct[][] {
  if (cluster.length <= MAX_CLUSTER_SIZE) return [cluster];

  // Find the pair with lowest similarity and split there
  let minSim = Infinity;
  let splitIdx = Math.floor(cluster.length / 2);

  for (let i = 0; i < cluster.length - 1; i++) {
    const vecA = vectors.get(cluster[i].id);
    const vecB = vectors.get(cluster[i + 1].id);
    if (vecA && vecB) {
      const sim = cosineSimilarity(vecA, vecB);
      if (sim < minSim) {
        minSim = sim;
        splitIdx = i + 1;
      }
    }
  }

  const left = cluster.slice(0, splitIdx);
  const right = cluster.slice(splitIdx);

  const results: Instinct[][] = [];
  if (left.length >= MIN_CLUSTER_SIZE) results.push(...splitOversizedCluster(left, vectors));
  if (right.length >= MIN_CLUSTER_SIZE) results.push(...splitOversizedCluster(right, vectors));

  return results.length > 0 ? results : [cluster.slice(0, MAX_CLUSTER_SIZE)];
}

/**
 * Cluster instincts by embedding similarity.
 * Falls back to empty array if no vectors are cached.
 */
export function clusterByEmbedding(
  paiDir: string,
  instincts: Instinct[]
): InstinctCluster[] {
  if (instincts.length < MIN_CLUSTER_SIZE) return [];

  const cache = loadVectorCache(paiDir);
  const vectorMap = new Map<string, number[]>();
  for (const entry of cache) {
    vectorMap.set(entry.id, entry.vector);
  }

  // Only cluster instincts that have vectors
  const clusterable = instincts.filter(i => vectorMap.has(i.id));
  if (clusterable.length < MIN_CLUSTER_SIZE) return [];

  const ids = clusterable.map(i => i.id);
  const matrix = buildSimilarityMatrix(vectorMap, ids);

  // Agglomerative clustering: greedily group by highest similarity
  const assigned = new Set<string>();
  const rawClusters: Instinct[][] = [];

  for (const inst of clusterable) {
    if (assigned.has(inst.id)) continue;

    const group: Instinct[] = [inst];
    assigned.add(inst.id);

    const row = matrix.get(inst.id);
    if (!row) continue;

    // Find all instincts similar enough to join this cluster
    const neighbors = [...row.entries()]
      .filter(([id, sim]) => sim >= CLUSTER_THRESHOLD && !assigned.has(id))
      .sort((a, b) => b[1] - a[1]);

    for (const [neighborId] of neighbors) {
      if (assigned.has(neighborId)) continue;
      const neighbor = clusterable.find(i => i.id === neighborId);
      if (neighbor) {
        group.push(neighbor);
        assigned.add(neighborId);
      }
    }

    if (group.length >= MIN_CLUSTER_SIZE) {
      rawClusters.push(group);
    }
  }

  // Split oversized clusters and build result
  const results: InstinctCluster[] = [];

  for (const raw of rawClusters) {
    const splits = splitOversizedCluster(raw, vectorMap);
    for (const group of splits) {
      if (group.length < MIN_CLUSTER_SIZE) continue;

      // Calculate average pairwise similarity as centroid score
      let totalSim = 0;
      let pairs = 0;
      for (let i = 0; i < group.length - 1; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const vA = vectorMap.get(group[i].id);
          const vB = vectorMap.get(group[j].id);
          if (vA && vB) {
            totalSim += cosineSimilarity(vA, vB);
            pairs++;
          }
        }
      }
      const centroidScore = pairs > 0 ? totalSim / pairs : 0;

      // Promotable if all instincts meet promotion criteria
      const promotable = group.every(i => i.confidence >= 0.8 && i.trigger_count >= 3);

      results.push({ instincts: group, centroidScore, promotable });
    }
  }

  return results.sort((a, b) => b.centroidScore - a.centroidScore);
}

export { CLUSTER_THRESHOLD, MAX_CLUSTER_SIZE, MIN_CLUSTER_SIZE };
