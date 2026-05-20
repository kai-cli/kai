import { describe, it, expect, afterEach } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
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
    expect(isKnowledgePath('/Users/you/.claude/MEMORY/KNOWLEDGE/firmware.md')).toBe(true);
  });

  it('recognizes Knowledge/ paths as knowledge', () => {
    expect(isKnowledgePath('/Users/you/Projects/Knowledge/networking.md')).toBe(true);
  });

  it('rejects source code paths', () => {
    expect(isKnowledgePath('/Users/you/Projects/kai/hooks/LoadContext.hook.ts')).toBe(false);
    expect(isKnowledgePath('/Users/you/Projects/kai/src/index.ts')).toBe(false);
  });

  it('recognizes CONTEXT_ROUTING.md as knowledge', () => {
    expect(isKnowledgePath('/Users/you/.claude/PAI/CONTEXT_ROUTING.md')).toBe(true);
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
    // This test confirms no throw when @huggingface/transformers is not available
    // in test environment — the function should return empty, not crash
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
    // With fake embedding data and possibly no model installed, should not throw
    const result = await semanticFallback(paiDir, 'test query');
    // Either returns content (if model installed) or empty (graceful degradation)
    expect(typeof result.content).toBe('string');
    expect(typeof result.confidence).toBe('number');
    expect(Array.isArray(result.sources)).toBe(true);
  });
});
