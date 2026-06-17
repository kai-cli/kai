import { describe, test, expect } from "bun:test";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSemanticProvider,
  lessonEmbedText,
  VectorCache,
  type EmbedFn,
} from "../hooks/lib/memcarry-semantic";

// Minimal LessonAtom shape (avoids importing zod-backed @memcarry/lib at runtime in this host test).
function lesson(id: string, trigger: string[], when: string, doText = "do", because = "why"): any {
  return {
    type: "lesson",
    id,
    scope: "global",
    provenance: "human-confirmed",
    trigger,
    created: "2026-06-04T00:00:00Z",
    updated: "2026-06-04T00:00:00Z",
    claim: { when, do: doText, because },
    last_used: null,
    use_count: 0,
  };
}

// Deterministic stub embedder: map known texts to fixed unit-ish vectors so cosine is predictable.
// No real model — keeps the test fast and offline (the whole point of the injectable EmbedFn).
function stubEmbedder(map: Record<string, number[]>, opts: { failOn?: string } = {}): EmbedFn {
  return async (text: string) => {
    if (opts.failOn !== undefined && text.includes(opts.failOn)) return null;
    // exact match first, else a fallback orthogonal vector
    for (const [k, v] of Object.entries(map)) {
      if (text.includes(k)) return v;
    }
    return [0, 0, 1];
  };
}

function tmpCachePath(): string {
  return join(mkdtempSync(join(tmpdir(), "memcarry-vec-")), "index", "vectors.json");
}

describe("memcarry-semantic — host ScoreProvider (T003) + vector cache (T004)", () => {
  test("provider returns cosine for embedded lessons, abstains (null) for un-embeddable ones", async () => {
    const lessons = [lesson("lsn_a", ["patch"], "editing a patch")];
    const embed = stubEmbedder({ patch: [1, 0, 0] }, {}); // prompt + lesson both map to [1,0,0]
    const cache = new VectorCache(tmpCachePath());
    const provider = await buildSemanticProvider(lessons, "patch question", cache, embed);
    expect(provider).not.toBeNull();
    const score = provider!(lessons[0], "patch question");
    expect(score).toBeCloseTo(1, 6); // identical vectors → cosine 1
  });

  test("returns null provider when the PROMPT can't be embedded (degrade to keyword-only)", async () => {
    const lessons = [lesson("lsn_a", ["patch"], "editing a patch")];
    const embed = stubEmbedder({}, { failOn: "unembeddable-prompt" });
    const cache = new VectorCache(tmpCachePath());
    const provider = await buildSemanticProvider(lessons, "unembeddable-prompt", cache, embed);
    expect(provider).toBeNull(); // caller runs keyword-only recall
  });

  test("a lesson that fails to embed simply gets no semantic score (abstain), prompt still works", async () => {
    const lessons = [
      lesson("lsn_ok", ["patch"], "editing a patch"),
      lesson("lsn_bad", ["BADLESSON"], "BADLESSON trigger"),
    ];
    // prompt embeds fine; lsn_bad's text fails
    const embed = stubEmbedder({ patch: [1, 0, 0], prompt: [1, 0, 0] }, { failOn: "BADLESSON" });
    const cache = new VectorCache(tmpCachePath());
    const provider = await buildSemanticProvider(lessons, "prompt patch", cache, embed);
    expect(provider).not.toBeNull();
    expect(provider!(lessons[0], "prompt patch")).toBeCloseTo(1, 6);
    expect(provider!(lessons[1], "prompt patch")).toBeNull(); // abstained
  });

  test("vector cache persists and is reused on a second build (no re-embed)", async () => {
    const lessons = [lesson("lsn_a", ["patch"], "editing a patch")];
    const path = tmpCachePath();
    let embedCalls = 0;
    const counting: EmbedFn = async (t) => {
      embedCalls++;
      return [1, 0, 0];
    };
    const cache1 = new VectorCache(path);
    await buildSemanticProvider(lessons, "q1", cache1, counting);
    cache1.flush();
    const afterFirst = embedCalls; // prompt + 1 lesson = 2 embeds
    expect(existsSync(path)).toBe(true);

    // Second build with a FRESH cache loaded from disk: prompt re-embeds, lesson is cache-hit.
    const cache2 = new VectorCache(path);
    await buildSemanticProvider(lessons, "q2", cache2, counting);
    // only the prompt should have re-embedded (+1), lesson vector came from cache
    expect(embedCalls).toBe(afterFirst + 1);
  });

  test("cache discards entries on model/dim mismatch (clean rebuild)", async () => {
    const path = tmpCachePath();
    const lessons = [lesson("lsn_a", ["patch"], "editing a patch")];
    const embed = stubEmbedder({ patch: [1, 0, 0] });
    const cache = new VectorCache(path);
    await buildSemanticProvider(lessons, "q", cache, embed);
    cache.flush();

    // Tamper the on-disk header to a different model → next load must discard.
    const raw = JSON.parse(readFileSync(path, "utf8"));
    raw.model = "some-other-model";
    require("node:fs").writeFileSync(path, JSON.stringify(raw));

    const reloaded = new VectorCache(path);
    // entry should be gone → get() returns null for the same (id, hash)
    const hash = require("node:crypto")
      .createHash("sha1")
      .update(lessonEmbedText(lessons[0]))
      .digest("hex")
      .slice(0, 16);
    expect(reloaded.get("lsn_a", hash)).toBeNull();
  });
});
