import { describe, expect, test } from "bun:test";
import type { MemoryEntry } from "../hooks/lib/memory-scorer";
import { rankEntries, scoreEntry } from "../hooks/lib/memory-scorer";

describe("MemoryScorer", () => {
  describe("scoreEntry", () => {
    test("recent entry scores higher than old entry with same frequency", () => {
      const now = new Date();
      const recentEntry: MemoryEntry = {
        path: "recent.md",
        content: "Recent content",
        created: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
        frequency: 1,
        pinned: false,
      };

      const oldEntry: MemoryEntry = {
        path: "old.md",
        content: "Old content",
        created: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000), // 90 days ago
        frequency: 1,
        pinned: false,
      };

      const recentScore = scoreEntry(recentEntry);
      const oldScore = scoreEntry(oldEntry);

      expect(recentScore).toBeGreaterThan(oldScore);
    });

    test("high-frequency entry beats low-frequency with same age", () => {
      const created = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

      const highFreqEntry: MemoryEntry = {
        path: "high-freq.md",
        content: "High frequency content",
        created,
        frequency: 10,
        pinned: false,
      };

      const lowFreqEntry: MemoryEntry = {
        path: "low-freq.md",
        content: "Low frequency content",
        created,
        frequency: 1,
        pinned: false,
      };

      const highScore = scoreEntry(highFreqEntry);
      const lowScore = scoreEntry(lowFreqEntry);

      expect(highScore).toBeGreaterThan(lowScore);
    });

    test("pinned entry scores 2x vs unpinned with same stats", () => {
      const created = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const pinnedEntry: MemoryEntry = {
        path: "pinned.md",
        content: "Pinned content",
        created,
        frequency: 1,
        pinned: true,
      };

      const unpinnedEntry: MemoryEntry = {
        path: "unpinned.md",
        content: "Unpinned content",
        created,
        frequency: 1,
        pinned: false,
      };

      const pinnedScore = scoreEntry(pinnedEntry);
      const unpinnedScore = scoreEntry(unpinnedEntry);

      // Pinned should be exactly 2x (importance multiplier)
      expect(pinnedScore).toBeCloseTo(unpinnedScore * 2.0, 2);
    });

    test("keyword match boosts score: exact > partial > none", () => {
      const created = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const baseEntry: MemoryEntry = {
        path: "base.md",
        content: "This is about algorithm optimization",
        created,
        frequency: 1,
        pinned: false,
      };

      const exactMatch: MemoryEntry = { ...baseEntry };
      const partialMatch: MemoryEntry = {
        ...baseEntry,
        content: "This is about optimization",
      };
      const noMatch: MemoryEntry = {
        ...baseEntry,
        content: "This is about something else",
      };

      const exactScore = scoreEntry(exactMatch, ["algorithm optimization"]);
      const partialScore = scoreEntry(partialMatch, ["algorithm optimization"]);
      const noMatchScore = scoreEntry(noMatch, ["algorithm optimization"]);

      expect(exactScore).toBeGreaterThan(partialScore);
      expect(partialScore).toBeGreaterThan(noMatchScore);
    });

    test("default config values work when no config provided", () => {
      const entry: MemoryEntry = {
        path: "test.md",
        content: "Test content",
        created: new Date(),
        frequency: 1,
        pinned: false,
      };

      // Should not throw
      const score = scoreEntry(entry);
      expect(score).toBeGreaterThan(0);
    });

    test("custom config overrides defaults", () => {
      const entry: MemoryEntry = {
        path: "test.md",
        content: "Test content containing keyword",
        created: new Date(),
        frequency: 1,
        pinned: false,
      };

      const defaultScore = scoreEntry(entry, ["keyword"]);
      const customScore = scoreEntry(entry, ["keyword"], {
        relevanceExact: 5.0, // Much higher than default 2.0
      });

      expect(customScore).toBeGreaterThan(defaultScore);
    });
  });

  describe("rankEntries", () => {
    test("rankEntries respects token budget", () => {
      const entries: MemoryEntry[] = [
        {
          path: "entry1.md",
          content: "Short entry one two three",
          created: new Date(),
          frequency: 1,
          pinned: false,
        },
        {
          path: "entry2.md",
          content: "Medium entry with more words to fill up space here",
          created: new Date(),
          frequency: 1,
          pinned: false,
        },
        {
          path: "entry3.md",
          content:
            "Very long entry with many many words that should exceed the token budget if we set it low enough to test this behavior properly and ensure truncation works",
          created: new Date(),
          frequency: 1,
          pinned: false,
        },
      ];

      // Set very low budget to force truncation
      const ranked = rankEntries(entries, [], 10);

      // Should return fewer entries than input due to budget
      expect(ranked.length).toBeLessThan(entries.length);
      expect(ranked.length).toBeGreaterThan(0);
    });

    test("pinned entries always included regardless of score", () => {
      const now = new Date();
      const entries: MemoryEntry[] = [
        {
          path: "recent-high-score.md",
          content: "Recent content with high score",
          created: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
          frequency: 5,
          pinned: false,
        },
        {
          path: "old-pinned.md",
          content: "Old pinned content",
          created: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000), // 1 year ago
          frequency: 1,
          pinned: true,
        },
      ];

      const ranked = rankEntries(entries, [], 1000);

      // Both should be included
      expect(ranked).toHaveLength(2);
      // Pinned entry should be present despite low score
      expect(ranked.some((e) => e.pinned)).toBe(true);
    });

    test("entries sorted by score (descending) when budget allows all", () => {
      const now = new Date();
      const entries: MemoryEntry[] = [
        {
          path: "low-score.md",
          content: "Low score content",
          created: new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000),
          frequency: 1,
          pinned: false,
        },
        {
          path: "medium-score.md",
          content: "Medium score content",
          created: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000),
          frequency: 2,
          pinned: false,
        },
        {
          path: "high-score.md",
          content: "High score content",
          created: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
          frequency: 5,
          pinned: false,
        },
      ];

      const ranked = rankEntries(entries, [], 10000); // Large budget

      // Should return all entries
      expect(ranked).toHaveLength(3);

      // Calculate scores for verification
      const scores = ranked.map((e) => scoreEntry(e));

      // Scores should be in descending order (allowing for pinned entries)
      for (let i = 0; i < scores.length - 1; i++) {
        if (!ranked[i].pinned && !ranked[i + 1].pinned) {
          expect(scores[i]).toBeGreaterThanOrEqual(scores[i + 1]);
        }
      }
    });

    test("empty entries list returns empty", () => {
      const ranked = rankEntries([], [], 1000);
      expect(ranked).toEqual([]);
    });

    test("zero token budget returns only pinned entries", () => {
      const entries: MemoryEntry[] = [
        {
          path: "unpinned.md",
          content: "Unpinned content",
          created: new Date(),
          frequency: 10,
          pinned: false,
        },
        {
          path: "pinned.md",
          content: "Pinned content",
          created: new Date(),
          frequency: 1,
          pinned: true,
        },
      ];

      const ranked = rankEntries(entries, [], 0);

      // Only pinned entry should be included
      expect(ranked).toHaveLength(1);
      expect(ranked[0].pinned).toBe(true);
    });
  });
});
