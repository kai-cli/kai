/**
 * instinct-dedup.ts — Semantic deduplication for instincts via embeddings
 *
 * Before creating a new instinct, compares candidate text against existing
 * instincts using cosine similarity. If above threshold, reinforces the
 * existing instinct instead of creating a duplicate.
 *
 * Graceful degradation: if embedding model unavailable, skips dedup.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { Instinct } from './instinct-store';
import { cosineSimilarity } from './similarity';
import { embed } from './embeddings';

const DEDUP_THRESHOLD = 0.85;
const VECTORS_FILE = 'MEMORY/STATE/embeddings/instinct-vectors.jsonl';

export interface VectorEntry {
  id: string;
  text: string;
  vector: number[];
}

function vectorsPath(paiDir: string): string {
  return join(paiDir, VECTORS_FILE);
}

export function loadVectorCache(paiDir: string): VectorEntry[] {
  const path = vectorsPath(paiDir);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, 'utf-8')
      .trim()
      .split('\n')
      .filter(l => l.trim())
      .map(l => JSON.parse(l) as VectorEntry);
  } catch {
    return [];
  }
}

export function saveVectorCache(paiDir: string, entries: VectorEntry[]): void {
  const dir = join(paiDir, 'MEMORY', 'STATE', 'embeddings');
  mkdirSync(dir, { recursive: true });
  writeFileSync(vectorsPath(paiDir), entries.map(e => JSON.stringify(e)).join('\n') + '\n');
}

export function invalidateVector(paiDir: string, instinctId: string): void {
  const entries = loadVectorCache(paiDir).filter(e => e.id !== instinctId);
  saveVectorCache(paiDir, entries);
}

// cosineSimilarity moved to lib/similarity.ts; embed() moved to lib/embeddings.ts
// (W1 consolidation — both imported above). The shared embed() caches the model once per
// process, so the loop below no longer reloads the 33M-param model on every instinct.

/**
 * Check if candidateText is semantically similar to any existing instinct.
 * Returns the matching instinct ID if a duplicate is found, null otherwise.
 */
export async function findDuplicate(
  paiDir: string,
  candidateText: string,
  activeInstincts: Instinct[]
): Promise<string | null> {
  if (activeInstincts.length === 0) return null;

  const candidateVec = await embed(candidateText);
  if (!candidateVec) return null;

  // Load or build vector cache for existing instincts
  let cache = loadVectorCache(paiDir);
  const activeIds = new Set(activeInstincts.map(i => i.id));

  // Remove stale entries (archived instincts)
  cache = cache.filter(e => activeIds.has(e.id));

  // Embed any instincts not yet in cache
  const cached = new Set(cache.map(e => e.id));
  const uncached = activeInstincts.filter(i => !cached.has(i.id));

  for (const inst of uncached) {
    const vec = await embed(inst.text);
    if (vec) {
      cache.push({ id: inst.id, text: inst.text, vector: vec });
    }
  }

  // Save updated cache
  saveVectorCache(paiDir, cache);

  // Compare candidate against all cached vectors
  let bestMatch: string | null = null;
  let bestScore = 0;

  for (const entry of cache) {
    const score = cosineSimilarity(candidateVec, entry.vector);
    if (score > bestScore && score >= DEDUP_THRESHOLD) {
      bestScore = score;
      bestMatch = entry.id;
    }
  }

  return bestMatch;
}

export { DEDUP_THRESHOLD, cosineSimilarity };
