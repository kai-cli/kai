import { test, expect } from "bun:test";
import { buildSemanticProvider, VectorCache, type EmbedFn } from "../hooks/lib/memcarry-semantic";
import { recall, type LessonAtom, type Atom } from "../memcarry/packages/lib/src/index.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Force the embedder unavailable via the INJECTABLE EmbedFn — NOT mock.module (which leaks globally
// across Bun test files). Hermetic: builds its own atoms, no $HOME / live-store dependency (another
// test, ApiKeys, mutates process.env.HOME, so depending on the real store path is order-fragile).
const nullEmbedder: EmbedFn = async () => null;

function lesson(id: string, trigger: string[], when: string): LessonAtom {
  return {
    type: "lesson", id, scope: "global", provenance: "human-confirmed", trigger,
    created: "2026-06-04T00:00:00Z", updated: "2026-06-04T00:00:00Z",
    claim: { when, do: "do", because: "why" }, last_used: null, use_count: 0,
  };
}

test("degraded (no embedder): provider is null, keyword-only recall still fires", async () => {
  const atoms: Atom[] = [lesson("lsn_patch", ["patch"], "editing a patch file")];
  const lessons = atoms.filter((a): a is LessonAtom => a.type === "lesson");

  const cache = new VectorCache(join(mkdtempSync(join(tmpdir(), "mr-")), "vec.json"));
  const provider = await buildSemanticProvider(lessons, "edit a patch file", cache, nullEmbedder);
  expect(provider).toBeNull(); // embedder returns null → no semantic leg

  // recall with no provider = keyword-only RRF; should still surface the patch lesson.
  const hits = recall(atoms, "edit a patch file", null, 5, provider ?? undefined);
  expect(hits.length).toBeGreaterThan(0);
  expect(hits[0]!.semanticRank).toBeNull(); // confirms keyword-only ranking
  expect(hits[0]!.keywordRank).toBe(1);
});
