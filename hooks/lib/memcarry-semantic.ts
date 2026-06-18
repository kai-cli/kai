/**
 * memcarry-semantic.ts — HOST-SIDE semantic ScoreProvider for memcarry recall (B2 / Fork 1).
 *
 * The memcarry core (`@memcarry/lib`) stays embedding-free and exposes a per-lesson `ScoreProvider`
 * seam. THIS module is the KAI host's implementation of that seam: it backs recall with jina
 * embeddings (KAI's shared `embed()` / `cosineSimilarity()`), so the portable core never imports a
 * model. KAI/others pass no provider and get keyword-only recall.
 *
 * ASYNC↔SYNC bridge: `embed()` is async but `ScoreProvider` is sync. So `buildSemanticProvider()`
 * does ALL embedding up front (prompt + each lesson, via a rebuildable vector cache) and returns a
 * SYNC closure that only does cosine lookups against the precomputed vectors. This is why a vector
 * cache exists: lesson vectors persist across turns; only the prompt is embedded per call.
 *
 * Degrade-without-crashing (observability rule): if the embedder is unavailable, the prompt embed
 * returns null → `buildSemanticProvider` returns null → recall runs keyword-only. A null is LOGGED to
 * stderr (not silently swallowed) so the degrade is visible. Never throws.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { embed as paiEmbed, EMBEDDING_MODEL, EMBEDDING_DIM } from "./embeddings.js";
import { cosineSimilarity } from "./similarity.js";
// Type-only imports — erased at runtime, so this module has NO runtime dependency on @memcarry/lib
// (no zod resolution needed from the host hook context).
import type { ScoreProvider, RecallHit } from "../../memcarry/packages/lib/src/recall.js";
import type { LessonAtom } from "../../memcarry/packages/lib/src/schema.js";

/** The text embedded for a lesson — rendered claim + triggers (research R4: lifts both recall legs). */
export function lessonEmbedText(l: LessonAtom): string {
  return `${l.claim.when} ${l.claim.do} ${l.claim.because} ${l.trigger.join(" ")}`.trim();
}

/** content hash of the embedded text — invalidates a cached vector when the lesson is edited. */
function hashText(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 16);
}

interface CacheEntry {
  hash: string;
  vector: number[];
}
interface CacheFile {
  model: string;
  dim: number;
  entries: Record<string, CacheEntry>; // atomId -> {hash, vector}
}

/**
 * Gitignored, rebuildable vector cache (data-model E1). Keyed by atomId + content-hash. A header
 * model/dim mismatch discards the whole cache (clean rebuild on model swap). Pure derived data —
 * atoms remain the sole source of truth.
 */
export class VectorCache {
  private data: CacheFile;
  constructor(private path: string) {
    this.data = { model: EMBEDDING_MODEL, dim: EMBEDDING_DIM, entries: {} };
    try {
      if (existsSync(path)) {
        const loaded = JSON.parse(readFileSync(path, "utf8")) as CacheFile;
        // Model/dim mismatch ⇒ discard (rebuild). Otherwise adopt.
        if (loaded.model === EMBEDDING_MODEL && loaded.dim === EMBEDDING_DIM && loaded.entries) {
          this.data = loaded;
        }
      }
    } catch {
      /* corrupt cache → start fresh; it's rebuildable, not truth */
    }
  }
  get(atomId: string, hash: string): number[] | null {
    const e = this.data.entries[atomId];
    return e && e.hash === hash ? e.vector : null;
  }
  set(atomId: string, hash: string, vector: number[]): void {
    this.data.entries[atomId] = { hash, vector };
  }
  flush(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify(this.data));
    } catch (e) {
      // Observability, not silence (feedback-swallow-catch-is-observability-hole): the cache failing
      // to persist is a perf regression (re-embed next turn), not a correctness bug — log + continue.
      console.error(`[memcarry-semantic] vector cache flush failed: ${(e as Error).message}`);
    }
  }
}

/** Injectable embedder so tests use a deterministic stub instead of loading the real model. */
export type EmbedFn = (text: string) => Promise<number[] | null>;

/**
 * Build a SYNC `ScoreProvider` backed by precomputed jina vectors. Embeds the prompt + every lesson
 * (cache-backed) up front. Returns null if the prompt can't be embedded (embedder unavailable) — the
 * caller then runs keyword-only recall.
 *
 * @param lessons   the candidate lesson atoms (host reads these from the store)
 * @param prompt    the user prompt
 * @param cache     vector cache (rebuildable); mutated + should be flushed by the caller after
 * @param embedFn   defaults to KAI's shared embed(); injectable for tests
 */
export async function buildSemanticProvider(
  lessons: LessonAtom[],
  prompt: string,
  cache: VectorCache,
  embedFn: EmbedFn = paiEmbed
): Promise<ScoreProvider | null> {
  const promptVec = await embedFn(prompt);
  if (!promptVec) {
    // Visible degrade — not a silent swallow.
    console.error("[memcarry-semantic] embedder unavailable — recall falls back to keyword-only");
    return null;
  }

  // Ensure every lesson has a current vector (embed on cache miss / hash mismatch).
  const vecById = new Map<string, number[]>();
  for (const l of lessons) {
    const text = lessonEmbedText(l);
    const hash = hashText(text);
    let vec = cache.get(l.id, hash);
    if (!vec) {
      const fresh = await embedFn(text);
      if (!fresh) continue; // lesson un-embeddable this turn → it simply gets no semantic rank
      vec = fresh;
      cache.set(l.id, hash, vec);
    }
    vecById.set(l.id, vec);
  }

  // SYNC closure: cosine lookup against precomputed vectors. null = abstain (no semantic rank).
  return (lesson: LessonAtom): number | null => {
    const v = vecById.get(lesson.id);
    return v ? cosineSimilarity(promptVec, v) : null;
  };
}

/** Result of the shared recall helper. `semantic` reports whether the embedding leg was active. */
export interface RecallResult {
  hits: RecallHit[];
  semantic: boolean;
}

/**
 * Shared recall flow used by BOTH MemRecall (UserPromptSubmit) and PostCompactRecovery (H2) — single
 * source so the two hooks can never drift (Constitution III: reuse > re-implement). Loads atoms from
 * disk, builds the host semantic provider (degrades to keyword-only on embedder failure), runs the
 * core RRF recall(). Never throws — returns empty hits on any failure. The memcarry lib is imported
 * dynamically so a host with no @memcarry/lib resolves gracefully (returns empty, doesn't crash).
 *
 * @param storePath  MEMCARRY_STORE root
 * @param cachePath  vector cache file (gitignored, rebuildable)
 * @param query      text to recall against (a user prompt, or a resume cursor's next/summary for H2)
 * @param project    active project name (global lessons always eligible)
 * @param k          top-K (default 5)
 * @param onNote     optional heartbeat/log callback (hook supplies its own label)
 */
export async function recallLessons(
  storePath: string,
  cachePath: string,
  query: string,
  project: string | null,
  k = 5,
  onNote?: (note: string) => void,
  embedFn?: EmbedFn
): Promise<RecallResult> {
  const note = onNote ?? (() => {});
  if (!query.trim()) return { hits: [], semantic: false };

  let lib: typeof import("../../memcarry/packages/lib/src/index.js");
  try {
    lib = await import("../../memcarry/packages/lib/src/index.js");
  } catch (e) {
    note(`degraded: @memcarry/lib unavailable: ${(e as Error).message?.slice(0, 80)}`);
    return { hits: [], semantic: false };
  }

  let atoms;
  try {
    atoms = lib.readAllAtoms(storePath);
  } catch (e) {
    note(`degraded: store read failed: ${(e as Error).message?.slice(0, 80)}`);
    return { hits: [], semantic: false };
  }

  const lessons = atoms.filter((a: any): a is LessonAtom => a.type === "lesson");
  if (lessons.length === 0) return { hits: [], semantic: false };

  let provider: ScoreProvider | undefined;
  try {
    const cache = new VectorCache(cachePath);
    const built = await buildSemanticProvider(lessons, query, cache, embedFn ?? paiEmbed);
    cache.flush();
    provider = built ?? undefined;
  } catch (e) {
    note(`semantic provider error (keyword-only): ${(e as Error).message?.slice(0, 80)}`);
    provider = undefined;
  }

  const hits = lib.recall(atoms, query, project, k, provider);
  return { hits, semantic: Boolean(provider) };
}
