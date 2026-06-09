/**
 * semantic-fallback.ts — Embedding-based context routing fallback
 *
 * Fires when LocalContextFirst has no explicit routing match.
 * Embeds the query via lib/embeddings.ts (shared jina-v2-small-en loader) and ranks index chunks.
 * Graceful degradation when model or index not installed.
 *
 * Default threshold: 0.45 cosine similarity (configurable in settings.json)
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { cosineSimilarity } from './similarity';
import { embed } from './embeddings';

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

function indexPath(paiDir: string): string {
  return join(paiDir, 'MEMORY', 'STATE', 'embeddings', 'index.jsonl');
}

function loadSettings(paiDir: string): Settings {
  const path = join(paiDir, 'config', 'settings.json');
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return {}; }
}

// cosineSimilarity moved to lib/similarity.ts; embedding model load + embed() moved to
// lib/embeddings.ts (W1 consolidation — both imported above). The shared embed() keeps the
// cached-singleton + non-blocking-null behavior this module relied on.

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

  const queryEmbedding = await embed(query);
  if (!queryEmbedding) return empty;

  try {
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
