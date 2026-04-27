#!/usr/bin/env bun
/**
 * BuildDocs.ts — Rewrite marker regions in docs from manifest.json.
 *
 * Walks configured files looking for marker pairs. Two syntaxes:
 *   .md:  <!-- KAI:key:begin -->value<!-- KAI:key:end -->
 *   .ts:  // KAI:key:begin\nvalue\n// KAI:key:end
 *
 * Modes:
 *   bun PAI/Tools/BuildDocs.ts          — write mode (update files)
 *   bun PAI/Tools/BuildDocs.ts --check  — read-only, exit 1 if stale
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getPaiDir, paiPath } from "../../hooks/lib/paths";

const PAI_DIR = getPaiDir();
const MANIFEST_PATH = paiPath("manifest.json");

interface Manifest {
  version: string;
  productName: string;
  algorithmVersion: string;
  counts: { skills: number; hooks: number; agents: number };
  hookInventory: string[];
  skillInventory: string[];
  agentInventory: string[];
}

// Files to process — relative to PAI_DIR
const TARGET_FILES = [
  "README.md",
  "CHANGELOG.md",
  "docs/QUICKSTART.md",
  "docs/WHATS-DIFFERENT.md",
  "docs/releases/README.md",
  "scripts/deploy.ts",
];

function loadManifest(): Manifest {
  if (!existsSync(MANIFEST_PATH)) {
    console.error("❌ manifest.json not found — run BuildManifest.ts first");
    process.exit(1);
  }
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
}

function getMarkerValue(key: string, manifest: Manifest): string {
  switch (key) {
    case "counts:skills":
      return String(manifest.counts.skills);
    case "counts:hooks":
      return String(manifest.counts.hooks);
    case "counts:agents":
      return String(manifest.counts.agents);
    case "version":
      return manifest.version;
    case "algorithm-version":
      return manifest.algorithmVersion;
    case "product-name":
      return manifest.productName;
    default:
      console.error(`⚠ Unknown marker key: ${key}`);
      return `UNKNOWN:${key}`;
  }
}

interface MarkerResult {
  file: string;
  stale: string[];
  updated: number;
}

function processFile(
  filePath: string,
  manifest: Manifest,
  checkOnly: boolean
): MarkerResult {
  const result: MarkerResult = { file: filePath, stale: [], updated: 0 };
  if (!existsSync(filePath)) return result;

  let content = readFileSync(filePath, "utf-8");
  let changed = false;

  // HTML comment markers: <!-- KAI:key:begin -->value<!-- KAI:key:end -->
  const mdRegex =
    /<!-- KAI:([a-z_-]+(?::[a-z_-]+)*):begin -->([\s\S]*?)<!-- KAI:\1:end -->/g;
  content = content.replace(mdRegex, (_match, key: string, oldValue: string) => {
    const newValue = getMarkerValue(key, manifest);
    if (oldValue !== newValue) {
      result.stale.push(`${key}: "${oldValue.trim()}" → "${newValue}"`);
      if (!checkOnly) {
        changed = true;
        result.updated++;
      }
    }
    return checkOnly
      ? _match
      : `<!-- KAI:${key}:begin -->${newValue}<!-- KAI:${key}:end -->`;
  });

  // TS comment markers: // KAI:key:begin\nvalue\n// KAI:key:end
  const tsRegex =
    /\/\/ KAI:([a-z_-]+(?::[a-z_-]+)*):begin\n([\s\S]*?)\/\/ KAI:\1:end/g;
  content = content.replace(tsRegex, (_match, key: string, oldValue: string) => {
    const newValue = getMarkerValue(key, manifest);
    const oldTrimmed = oldValue.trim();
    if (oldTrimmed !== newValue) {
      result.stale.push(`${key}: "${oldTrimmed}" → "${newValue}"`);
      if (!checkOnly) {
        changed = true;
        result.updated++;
      }
    }
    return checkOnly
      ? _match
      : `// KAI:${key}:begin\n${newValue}\n// KAI:${key}:end`;
  });

  if (changed && !checkOnly) {
    writeFileSync(filePath, content);
  }

  return result;
}

if (import.meta.main) {
  const checkOnly = process.argv.includes("--check");
  const manifest = loadManifest();

  let totalStale = 0;
  let totalUpdated = 0;

  for (const relPath of TARGET_FILES) {
    const fullPath = paiPath(relPath);
    const result = processFile(fullPath, manifest, checkOnly);

    if (result.stale.length > 0) {
      totalStale += result.stale.length;
      if (checkOnly) {
        console.log(`❌ ${relPath}:`);
      } else {
        console.log(`✏️  ${relPath}:`);
      }
      for (const s of result.stale) {
        console.log(`   ${s}`);
      }
      totalUpdated += result.updated;
    }
  }

  if (checkOnly) {
    if (totalStale > 0) {
      console.log(`\n❌ ${totalStale} stale marker region(s) — run: bun PAI/Tools/BuildDocs.ts`);
      process.exit(1);
    } else {
      console.log("✅ All marker regions are fresh");
      process.exit(0);
    }
  } else {
    if (totalUpdated > 0) {
      console.log(`\n✅ Updated ${totalUpdated} marker region(s)`);
    } else {
      console.log("ℹ All marker regions already current");
    }
  }
}
