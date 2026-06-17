import { test, expect } from "bun:test";
import { recallLessons, type EmbedFn } from "../hooks/lib/memcarry-semantic";
import { writeAtom } from "../memcarry/packages/lib/src/index.js";
import type { LessonAtom } from "../memcarry/packages/lib/src/schema.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Hermetic: builds its own temp store + cache, no $HOME/live-store dependency (ApiKeys.test.ts mutates
// process.env.HOME). CRITICAL: pass an injected stub embedder so this NEVER loads the real jina model —
// loading it crashes Bun 1.3.14 on teardown (reference_bun_transformers_teardown_crash). nullEmbedder
// exercises the keyword-only path; a fixed-vector stub exercises the semantic path, both offline.
const nullEmbedder: EmbedFn = async () => null;

function lesson(id: string, trigger: string[], when: string): LessonAtom {
  return {
    type: "lesson", id, scope: "global", provenance: "human-confirmed", trigger,
    created: "2026-06-04T00:00:00Z", updated: "2026-06-04T00:00:00Z",
    claim: { when, do: "do", because: "why" }, last_used: null, use_count: 0,
  };
}

function freshStore(): string {
  const store = join(mkdtempSync(join(tmpdir(), "mc-shared-")), "store");
  writeAtom(store, lesson("lsn_patch", ["patch", "quilt"], "editing a patch file in a feed"));
  writeAtom(store, lesson("lsn_build", ["jenkins", "build"], "triggering a jenkins build"));
  return store;
}

test("shared helper (MemRecall + PostCompactRecovery H2) surfaces a keyword match — keyword-only", async () => {
  const store = freshStore();
  const cache = join(mkdtempSync(join(tmpdir(), "mc-vec-")), "vec.json");
  const { hits, semantic } = await recallLessons(store, cache, "how do I edit a patch with quilt", "feed-bbf", 5, undefined, nullEmbedder);
  expect(hits.length).toBeGreaterThan(0);
  expect(hits[0]!.id).toBe("lsn_patch"); // keyword leg surfaces it
  expect(semantic).toBe(false); // embedder returned null → keyword-only
});

test("shared helper runs the semantic leg when a (stub) embedder is available", async () => {
  const store = freshStore();
  const cache = join(mkdtempSync(join(tmpdir(), "mc-vec-")), "vec.json");
  // Stub: query + lsn_patch map to the same vector → cosine 1; lsn_build orthogonal.
  const stub: EmbedFn = async (t) =>
    /patch|quilt|edit/i.test(t) ? [1, 0, 0] : [0, 1, 0];
  const { hits, semantic } = await recallLessons(store, cache, "edit a patch", "feed-bbf", 5, undefined, stub);
  expect(semantic).toBe(true); // provider built from the stub
  expect(hits[0]!.id).toBe("lsn_patch");
  expect(hits[0]!.semanticRank).not.toBeNull(); // semantic leg contributed a rank
});

test("recallLessons returns empty (no throw) for an empty query — H2 cursor-less guard", async () => {
  const store = freshStore();
  const cache = join(mkdtempSync(join(tmpdir(), "mc-vec-")), "vec.json");
  const { hits, semantic } = await recallLessons(store, cache, "   ", "feed-bbf", 5, undefined, nullEmbedder);
  expect(hits).toHaveLength(0);
  expect(semantic).toBe(false);
});

test("recallLessons degrades to empty (no throw) when the store path is bogus", async () => {
  const { hits } = await recallLessons("/no/such/store", "/tmp/none.json", "patch quilt", null, 5, undefined, nullEmbedder);
  expect(hits).toHaveLength(0);
});
