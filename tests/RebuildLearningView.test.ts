import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import {
  deduplicateFiles,
  generateConsolidated,
  rebuild,
  scanLearningFiles,
} from "../scripts/rebuild-learning-view";

const TEST_DIR = join(import.meta.dir, ".test-learning-view");
const LEARNING_DIR = join(TEST_DIR, "MEMORY", "LEARNING");
const VIEW_DIR = join(LEARNING_DIR, ".view");
const CONSOLIDATED_PATH = join(VIEW_DIR, "consolidated.md");
const MANIFEST_PATH = join(VIEW_DIR, "manifest.json");

describe("RebuildLearningView", () => {
  // Store original PAI_DIR
  let originalPaiDir: string | undefined;

  beforeAll(() => {
    originalPaiDir = process.env.PAI_DIR;
    // Clean and create test directory
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(LEARNING_DIR, { recursive: true });
  });

  afterAll(() => {
    // Restore original PAI_DIR
    if (originalPaiDir) {
      process.env.PAI_DIR = originalPaiDir;
    } else {
      delete process.env.PAI_DIR;
    }
    // Cleanup
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe("scanLearningFiles", () => {
    test("scans markdown files recursively", () => {
      const insightsDir = join(LEARNING_DIR, "INSIGHTS");
      mkdirSync(insightsDir, { recursive: true });

      writeFileSync(
        join(insightsDir, "test1.md"),
        "---\ntitle: Test 1\ncaptured: 2026-05-01T00:00:00Z\n---\n\nContent 1"
      );
      writeFileSync(
        join(insightsDir, "test2.md"),
        "---\ntitle: Test 2\ncaptured: 2026-05-02T00:00:00Z\n---\n\nContent 2"
      );

      const files = scanLearningFiles(LEARNING_DIR);

      expect(files).toHaveLength(2);
      expect(files[0].bodyText).toContain("Content");
      expect(files[0].frontmatter.title).toBeDefined();
    });

    test("skips .view directory", () => {
      const viewDir = join(LEARNING_DIR, ".view");
      mkdirSync(viewDir, { recursive: true });

      writeFileSync(join(viewDir, "consolidated.md"), "Should be ignored");

      const files = scanLearningFiles(LEARNING_DIR);

      // Should not include .view files
      expect(files.every((f) => !f.path.includes(".view"))).toBe(true);
    });
  });

  describe("deduplicateFiles", () => {
    test("duplicate files with same content hash are deduplicated", () => {
      const file1 = {
        path: "file1.md",
        absolutePath: "/path/to/file1.md",
        content: "---\ntitle: File 1\ncaptured: 2026-05-01T00:00:00Z\n---\n\nDuplicate content",
        contentHash: "abc123",
        created: new Date("2026-05-01"),
        frontmatter: { title: "File 1", captured: "2026-05-01T00:00:00Z" },
        bodyText: "Duplicate content",
      };

      const file2 = {
        path: "file2.md",
        absolutePath: "/path/to/file2.md",
        content: "---\ntitle: File 2\ncaptured: 2026-05-02T00:00:00Z\n---\n\nDuplicate content",
        contentHash: "abc123",
        created: new Date("2026-05-02"),
        frontmatter: { title: "File 2", captured: "2026-05-02T00:00:00Z" },
        bodyText: "Duplicate content",
      };

      const file3 = {
        path: "file3.md",
        absolutePath: "/path/to/file3.md",
        content: "---\ntitle: File 3\ncaptured: 2026-05-03T00:00:00Z\n---\n\nUnique content",
        contentHash: "xyz789",
        created: new Date("2026-05-03"),
        frontmatter: { title: "File 3", captured: "2026-05-03T00:00:00Z" },
        bodyText: "Unique content",
      };

      const { uniqueFiles, hashMap } = deduplicateFiles([file1, file2, file3]);

      // Should keep only 2 unique files
      expect(uniqueFiles).toHaveLength(2);

      // Should keep the most recent duplicate (file2)
      const keptDuplicate = uniqueFiles.find((f) => f.contentHash === "abc123");
      expect(keptDuplicate?.path).toBe("file2.md");

      // Hash map should track all paths
      expect(hashMap["abc123"]).toHaveLength(2);
      expect(hashMap["xyz789"]).toHaveLength(1);
    });
  });

  describe("rebuild", () => {
    test("pinned entries always appear in output regardless of score", async () => {
      // Clean state for this test
      if (existsSync(LEARNING_DIR)) {
        rmSync(LEARNING_DIR, { recursive: true });
      }
      mkdirSync(LEARNING_DIR, { recursive: true });

      const insightsDir = join(LEARNING_DIR, "INSIGHTS");
      mkdirSync(insightsDir, { recursive: true });

      // Old pinned entry (should appear despite low score)
      writeFileSync(
        join(insightsDir, "old-pinned.md"),
        "---\ntitle: Old Pinned\ncaptured: 2024-01-01T00:00:00Z\npinned: true\n---\n\nOld pinned content that should always appear"
      );

      // Recent unpinned entry
      writeFileSync(
        join(insightsDir, "recent.md"),
        "---\ntitle: Recent\ncaptured: 2026-05-27T00:00:00Z\n---\n\nRecent content"
      );

      // Set PAI_DIR for rebuild
      process.env.PAI_DIR = TEST_DIR;

      await rebuild({ dryRun: false, tokenCap: 1000 });

      expect(existsSync(CONSOLIDATED_PATH)).toBe(true);
      const consolidated = readFileSync(CONSOLIDATED_PATH, "utf-8");

      // Pinned entry should be present
      expect(consolidated).toContain("Old Pinned");
      expect(consolidated).toContain("**Pinned:** Yes");
    });

    test("output respects token cap", async () => {
      // Clear previous test files
      rmSync(LEARNING_DIR, { recursive: true });
      mkdirSync(LEARNING_DIR, { recursive: true });

      const insightsDir = join(LEARNING_DIR, "INSIGHTS");
      mkdirSync(insightsDir, { recursive: true });

      // Create many files that would exceed a small token cap
      for (let i = 0; i < 10; i++) {
        writeFileSync(
          join(insightsDir, `entry${i}.md`),
          `---\ntitle: Entry ${i}\ncaptured: 2026-05-${String(i + 1).padStart(2, "0")}T00:00:00Z\n---\n\n${"Content ".repeat(50)}`
        );
      }

      process.env.PAI_DIR = TEST_DIR;

      await rebuild({ dryRun: false, tokenCap: 100 }); // Very small cap

      const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));

      // Should respect token cap
      expect(manifest.tokensUsed).toBeLessThanOrEqual(manifest.tokenBudget);

      const consolidated = readFileSync(CONSOLIDATED_PATH, "utf-8");
      const entryCount = (consolidated.match(/^## Entry/gm) || []).length;

      // Should have fewer entries than created due to budget
      expect(entryCount).toBeLessThan(10);
    });

    test("incremental rebuild only processes new files", async () => {
      // Clear previous test files
      rmSync(LEARNING_DIR, { recursive: true });
      mkdirSync(LEARNING_DIR, { recursive: true });

      const insightsDir = join(LEARNING_DIR, "INSIGHTS");
      mkdirSync(insightsDir, { recursive: true });

      // Create initial file
      writeFileSync(
        join(insightsDir, "initial.md"),
        "---\ntitle: Initial\ncaptured: 2026-05-01T00:00:00Z\n---\n\nInitial content"
      );

      process.env.PAI_DIR = TEST_DIR;

      // First rebuild
      await rebuild({ dryRun: false, tokenCap: 1000 });

      const firstManifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
      expect(firstManifest.totalFiles).toBe(1);

      // Wait a bit to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Add new file
      writeFileSync(
        join(insightsDir, "new.md"),
        "---\ntitle: New\ncaptured: 2026-05-27T00:00:00Z\n---\n\nNew content"
      );

      // Second rebuild (incremental)
      await rebuild({ dryRun: false, tokenCap: 1000 });

      const secondManifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));

      // Should have processed the new file
      expect(secondManifest.uniqueEntries).toBe(2);
    });

    test("manifest.json updated with rebuild timestamp", async () => {
      // Clear previous test files
      rmSync(LEARNING_DIR, { recursive: true });
      mkdirSync(LEARNING_DIR, { recursive: true });

      const insightsDir = join(LEARNING_DIR, "INSIGHTS");
      mkdirSync(insightsDir, { recursive: true });

      writeFileSync(
        join(insightsDir, "test.md"),
        "---\ntitle: Test\ncaptured: 2026-05-27T00:00:00Z\n---\n\nTest content"
      );

      process.env.PAI_DIR = TEST_DIR;

      const beforeRebuild = new Date();
      await rebuild({ dryRun: false, tokenCap: 1000 });

      expect(existsSync(MANIFEST_PATH)).toBe(true);

      const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
      const rebuildTime = new Date(manifest.lastRebuild);

      // Rebuild timestamp should be recent
      expect(rebuildTime.getTime()).toBeGreaterThanOrEqual(beforeRebuild.getTime());
      expect(manifest.totalFiles).toBeGreaterThan(0);
      expect(manifest.tokenBudget).toBe(1000);
    });

    test("empty LEARNING directory produces empty view without crash", async () => {
      // Clear all files
      rmSync(LEARNING_DIR, { recursive: true });
      mkdirSync(LEARNING_DIR, { recursive: true });

      process.env.PAI_DIR = TEST_DIR;

      // Should not throw
      await rebuild({ dryRun: false, tokenCap: 1000 });

      expect(existsSync(CONSOLIDATED_PATH)).toBe(true);
      const consolidated = readFileSync(CONSOLIDATED_PATH, "utf-8");

      expect(consolidated).toContain("Empty");

      const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
      expect(manifest.totalFiles).toBe(0);
      expect(manifest.uniqueEntries).toBe(0);
    });

    test("dry-run mode does not write files", async () => {
      // Clear previous test files
      rmSync(LEARNING_DIR, { recursive: true });
      mkdirSync(LEARNING_DIR, { recursive: true });

      const insightsDir = join(LEARNING_DIR, "INSIGHTS");
      mkdirSync(insightsDir, { recursive: true });

      writeFileSync(
        join(insightsDir, "test.md"),
        "---\ntitle: Test\ncaptured: 2026-05-27T00:00:00Z\n---\n\nTest content"
      );

      process.env.PAI_DIR = TEST_DIR;

      // Ensure no view exists
      if (existsSync(VIEW_DIR)) {
        rmSync(VIEW_DIR, { recursive: true });
      }

      await rebuild({ dryRun: true, tokenCap: 1000 });

      // Should not have created view files
      expect(existsSync(CONSOLIDATED_PATH)).toBe(false);
      expect(existsSync(MANIFEST_PATH)).toBe(false);
    });
  });

  describe("generateConsolidated", () => {
    test("generates valid markdown with metadata", () => {
      const files = [
        {
          path: "test.md",
          absolutePath: "/path/to/test.md",
          content: "---\ntitle: Test\n---\n\nTest content",
          contentHash: "abc123",
          created: new Date("2026-05-27T00:00:00Z"),
          frontmatter: {
            title: "Test Entry",
            category: "testing",
            confidence: "high",
            pinned: true,
          },
          bodyText: "Test content for consolidated view",
        },
      ];

      const consolidated = generateConsolidated(files);

      expect(consolidated).toContain("# Learning View — Consolidated");
      expect(consolidated).toContain("## Test Entry");
      expect(consolidated).toContain("**Source:** `test.md`");
      expect(consolidated).toContain("**Category:** testing");
      expect(consolidated).toContain("**Confidence:** high");
      expect(consolidated).toContain("**Pinned:** Yes");
      expect(consolidated).toContain("Test content for consolidated view");
    });

    test("handles entries without optional metadata", () => {
      const files = [
        {
          path: "minimal.md",
          absolutePath: "/path/to/minimal.md",
          content: "Minimal content",
          contentHash: "xyz789",
          created: new Date("2026-05-27T00:00:00Z"),
          frontmatter: {},
          bodyText: "Minimal content",
        },
      ];

      const consolidated = generateConsolidated(files);

      expect(consolidated).toContain("## minimal.md"); // Uses path as fallback title
      expect(consolidated).toContain("Minimal content");
      expect(consolidated).not.toContain("**Category:**");
      expect(consolidated).not.toContain("**Pinned:**");
    });
  });
});
