#!/usr/bin/env bun
/**
 * EmbeddingIndex.ts — Build and update the semantic embedding index
 *
 * Usage:
 *   bun scripts/EmbeddingIndex.ts --setup         Download model + build full index
 *   bun scripts/EmbeddingIndex.ts --incremental   Rebuild only changed files
 *   bun scripts/EmbeddingIndex.ts --stats         Show index statistics
 *
 * Model: Xenova/jina-embeddings-v2-small-en (33M params, ONNX fp32)
 * Index: MEMORY/STATE/embeddings/index.jsonl
 * Manifest: MEMORY/STATE/embeddings/manifest.jsonl
 *
 * Indexed paths:
 *   - All files referenced in PAI/CONTEXT_ROUTING.md
 *   - All files in MEMORY/KNOWLEDGE/
 *   - All files in ~/Projects/Knowledge/ (if exists)
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { createHash } from 'crypto';

const MODEL_NAME = 'Xenova/jina-embeddings-v2-small-en';
const CHUNK_SIZE_CHARS = 800; // ~200 tokens
const CHUNK_OVERLAP_CHARS = 200; // ~50 tokens overlap at section boundaries

interface ManifestEntry {
  path: string;
  mtime: number;
  hash: string;
}

interface EmbeddingChunk {
  path: string;
  text: string;
  embedding: number[];
  section?: string;
}

function paiDir(): string {
  return process.env.PAI_DIR || join(process.env.HOME || '~', '.claude');
}

function indexDir(): string {
  return join(paiDir(), 'MEMORY', 'STATE', 'embeddings');
}

function indexPath(): string {
  return join(indexDir(), 'index.jsonl');
}

function manifestPath(): string {
  return join(indexDir(), 'manifest.jsonl');
}

function loadManifest(): Map<string, ManifestEntry> {
  const map = new Map<string, ManifestEntry>();
  const path = manifestPath();
  if (!existsSync(path)) return map;
  try {
    readFileSync(path, 'utf-8').trim().split('\n').filter(l => l).forEach(l => {
      const entry: ManifestEntry = JSON.parse(l);
      map.set(entry.path, entry);
    });
  } catch { }
  return map;
}

function saveManifest(entries: ManifestEntry[]): void {
  writeFileSync(manifestPath(), entries.map(e => JSON.stringify(e)).join('\n') + '\n');
}

function sha256prefix(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 8);
}

/**
 * Split text into chunks at section boundaries (markdown headers).
 * Zero overlap within sections, 50-token (~200 char) overlap across boundaries.
 */
function chunkText(text: string, sourcePath: string): Array<{ text: string; section?: string }> {
  const chunks: Array<{ text: string; section?: string }> = [];
  const sections = text.split(/(?=\n#{1,3} )/);

  for (const section of sections) {
    if (!section.trim()) continue;
    const headerMatch = section.match(/^#+\s+(.+)/);
    const sectionTitle = headerMatch?.[1]?.trim();

    if (section.length <= CHUNK_SIZE_CHARS) {
      chunks.push({ text: section.trim(), section: sectionTitle });
    } else {
      // Split large sections with overlap at boundaries
      let pos = 0;
      while (pos < section.length) {
        const end = Math.min(pos + CHUNK_SIZE_CHARS, section.length);
        const chunk = section.slice(pos, end).trim();
        if (chunk.length > 50) {
          chunks.push({ text: chunk, section: sectionTitle });
        }
        pos += CHUNK_SIZE_CHARS - CHUNK_OVERLAP_CHARS;
      }
    }
  }

  return chunks;
}

function collectIndexablePaths(): string[] {
  const pai = paiDir();
  const paths: string[] = [];

  // 1. MEMORY/KNOWLEDGE/
  const knowledgeDir = join(pai, 'MEMORY', 'KNOWLEDGE');
  if (existsSync(knowledgeDir)) {
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.md')) paths.push(full);
      }
    };
    walk(knowledgeDir);
  }

  // 2. project memory files (MEMORY.md and topic files)
  const projectMemDir = join(pai, 'projects', '-Users-your.name-Projects-kai', 'memory');
  if (existsSync(projectMemDir)) {
    readdirSync(projectMemDir).filter(f => f.endsWith('.md')).forEach(f => paths.push(join(projectMemDir, f)));
  }

  // 3. ~/Projects/Knowledge/ if exists
  const userKnowledge = join(process.env.HOME || '~', 'Projects', 'Knowledge');
  if (existsSync(userKnowledge)) {
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.md')) paths.push(full);
      }
    };
    walk(userKnowledge);
  }

  return [...new Set(paths)];
}

async function buildIndex(incremental: boolean): Promise<void> {
  const dir = indexDir();
  mkdirSync(dir, { recursive: true });

  const { pipeline } = await import('@huggingface/transformers');
  console.error(`[EmbeddingIndex] Loading model: ${MODEL_NAME}`);
  const embedder = await pipeline('feature-extraction', MODEL_NAME, { revision: 'main' });
  console.error('[EmbeddingIndex] Model loaded');

  const manifest = loadManifest();
  const paths = collectIndexablePaths();
  console.error(`[EmbeddingIndex] Found ${paths.length} indexable files`);

  const existingChunks: EmbeddingChunk[] = [];
  const newManifest: ManifestEntry[] = [];
  let processed = 0;
  let skipped = 0;

  if (incremental && existsSync(indexPath())) {
    // Load existing index, keep chunks for unchanged files
    const allChunks: EmbeddingChunk[] = readFileSync(indexPath(), 'utf-8')
      .trim().split('\n').filter(l => l).map(l => JSON.parse(l) as EmbeddingChunk);

    for (const chunk of allChunks) {
      // Keep if file still exists and not in paths-to-reprocess
      const fileUnchanged = manifest.has(chunk.path) && paths.includes(chunk.path);
      if (fileUnchanged) existingChunks.push(chunk);
    }
  }

  // STREAM chunks to disk incrementally (W1/C16 fix): the old code buffered every chunk
  // (each with a full embedding vector) in `chunksToWrite`, then did
  // `.map(JSON.stringify).join('\n')` — building a second giant string on top of the array,
  // which OOM'd on ~170 files. We now append each chunk line as it's produced (one vector in
  // memory at a time) and only keep a count.
  let chunkCount = 0;
  const writeChunk = (c: EmbeddingChunk) => {
    appendFileSync(indexPath(), JSON.stringify(c) + '\n');
    chunkCount++;
  };

  // Truncate/initialize the index file before streaming.
  writeFileSync(indexPath(), '');

  for (const filePath of paths) {
    try {
      const stat = statSync(filePath);
      const content = readFileSync(filePath, 'utf-8');
      const hash = sha256prefix(content);
      const mtime = stat.mtimeMs;

      const existing = manifest.get(filePath);
      if (incremental && existing && existing.mtime === mtime && existing.hash === hash) {
        // Keep existing chunks for this file (re-stream them, don't buffer all)
        for (const c of existingChunks) {
          if (c.path === filePath) writeChunk(c);
        }
        newManifest.push({ path: filePath, mtime, hash });
        skipped++;
        continue;
      }

      // Embed this file
      const textChunks = chunkText(content, filePath);
      for (const { text, section } of textChunks) {
        if (text.length < 50) continue;
        // pooling:'mean' + normalize:true → ONE 512-d unit vector per text.
        // Without pooling, feature-extraction returns a [tokens×512] matrix (the W1/C16 bug
        // that produced a 5GB index and made cosine comparisons meaningless).
        const output = await (embedder as any)(text, { pooling: 'mean', normalize: true });
        const embedding = Array.from(output.data as Float32Array);
        writeChunk({ path: filePath, text, embedding, section });
      }

      newManifest.push({ path: filePath, mtime, hash });
      processed++;
      if (processed % 10 === 0) {
        console.error(`[EmbeddingIndex] Processed ${processed}/${paths.length - skipped} files...`);
      }
    } catch (err) {
      console.error(`[EmbeddingIndex] Skipping ${filePath}: ${err}`);
    }
  }

  saveManifest(newManifest);

  console.error(`[EmbeddingIndex] Done: ${chunkCount} chunks from ${processed} files (${skipped} unchanged)`);
}

function showStats(): void {
  const idxPath = indexPath();
  if (!existsSync(idxPath)) {
    console.log('Index not built yet. Run: bun scripts/EmbeddingIndex.ts --setup');
    return;
  }

  const chunks = readFileSync(idxPath, 'utf-8').trim().split('\n').filter(l => l);
  const manifest = loadManifest();
  const sources = new Set<string>();
  chunks.forEach(l => { try { sources.add(JSON.parse(l).path); } catch { } });

  console.log(`Embedding Index Statistics:
  Chunks: ${chunks.length}
  Files indexed: ${sources.size}
  Manifest entries: ${manifest.size}
  Index size: ${Math.round(chunks.join('').length / 1024)}KB`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--stats')) {
    showStats();
    return;
  }

  if (args.includes('--setup') || args.includes('--incremental')) {
    const incremental = args.includes('--incremental');
    console.error(`[EmbeddingIndex] Starting ${incremental ? 'incremental' : 'full'} index build`);
    await buildIndex(incremental);
    return;
  }

  console.log(`Usage:
  bun scripts/EmbeddingIndex.ts --setup         Build full index (downloads model on first run)
  bun scripts/EmbeddingIndex.ts --incremental   Rebuild only changed files
  bun scripts/EmbeddingIndex.ts --stats         Show index statistics`);
}

if (import.meta.main) main();
