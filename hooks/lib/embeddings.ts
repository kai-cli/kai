/**
 * embeddings.ts — Shared embedding model loader (the W1 engine, second half)
 *
 * One cached model load per process, one place that knows the pooling args.
 *
 * BACKGROUND: feature-extraction MUST be called with {pooling:'mean',normalize:true} to
 * return ONE 512-d unit vector. Without pooling it returns a [tokens×512] matrix, which makes
 * every cosine comparison meaningless — the latent bug that silently broke semantic dedup AND
 * recall until W1 (commit 64b6a07). Baking the pooling args into embed() here means no caller
 * can ever reintroduce that bug by forgetting them.
 *
 * Consolidated from 3 ad-hoc loaders: instinct-dedup (reloaded the model on EVERY call),
 * semantic-fallback (this module's cached-singleton pattern), and EmbeddingIndex (batch script).
 *
 * Graceful degradation: if @huggingface/transformers is unavailable, getEmbedder/embed return
 * null and callers skip the embedding-dependent path (dedup/recall become no-ops, not errors).
 */

export const EMBEDDING_MODEL = 'Xenova/jina-embeddings-v2-small-en';
export const EMBEDDING_DIM = 512;

// The single source of truth for pooling. Drift here = system-wide silent cosine breakage.
const POOLING_OPTS = { pooling: 'mean', normalize: true } as const;

type Embedder = (text: string, opts: typeof POOLING_OPTS) => Promise<{ data: Float32Array }>;

let embedder: Embedder | null = null;
let loading = false;
let warned = false;

/**
 * Returns the cached feature-extraction pipeline, loading it once on first call.
 * Returns null if the model can't be loaded, or if a load is already in flight
 * (callers tolerate null and skip — preserves semantic-fallback's non-blocking contract).
 */
export async function getEmbedder(): Promise<Embedder | null> {
  if (embedder) return embedder;
  if (loading) return null;

  try {
    loading = true;
    const { pipeline } = await import('@huggingface/transformers');
    embedder = (await pipeline('feature-extraction', EMBEDDING_MODEL, { revision: 'main' })) as unknown as Embedder;
    return embedder;
  } catch {
    if (!warned) {
      console.error(`[embeddings] @huggingface/transformers unavailable — run: bun scripts/EmbeddingIndex.ts --setup`);
      warned = true;
    }
    loading = false;
    return null;
  }
}

/**
 * Embed text into one normalized 512-d vector. Returns null if the model is unavailable
 * (caller skips the embedding-dependent path). Pooling/normalize are applied here and nowhere else.
 */
export async function embed(text: string): Promise<number[] | null> {
  const pipe = await getEmbedder();
  if (!pipe) return null;
  try {
    const output = await pipe(text, POOLING_OPTS);
    return Array.from(output.data);
  } catch {
    return null;
  }
}
