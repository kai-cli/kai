/**
 * similarity.ts — Vector similarity primitives (shared engine)
 *
 * Extracted from 3 byte-identical copies (instinct-dedup, instinct-cluster,
 * semantic-fallback) during the W1 consolidation. One definition, three consumers.
 *
 * cosineSimilarity returns 0 for zero-norm vectors (safe default — no NaN).
 */

/** Cosine similarity of two equal-length numeric vectors. Returns 0 if either is zero-norm. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
