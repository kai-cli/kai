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
import { ensureIndex, queryIndex, dbPath } from './embeddings-sqlite';
import { emitMemoryTelemetry } from './memory-telemetry';

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

function nowMs(): number {
  try { return Date.now(); } catch { return 0; }
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

  const settings = loadSettings(paiDir);
  const threshold = settings.embeddings?.threshold ?? 0.45;
  const maxTokens = settings.embeddings?.maxTokens ?? 2000;

  const queryEmbedding = await embed(query);
  if (!queryEmbedding) return empty;

  const t0 = nowMs();
  try {
    // PRIMARY: derived SQLite index (no 38MB JSON.parse per call). Falls back to the JSONL scan below
    // if the .db is absent or errors. Behavior-preserving — same threshold/topK, full cosine (parity
    // verified 2026-06-21). md-as-truth: index.jsonl remains the source; the .db is a rebuilt cache.
    if (ensureIndex(paiDir) && existsSync(dbPath(paiDir))) {
      try {
        const sqHits = queryIndex(paiDir, queryEmbedding, query, topK, threshold);
        // SQLite ran cleanly: its result IS the answer (full-cosine parity with JSONL, verified).
        // Empty is a valid answer here — don't re-pay the 38MB scan.
        emitMemoryTelemetry('recall.latency', { ms: nowMs() - t0, path: 'sqlite', hits: sqHits.length });
        if (sqHits.length === 0) return empty;
        const maxChars = maxTokens * 4;
        const parts: string[] = [];
        let total = 0;
        const srcs = new Set<string>();
        for (const h of sqHits) {
          if (total + h.text.length > maxChars) break;
          parts.push(h.text); total += h.text.length; srcs.add(h.path);
        }
        return { content: parts.join('\n\n---\n\n'), confidence: sqHits[0].score, sources: [...srcs] };
      } catch { /* fall through to JSONL scan below */ }
    }

    // FALLBACK: legacy in-memory JSONL scan (only reached if the .db is absent or errored — loaded
    // lazily here so the SQLite path never pays the 38MB read).
    const chunks = loadIndex(paiDir);
    if (chunks.length === 0) return empty;

    const scored = chunks
      .map(chunk => ({ chunk, score: cosineSimilarity(queryEmbedding, chunk.embedding) }))
      .filter(s => s.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    emitMemoryTelemetry('recall.latency', { ms: nowMs() - t0, path: 'jsonl', hits: scored.length });
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
