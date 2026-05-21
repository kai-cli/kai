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

const DEDUP_THRESHOLD = 0.85;
const VECTORS_FILE = 'MEMORY/STATE/embeddings/instinct-vectors.jsonl';

let warnedOnce = false;

interface VectorEntry {
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

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function embed(text: string): Promise<number[] | null> {
  try {
    const { pipeline } = await import('@huggingface/transformers');
    const pipe = await pipeline('feature-extraction', 'Xenova/jina-embeddings-v2-small-en', { revision: 'main' });
    const output = await (pipe as any)(text);
    return Array.from(output.data as Float32Array);
  } catch {
    if (!warnedOnce) {
      console.error('[instinct-dedup] Embedding model unavailable — skipping dedup');
      warnedOnce = true;
    }
    return null;
  }
}

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
