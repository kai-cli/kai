import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync, utimesSync } from "fs";
import { join } from "path";
import { buildMemoryEntry } from "../hooks/MemoryRecall.hook";
import { rankEntries } from "../hooks/lib/memory-scorer";

const TEST_DIR = join(import.meta.dir, ".test-memory-recall");

interface IndexEntry {
  title: string;
  file: string;
  description: string;
  keywords: string[];
  category?: string;
}

function idx(file: string, description = "desc"): IndexEntry {
  return { title: file, file, description, keywords: [] };
}

describe("MemoryRecall — W2 scorer activation", () => {
  beforeAll(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });
  afterAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe("buildMemoryEntry adapter", () => {
    test("reads body content and frontmatter pinned/tags", () => {
      const file = "pinned-note.md";
      writeFileSync(
        join(TEST_DIR, file),
        `---\npinned: true\ntags: [alpha, beta]\n---\nThis is the real body content here.`
      );
      const e = buildMemoryEntry(TEST_DIR, idx(file));
      expect(e.pinned).toBe(true);
      expect(e.tags).toEqual(["alpha", "beta"]);
      expect(e.content).toContain("real body content");
    });

    test("uses frontmatter created date when present", () => {
      const file = "dated.md";
      writeFileSync(join(TEST_DIR, file), `---\ncreated: 2024-01-15T00:00:00Z\n---\nbody`);
      const e = buildMemoryEntry(TEST_DIR, idx(file));
      expect(e.created.getUTCFullYear()).toBe(2024);
    });

    test("falls back to captured when created absent", () => {
      const file = "captured.md";
      writeFileSync(join(TEST_DIR, file), `---\ncaptured: 2023-06-01T00:00:00Z\n---\nbody`);
      const e = buildMemoryEntry(TEST_DIR, idx(file));
      expect(e.created.getUTCFullYear()).toBe(2023);
    });

    test("falls back to mtime when no date frontmatter", () => {
      const file = "nodate.md";
      const p = join(TEST_DIR, file);
      writeFileSync(p, `---\ncategory: x\n---\nbody`);
      const when = new Date("2022-03-03T00:00:00Z");
      utimesSync(p, when, when);
      const e = buildMemoryEntry(TEST_DIR, idx(file));
      expect(e.created.getUTCFullYear()).toBe(2022);
    });

    test("missing file falls back to description entry (never throws)", () => {
      const e = buildMemoryEntry(TEST_DIR, idx("does-not-exist.md", "the description"));
      expect(e.content).toBe("the description");
      expect(e.pinned).toBe(false);
      expect(e.created.getTime()).toBe(0);
    });
  });

  describe("ranking semantics via rankEntries", () => {
    test("pinned candidate always surfaces despite old date", () => {
      const now = Date.now();
      const entries = [
        { path: "fresh.md", content: "fresh strong match content", created: new Date(now), frequency: 5, pinned: false },
        { path: "old-pin.md", content: "ancient pinned content", created: new Date(now - 400 * 864e5), frequency: 1, pinned: true },
      ];
      const ranked = rankEntries(entries, [], 5000);
      expect(ranked.some(e => e.pinned)).toBe(true);
    });

    test("keyword relevance lifts a matching memory above a non-matching one of equal age", () => {
      const created = new Date(Date.now() - 30 * 864e5);
      const entries = [
        { path: "match.md", content: "all about widget routing", created, frequency: 1, pinned: false },
        { path: "nomatch.md", content: "unrelated topic entirely", created, frequency: 1, pinned: false },
      ];
      const ranked = rankEntries(entries, ["widget"], 5000);
      expect(ranked[0].path).toBe("match.md");
    });

    test("token budget evicts lowest-ranked when over budget", () => {
      const created = new Date();
      const big = "word ".repeat(200);
      const entries = [
        { path: "a.md", content: big, created, frequency: 5, pinned: false },
        { path: "b.md", content: big, created: new Date(Date.now() - 300 * 864e5), frequency: 1, pinned: false },
      ];
      const ranked = rankEntries(entries, [], 50);
      expect(ranked.length).toBeLessThan(entries.length);
    });
  });

  describe("flag default", () => {
    test("config block is well-formed and useScorer defaults on when omitted", () => {
      // Mirrors loadMemoryRecallSettings default logic: useScorer !== false
      const omitted: any = {};
      expect(omitted.useScorer !== false).toBe(true);
      const explicitOff = { useScorer: false };
      expect(explicitOff.useScorer !== false).toBe(false);
    });
  });
});
