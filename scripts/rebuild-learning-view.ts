#!/usr/bin/env bun
/**
 * Rebuild Learning View — Deduplicate, score, and materialize learning data
 *
 * Usage: bun scripts/rebuild-learning-view.ts [--dry-run] [--token-cap 4000]
 *
 * Scans MEMORY/LEARNING/ recursively for .md files, deduplicates by content hash,
 * scores using composite scoring, and generates consolidated view with manifest.
 */

import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { join, relative } from "path";
import { parseArgs } from "util";
import type { MemoryEntry } from "../hooks/lib/memory-scorer";
import { rankEntries } from "../hooks/lib/memory-scorer";

interface LearningFile {
  path: string;
  absolutePath: string;
  content: string;
  contentHash: string;
  created: Date;
  frontmatter: Record<string, any>;
  bodyText: string;
}

interface Manifest {
  lastRebuild: string;
  totalFiles: number;
  uniqueEntries: number;
  deduplicated: number;
  pinnedCount: number;
  tokenBudget: number;
  tokensUsed: number;
  hashes: Record<string, string[]>; // hash -> [file paths]
}

/**
 * Parse frontmatter from markdown content
 */
function parseFrontmatter(content: string): {
  frontmatter: Record<string, any>;
  bodyText: string;
} {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) {
    return { frontmatter: {}, bodyText: content };
  }

  const [, fmText, body] = fmMatch;
  const frontmatter: Record<string, any> = {};

  for (const line of fmText.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value: any = line.slice(colonIdx + 1).trim();

    // Remove quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Parse booleans
    if (value === "true") value = true;
    if (value === "false") value = false;

    frontmatter[key] = value;
  }

  return { frontmatter, bodyText: body.trim() };
}

/**
 * Compute SHA-256 hash of content
 */
function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Extract created date from frontmatter or filename
 */
function extractCreatedDate(file: LearningFile): Date {
  // Try frontmatter fields
  if (file.frontmatter.captured) {
    return new Date(file.frontmatter.captured);
  }
  if (file.frontmatter.created) {
    return new Date(file.frontmatter.created);
  }

  // Try filename timestamp (YYYY-MM-DD format)
  const filenameMatch = file.path.match(/(\d{4}-\d{2}-\d{2})/);
  if (filenameMatch) {
    return new Date(filenameMatch[1]);
  }

  // Fallback to file stat
  const stat = statSync(file.absolutePath);
  return stat.birthtime;
}

/**
 * Recursively scan directory for .md files
 */
function scanLearningFiles(
  dir: string,
  lastRebuild?: Date
): LearningFile[] {
  const files: LearningFile[] = [];

  function scan(currentDir: string) {
    if (!existsSync(currentDir)) return;

    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);

      // Skip .view directory
      if (entry.isDirectory() && entry.name === ".view") continue;

      if (entry.isDirectory()) {
        scan(fullPath);
      } else if (entry.name.endsWith(".md")) {
        // Incremental: skip files older than last rebuild
        if (lastRebuild) {
          const stat = statSync(fullPath);
          if (stat.mtime < lastRebuild) {
            continue;
          }
        }

        const content = readFileSync(fullPath, "utf-8");
        const { frontmatter, bodyText } = parseFrontmatter(content);
        const contentHash = hashContent(bodyText);

        files.push({
          path: relative(dir, fullPath),
          absolutePath: fullPath,
          content,
          contentHash,
          created: new Date(), // Will be updated by extractCreatedDate
          frontmatter,
          bodyText,
        });
      }
    }
  }

  scan(dir);
  return files;
}

/**
 * Deduplicate files by content hash, keeping most recent
 */
function deduplicateFiles(files: LearningFile[]): {
  uniqueFiles: LearningFile[];
  hashMap: Record<string, string[]>;
} {
  const hashMap: Record<string, string[]> = {};
  const uniqueFiles: LearningFile[] = [];

  // Update created dates first
  for (const file of files) {
    file.created = extractCreatedDate(file);
  }

  // Group by hash
  for (const file of files) {
    if (!hashMap[file.contentHash]) {
      hashMap[file.contentHash] = [];
    }
    hashMap[file.contentHash].push(file.path);
  }

  // For each hash, keep the most recent file
  for (const hash in hashMap) {
    const filesWithHash = files.filter((f) => f.contentHash === hash);
    filesWithHash.sort((a, b) => b.created.getTime() - a.created.getTime());
    uniqueFiles.push(filesWithHash[0]);
  }

  return { uniqueFiles, hashMap };
}

/**
 * Convert LearningFile to MemoryEntry for scoring
 */
function toMemoryEntry(file: LearningFile, frequency: number): MemoryEntry {
  return {
    path: file.path,
    content: file.bodyText,
    created: file.created,
    frequency,
    pinned: file.frontmatter.pinned === true,
    tags: Array.isArray(file.frontmatter.tags)
      ? file.frontmatter.tags
      : undefined,
  };
}

/**
 * Generate consolidated markdown from ranked entries
 */
function generateConsolidated(
  rankedFiles: LearningFile[]
): string {
  const sections: string[] = [];

  sections.push("# Learning View — Consolidated");
  sections.push("");
  sections.push(`Generated: ${new Date().toISOString()}`);
  sections.push(`Entries: ${rankedFiles.length}`);
  sections.push("");
  sections.push("---");
  sections.push("");

  for (const file of rankedFiles) {
    sections.push(`## ${file.frontmatter.title || file.path}`);
    sections.push("");
    sections.push(`**Source:** \`${file.path}\``);
    sections.push(`**Created:** ${file.created.toISOString()}`);
    if (file.frontmatter.category) {
      sections.push(`**Category:** ${file.frontmatter.category}`);
    }
    if (file.frontmatter.confidence) {
      sections.push(`**Confidence:** ${file.frontmatter.confidence}`);
    }
    if (file.frontmatter.pinned) {
      sections.push(`**Pinned:** Yes`);
    }
    sections.push("");
    sections.push(file.bodyText);
    sections.push("");
    sections.push("---");
    sections.push("");
  }

  return sections.join("\n");
}

/**
 * Main rebuild logic
 */
async function rebuild(options: {
  dryRun: boolean;
  tokenCap: number;
}): Promise<void> {
  const PAI_DIR = process.env.PAI_DIR || process.cwd();
  const LEARNING_DIR = join(PAI_DIR, "MEMORY", "LEARNING");
  const VIEW_DIR = join(LEARNING_DIR, ".view");
  const CONSOLIDATED_PATH = join(VIEW_DIR, "consolidated.md");
  const MANIFEST_PATH = join(VIEW_DIR, "manifest.json");

  console.log("Rebuilding learning view...");
  console.log(`PAI_DIR: ${PAI_DIR}`);
  console.log(`Token budget: ${options.tokenCap}`);
  console.log("");

  if (!existsSync(LEARNING_DIR)) {
    console.log("LEARNING directory does not exist. Creating empty view.");
    if (!options.dryRun) {
      mkdirSync(VIEW_DIR, { recursive: true });
      writeFileSync(CONSOLIDATED_PATH, "# Learning View — Empty\n\nNo learning data found.\n");
      writeFileSync(
        MANIFEST_PATH,
        JSON.stringify(
          {
            lastRebuild: new Date().toISOString(),
            totalFiles: 0,
            uniqueEntries: 0,
            deduplicated: 0,
            pinnedCount: 0,
            tokenBudget: options.tokenCap,
            tokensUsed: 0,
            hashes: {},
          } as Manifest,
          null,
          2
        )
      );
    }
    return;
  }

  // Check if manifest exists (for incremental detection in future)
  let existingManifest: Manifest | undefined;
  if (existsSync(MANIFEST_PATH)) {
    existingManifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8")) as Manifest;
    const lastRebuild = new Date(existingManifest.lastRebuild);
    console.log(`Incremental rebuild since: ${lastRebuild.toISOString()}`);
  }

  // Always scan ALL files for accurate counts (optimization: could use lastRebuild in future)
  const files = scanLearningFiles(LEARNING_DIR);
  console.log(`Scanned ${files.length} files`);

  if (files.length === 0) {
    console.log("No files found. Creating empty view.");
    mkdirSync(VIEW_DIR, { recursive: true });
    writeFileSync(CONSOLIDATED_PATH, "# Learning View — Empty\n\nNo learning data found.\n");
    writeFileSync(
      MANIFEST_PATH,
      JSON.stringify(
        {
          lastRebuild: new Date().toISOString(),
          totalFiles: 0,
          uniqueEntries: 0,
          deduplicated: 0,
          pinnedCount: 0,
          tokenBudget: options.tokenCap,
          tokensUsed: 0,
          hashes: {},
        } as Manifest,
        null,
        2
      )
    );
    return;
  }

  // Deduplicate
  const { uniqueFiles, hashMap } = deduplicateFiles(files);
  const deduplicatedCount = files.length - uniqueFiles.length;
  console.log(`Unique entries: ${uniqueFiles.length} (deduplicated ${deduplicatedCount})`);

  // Convert to MemoryEntry and score
  const memoryEntries = uniqueFiles.map((file) => {
    const frequency = hashMap[file.contentHash]?.length || 1;
    return {
      file,
      entry: toMemoryEntry(file, frequency),
    };
  });

  // Rank entries within token budget
  const rankedEntries = rankEntries(
    memoryEntries.map((me) => me.entry),
    [], // No context keywords for initial build
    options.tokenCap
  );

  // Map back to files
  const rankedFiles = rankedEntries.map(
    (entry) => memoryEntries.find((me) => me.entry === entry)!.file
  );

  const pinnedCount = rankedFiles.filter((f) => f.frontmatter.pinned).length;
  const tokensUsed = rankedFiles.reduce((sum, f) => {
    const words = f.bodyText.split(/\s+/).filter((w) => w.length > 0);
    return sum + Math.ceil(words.length * 1.3);
  }, 0);

  console.log(`Ranked entries: ${rankedFiles.length}`);
  console.log(`Pinned entries: ${pinnedCount}`);
  console.log(`Tokens used: ${tokensUsed} / ${options.tokenCap}`);

  if (options.dryRun) {
    console.log("");
    console.log("DRY RUN — Would write:");
    console.log(`  ${CONSOLIDATED_PATH}`);
    console.log(`  ${MANIFEST_PATH}`);
    return;
  }

  // Write consolidated view
  mkdirSync(VIEW_DIR, { recursive: true });
  const consolidated = generateConsolidated(rankedFiles);
  writeFileSync(CONSOLIDATED_PATH, consolidated);

  // Write manifest
  const manifest: Manifest = {
    lastRebuild: new Date().toISOString(),
    totalFiles: files.length,
    uniqueEntries: uniqueFiles.length,
    deduplicated: deduplicatedCount,
    pinnedCount,
    tokenBudget: options.tokenCap,
    tokensUsed,
    hashes: hashMap,
  };
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  console.log("");
  console.log("✅ Rebuild complete");
  console.log(`   Consolidated: ${CONSOLIDATED_PATH}`);
  console.log(`   Manifest: ${MANIFEST_PATH}`);
}

/**
 * CLI entry point
 */
async function main() {
  const { values } = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: false },
      "token-cap": { type: "string", default: "4000" },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log("Usage: bun scripts/rebuild-learning-view.ts [options]");
    console.log("");
    console.log("Options:");
    console.log("  --dry-run         Show what would change without writing");
    console.log("  --token-cap N     Token budget for consolidated view (default: 4000)");
    console.log("  --help            Show this help");
    process.exit(0);
  }

  const tokenCap = parseInt(values["token-cap"] as string, 10);
  if (isNaN(tokenCap) || tokenCap <= 0) {
    console.error("Error: --token-cap must be a positive integer");
    process.exit(1);
  }

  await rebuild({
    dryRun: values["dry-run"] as boolean,
    tokenCap,
  });
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
}

export { rebuild, scanLearningFiles, deduplicateFiles, generateConsolidated };
