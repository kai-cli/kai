/**
 * semantic-fallback.ts — Embedding-based context routing fallback
 *
 * Fires when LocalContextFirst has no explicit routing match.
 * Uses @huggingface/transformers@^3.8.1 with jina-embeddings-v2-small-en.
 * Graceful degradation when model or index not installed.
 *
 * Default threshold: 0.45 cosine similarity (configurable in settings.json)
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const MODEL_NAME = 'Xenova/jina-embeddings-v2-small-en';

interface EmbeddingChunk {
  path: string;
  text: string;
  embedding: number[];
  section?: string;
}

interface FallbackResult {
  content: string;
  confidence: number;
  sources: string[];
}

interface EmbeddingsConfig {
  threshold?: number;
  maxTokens?: number;
}

interface Settings {
  embeddings?: EmbeddingsConfig;
}

let pipeline: ((text: string) => Promise<{ data: Float32Array }>) | null = null;
let pipelineLoading = false;

function indexPath(paiDir: string): string {
  return join(paiDir, 'MEMORY', 'STATE', 'embeddings', 'index.jsonl');
}

function loadSettings(paiDir: string): Settings {
  const path = join(paiDir, 'config', 'settings.json');
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return {}; }
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

async function getPipeline(): Promise<((text: string) => Promise<{ data: Float32Array }>) | null> {
  if (pipeline) return pipeline;
  if (pipelineLoading) return null;

  try {
    pipelineLoading = true;
    const { pipeline: hfPipeline } = await import('@huggingface/transformers');
    pipeline = await hfPipeline('feature-extraction', MODEL_NAME, { revision: 'main' }) as any;
    return pipeline;
  } catch {
    console.error('[semantic-fallback] @huggingface/transformers not available — run: bun scripts/EmbeddingIndex.ts --setup');
    pipelineLoading = false;
    return null;
  }
}

function loadIndex(paiDir: string): EmbeddingChunk[] {
  const path = indexPath(paiDir);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, 'utf-8')
      .trim()
      .split('\n')
      .filter(l => l.trim())
      .map(l => JSON.parse(l) as EmbeddingChunk);
  } catch {
    return [];
  }
}

export async function semanticFallback(
  paiDir: string,
  query: string,
  topK: number = 3
): Promise<FallbackResult> {
  const empty: FallbackResult = { content: '', confidence: 0, sources: [] };

  // Fast-path: no index
  if (!existsSync(indexPath(paiDir))) return empty;

  const chunks = loadIndex(paiDir);
  if (chunks.length === 0) return empty;

  const settings = loadSettings(paiDir);
  const threshold = settings.embeddings?.threshold ?? 0.45;
  const maxTokens = settings.embeddings?.maxTokens ?? 2000;

  const pipe = await getPipeline();
  if (!pipe) return empty;

  try {
    const output = await pipe(query);
    const queryEmbedding = Array.from(output.data as Float32Array);

    const scored = chunks
      .map(chunk => ({ chunk, score: cosineSimilarity(queryEmbedding, chunk.embedding) }))
      .filter(s => s.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    if (scored.length === 0) return empty;

    // Assemble context respecting maxTokens budget (~4 chars/token estimate)
    const maxChars = maxTokens * 4;
    const parts: string[] = [];
    let totalChars = 0;
    const sources = new Set<string>();

    for (const { chunk, score } of scored) {
      if (totalChars + chunk.text.length > maxChars) break;
      parts.push(chunk.text);
      totalChars += chunk.text.length;
      sources.add(chunk.path);
    }

    const topScore = scored[0]?.score ?? 0;
    return {
      content: parts.join('\n\n---\n\n'),
      confidence: topScore,
      sources: [...sources],
    };
  } catch (err) {
    console.error('[semantic-fallback] Error during inference:', err);
    return empty;
  }
}

export function isIndexAvailable(paiDir: string): boolean {
  return existsSync(indexPath(paiDir));
}

/**
 * Check if a file path targets a knowledge area (not source code).
 */
export function isKnowledgePath(filePath: string): boolean {
  const knowledgePatterns = [
    '/MEMORY/',
    '/Knowledge/',
    '/Projects/Knowledge/',
    'MEMORY.md',
    'CONTEXT_ROUTING.md',
    '/KNOWLEDGE/',
  ];
  return knowledgePatterns.some(p => filePath.includes(p));
}
