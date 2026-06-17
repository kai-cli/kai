import { describe, it, expect, afterEach, mock } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

// Mock the embedder so this test NEVER loads the real @huggingface/transformers model.
// Rationale: loading the native jina model crashes Bun 1.3.14 with a C++ exception during process
// teardown (exit 133/SIGABRT) — a known Bun↔native-NAPI bug, NOT our code. embed() returning null is
// also the EXACT "model not available → graceful degradation" path this suite is written to verify
// (see the third semanticFallback test). So mocking is faithful to intent, not a coverage loss.
// Must be registered before semantic-fallback is imported (Bun hoists imports; mock.module applies).
mock.module('../hooks/lib/embeddings', () => ({
  embed: async () => null,
  getEmbedder: async () => null,
  EMBEDDING_MODEL: 'Xenova/jina-embeddings-v2-small-en',
  EMBEDDING_DIM: 512,
}));

import { isIndexAvailable, isKnowledgePath, semanticFallback } from '../hooks/lib/semantic-fallback';

const TMP = join('/tmp', 'test-semantic-fallback-' + Date.now());

function mkPaiDir(): string {
  const dir = join(TMP, Math.random().toString(36).slice(2));
  mkdirSync(join(dir, 'MEMORY', 'STATE', 'embeddings'), { recursive: true });
  mkdirSync(join(dir, 'config'), { recursive: true });
  return dir;
}

afterEach(() => {
  try { rmSync(TMP, { recursive: true, force: true }); } catch { }
});

describe('isIndexAvailable', () => {
  it('returns false when no index exists', () => {
    const paiDir = mkPaiDir();
    expect(isIndexAvailable(paiDir)).toBe(false);
  });

  it('returns true when index.jsonl exists', () => {
    const paiDir = mkPaiDir();
    writeFileSync(join(paiDir, 'MEMORY', 'STATE', 'embeddings', 'index.jsonl'), '');
    expect(isIndexAvailable(paiDir)).toBe(true);
  });
});

describe('isKnowledgePath', () => {
  it('recognizes MEMORY/ paths as knowledge', () => {
    expect(isKnowledgePath('/Users/user/.claude/MEMORY/KNOWLEDGE/firmware.md')).toBe(true);
  });

  it('recognizes Knowledge/ paths as knowledge', () => {
    expect(isKnowledgePath('/Users/user/Projects/Knowledge/networking.md')).toBe(true);
  });

  it('rejects source code paths', () => {
    expect(isKnowledgePath('/Users/user/Projects/kai/hooks/LoadContext.hook.ts')).toBe(false);
    expect(isKnowledgePath('/Users/user/Projects/kai/src/index.ts')).toBe(false);
  });

  it('recognizes CONTEXT_ROUTING.md as knowledge', () => {
    expect(isKnowledgePath('/Users/user/.claude/PAI/CONTEXT_ROUTING.md')).toBe(true);
  });
});

describe('semanticFallback', () => {
  it('returns empty result when index does not exist', async () => {
    const paiDir = mkPaiDir();
    const result = await semanticFallback(paiDir, 'test query');
    expect(result.content).toBe('');
    expect(result.confidence).toBe(0);
    expect(result.sources).toHaveLength(0);
  });

  it('returns empty result when index file is empty', async () => {
    const paiDir = mkPaiDir();
    writeFileSync(join(paiDir, 'MEMORY', 'STATE', 'embeddings', 'index.jsonl'), '');
    const result = await semanticFallback(paiDir, 'test query');
    expect(result.content).toBe('');
    expect(result.confidence).toBe(0);
  });

  it('returns empty result when model not available (graceful degradation)', async () => {
    // embed() is mocked to return null (model unavailable) — the function must short-circuit to the
    // empty result at the `if (!queryEmbedding) return empty` guard, WITHOUT throwing or loading a model.
    const paiDir = mkPaiDir();
    const fakeChunk = {
      path: 'test.md',
      text: 'Some knowledge content',
      embedding: [0.1, 0.2, 0.3],
    };
    writeFileSync(
      join(paiDir, 'MEMORY', 'STATE', 'embeddings', 'index.jsonl'),
      JSON.stringify(fakeChunk) + '\n'
    );
    const result = await semanticFallback(paiDir, 'test query');
    // Model unavailable → deterministic empty (graceful degradation), never a throw.
    expect(result.content).toBe('');
    expect(result.confidence).toBe(0);
    expect(result.sources).toHaveLength(0);
  });
});
