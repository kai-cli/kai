import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync, readdirSync, appendFileSync, utimesSync } from "fs";
import { join } from "path";

// Point PAI_DIR at an isolated temp dir BEFORE importing the cache (paiPath reads it).
const TEST_DIR = join(import.meta.dir, ".test-transcript-cache");
process.env.PAI_DIR = TEST_DIR;

const { getCachedTranscript, transcriptCacheDir, pruneOldCaches } = await import("../hooks/lib/transcript-cache");
const { parseTranscript } = await import("../hooks/lib/transcript-parser");

function jsonl(...entries: object[]): string {
  return entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

function writeTranscript(name: string, content: string): string {
  const p = join(TEST_DIR, name);
  writeFileSync(p, content);
  return p;
}

const SAMPLE = jsonl(
  { type: "user", message: { content: "do the thing" } },
  { type: "assistant", message: { content: "result\n🎯 COMPLETED: did the thing" } }
);

describe("transcript-cache (W3)", () => {
  beforeAll(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(join(TEST_DIR, "config"), { recursive: true });
    // Enabled flag (default true anyway, but be explicit).
    writeFileSync(
      join(TEST_DIR, "config", "settings.json"),
      JSON.stringify({ transcriptCache: { enabled: true } })
    );
  });
  afterAll(() => rmSync(TEST_DIR, { recursive: true, force: true }));
  afterEach(() => {
    const dir = transcriptCacheDir();
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  test("cache hit returns output identical to direct parse (deep equal)", () => {
    const p = writeTranscript("equal.jsonl", SAMPLE);
    const direct = parseTranscript(p);
    const cached = getCachedTranscript(p); // miss → writes
    const cached2 = getCachedTranscript(p); // hit
    expect(cached).toEqual(direct);
    expect(cached2).toEqual(direct);
  });

  test("first call writes a cache file under MEMORY/STATE/transcript-cache", () => {
    const p = writeTranscript("writes.jsonl", SAMPLE);
    getCachedTranscript(p);
    const dir = transcriptCacheDir();
    expect(dir).toContain(join("MEMORY", "STATE", "transcript-cache"));
    expect(existsSync(dir)).toBe(true);
    expect(readdirSync(dir).length).toBeGreaterThan(0);
  });

  test("modifying the transcript invalidates the cache (mtime+size key)", () => {
    const p = writeTranscript("invalidate.jsonl", SAMPLE);
    const first = getCachedTranscript(p);
    expect(first.completionSummary).toContain("did the thing");
    // Append a new turn — size + mtime change → stale key → re-parse.
    appendFileSync(
      p,
      jsonl({ type: "user", message: { content: "again" } }, { type: "assistant", message: { content: "🎯 COMPLETED: second result" } })
    );
    const second = getCachedTranscript(p);
    expect(second.completionSummary).toContain("second result");
    expect(second.completionSummary).not.toContain("did the thing");
  });

  test("corrupt cache file falls back to direct parse (never throws)", () => {
    const p = writeTranscript("corrupt.jsonl", SAMPLE);
    getCachedTranscript(p); // create a valid cache file
    // Corrupt every cache file
    const dir = transcriptCacheDir();
    for (const f of readdirSync(dir)) writeFileSync(join(dir, f), "{ this is not json");
    const result = getCachedTranscript(p);
    expect(result.completionSummary).toContain("did the thing");
  });

  test("missing transcript file does not throw, returns empty parse", () => {
    const result = getCachedTranscript(join(TEST_DIR, "does-not-exist.jsonl"));
    expect(result.completionSummary).toBe("");
    expect(result.responseState).toBe("completed");
  });

  test("flag disabled bypasses cache (no cache dir created)", () => {
    writeFileSync(
      join(TEST_DIR, "config", "settings.json"),
      JSON.stringify({ transcriptCache: { enabled: false } })
    );
    const p = writeTranscript("disabled.jsonl", SAMPLE);
    const result = getCachedTranscript(p);
    expect(result).toEqual(parseTranscript(p));
    expect(existsSync(transcriptCacheDir())).toBe(false);
    // restore
    writeFileSync(
      join(TEST_DIR, "config", "settings.json"),
      JSON.stringify({ transcriptCache: { enabled: true } })
    );
  });

  test("pruneOldCaches removes files older than maxAgeDays, keeps recent (SF-4)", () => {
    const dir = transcriptCacheDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "recent.json"), "{}");
    writeFileSync(join(dir, "stale.json"), "{}");
    // backdate stale.json 40 days
    const old = new Date(Date.now() - 40 * 86400000);
    utimesSync(join(dir, "stale.json"), old, old);
    const removed = pruneOldCaches(30);
    expect(removed).toBe(1);
    expect(existsSync(join(dir, "recent.json"))).toBe(true);
    expect(existsSync(join(dir, "stale.json"))).toBe(false);
  });

  test("pruneOldCaches on missing dir → 0, no throw", () => {
    rmSync(transcriptCacheDir(), { recursive: true, force: true });
    expect(pruneOldCaches(30)).toBe(0);
  });
});
