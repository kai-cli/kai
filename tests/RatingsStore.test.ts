import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  ratingsPath, loadAll, count, loadRecent, loadSince, filterByRating, append, cap,
  entryDate, DEFAULT_RATINGS_CAP, type RatingEntry,
} from "../hooks/lib/ratings-store";

const TMP = mkdtempSync(join(tmpdir(), "ratings-store-"));

function seed(entries: object[]) {
  const p = ratingsPath(TMP);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString();
}

describe("ratings-store (W11)", () => {
  beforeEach(() => { try { rmSync(ratingsPath(TMP), { force: true }); } catch {} });
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  test("missing file → empty/zero, never throws", () => {
    expect(loadAll(TMP)).toEqual([]);
    expect(count(TMP)).toBe(0);
    expect(loadRecent(5, TMP)).toEqual([]);
    expect(cap(500, TMP)).toBe(0);
  });

  test("loadAll parses entries and skips malformed lines", () => {
    const p = ratingsPath(TMP);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, `${JSON.stringify({ rating: 9, timestamp: daysAgo(1) })}\nNOT JSON\n${JSON.stringify({ rating: 3, timestamp: daysAgo(2) })}\n`);
    const all = loadAll(TMP);
    expect(all.length).toBe(2); // malformed line skipped, not fatal
    expect(all[0]!.rating).toBe(9);
  });

  test("count = non-empty line count", () => {
    seed([{ rating: 8 }, { rating: 7 }, { rating: 10 }]);
    expect(count(TMP)).toBe(3);
  });

  test("loadRecent returns the last N (newest)", () => {
    seed([{ rating: 1 }, { rating: 2 }, { rating: 3 }, { rating: 4 }]);
    const recent = loadRecent(2, TMP);
    expect(recent.map((e) => e.rating)).toEqual([3, 4]);
  });

  test("loadSince filters by entryDate within window (timestamp OR date field)", () => {
    seed([
      { rating: 9, timestamp: daysAgo(1) },   // in
      { rating: 8, date: daysAgo(3) },        // in (legacy `date`)
      { rating: 2, timestamp: daysAgo(30) },  // out
    ]);
    const recent = loadSince(7, TMP);
    expect(recent.map((e) => e.rating).sort()).toEqual([8, 9]);
  });

  test("filterByRating bridges low ratings", () => {
    seed([{ rating: 2 }, { rating: 9 }, { rating: 3 }, { rating: 10 }]);
    const low = filterByRating((r) => r <= 3, TMP);
    expect(low.map((e) => e.rating).sort()).toEqual([2, 3]);
  });

  test("append adds a line (creates file+dir)", () => {
    expect(append({ rating: 7, timestamp: daysAgo(0) }, TMP)).toBe(true);
    expect(count(TMP)).toBe(1);
    expect(loadAll(TMP)[0]!.rating).toBe(7);
  });

  test("cap trims to last max, returns new count; no-op under cap", () => {
    seed(Array.from({ length: 10 }, (_, i) => ({ rating: i })));
    expect(cap(4, TMP)).toBe(4);
    const after = loadAll(TMP);
    expect(after.length).toBe(4);
    expect(after.map((e) => e.rating)).toEqual([6, 7, 8, 9]); // last 4
    // under cap → no change
    expect(cap(100, TMP)).toBe(4);
  });

  test("entryDate prefers timestamp, falls back to date, null when absent/bad", () => {
    expect(entryDate({ rating: 1, timestamp: "2026-01-01T00:00:00Z" } as RatingEntry)?.getUTCFullYear()).toBe(2026);
    expect(entryDate({ rating: 1, date: "2025-06-01" } as RatingEntry)?.getUTCFullYear()).toBe(2025);
    expect(entryDate({ rating: 1 } as RatingEntry)).toBeNull();
    expect(entryDate({ rating: 1, timestamp: "garbage" } as RatingEntry)).toBeNull();
  });

  test("DEFAULT_RATINGS_CAP is 500 (matches SessionCleanup contract)", () => {
    expect(DEFAULT_RATINGS_CAP).toBe(500);
  });
});
