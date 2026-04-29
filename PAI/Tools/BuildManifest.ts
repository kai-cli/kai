#!/usr/bin/env bun
/**
 * BuildManifest.ts — Generate manifest.json with counts, inventories, and metadata.
 *
 * Produces a deterministic manifest.json consumed by BuildDocs.ts and verify-release.sh.
 * Separate from GenerateManifest.ts (which generates SHA checksums for upgrade diffs).
 *
 * Usage:
 *   bun PAI/Tools/BuildManifest.ts
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join, basename } from "path";
import { getPaiDir, paiPath } from "../../hooks/lib/paths";

const PAI_DIR = getPaiDir();

interface ManifestData {
  version: string;
  productName: string;
  algorithmVersion: string;
  counts: {
    skills: number;
    hooks: number;
    agents: number;
  };
  hookInventory: string[];
  skillInventory: string[];
  agentInventory: string[];
}

function stripJsoncComments(text: string): string {
  let result = "";
  let i = 0;
  let inString = false;
  let escape = false;

  while (i < text.length) {
    const ch = text[i];

    if (escape) {
      result += ch;
      escape = false;
      i++;
      continue;
    }

    if (inString) {
      if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      result += ch;
      i++;
      continue;
    }

    // Outside string
    if (ch === '"') {
      inString = true;
      result += ch;
      i++;
    } else if (ch === "/" && text[i + 1] === "/") {
      // Line comment — skip to end of line
      while (i < text.length && text[i] !== "\n") i++;
    } else if (ch === "/" && text[i + 1] === "*") {
      // Block comment — skip to */
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
    } else {
      result += ch;
      i++;
    }
  }

  // Strip trailing commas before } or ]
  return result.replace(/,(\s*[}\]])/g, "$1");
}

function readJsonc(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf-8");
  const stripped = stripJsoncComments(raw);
  try {
    return JSON.parse(stripped);
  } catch {
    return {};
  }
}

function getAlgorithmVersion(): string {
  const latestPath = paiPath("PAI/Algorithm", "LATEST");
  if (!existsSync(latestPath)) return "unknown";
  return readFileSync(latestPath, "utf-8").trim();
}

function listFiles(dir: string, pattern: RegExp, maxDepth: number): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  function walk(currentDir: string, depth: number) {
    if (depth > maxDepth) return;
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory() && depth < maxDepth) {
        walk(fullPath, depth + 1);
      } else if (entry.isFile() && pattern.test(entry.name)) {
        results.push(entry.name.replace(pattern, "$1"));
      }
    }
  }

  walk(dir, 0);
  return results.sort();
}

function buildManifest(): ManifestData {
  const prefs = readJsonc(paiPath("config/preferences.jsonc"));
  const pai = (prefs.pai as Record<string, unknown>) ?? {};

  const version = typeof pai.version === "string" ? pai.version : "unknown";
  const productName = typeof pai.productName === "string" ? pai.productName : "PAI";
  const algorithmVersion = getAlgorithmVersion();

  const skillsDir = paiPath("skills");
  const hooksDir = paiPath("hooks");
  const agentsDir = paiPath("agents");

  // Recursive walk — counts every directory containing SKILL.md at any depth.
  // Matches: find skills/ -name 'SKILL.md' | wc -l
  const skillInventory: string[] = [];
  if (existsSync(skillsDir)) {
    function walkSkills(dir: string, rel: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const fullPath = join(dir, entry.name);
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        if (existsSync(join(fullPath, "SKILL.md"))) {
          skillInventory.push(relPath);
        }
        walkSkills(fullPath, relPath);
      }
    }
    walkSkills(skillsDir, "");
  }
  skillInventory.sort();

  const hookInventory = listFiles(hooksDir, /^(.+\.hook)\.ts$/, 0);
  const agentInventory: string[] = [];
  if (existsSync(agentsDir)) {
    for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        agentInventory.push(entry.name.replace(/\.md$/, ""));
      }
    }
  }
  agentInventory.sort();

  return {
    version,
    productName,
    algorithmVersion,
    counts: {
      skills: skillInventory.length,
      hooks: hookInventory.length,
      agents: agentInventory.length,
    },
    hookInventory,
    skillInventory,
    agentInventory,
  };
}

if (import.meta.main) {
  const manifest = buildManifest();
  const outPath = paiPath("manifest.json");
  const json = JSON.stringify(manifest, null, 2) + "\n";

  if (existsSync(outPath) && readFileSync(outPath, "utf-8") === json) {
    console.log("ℹ manifest.json already current");
  } else {
    writeFileSync(outPath, json);
    console.log("✅ Built manifest.json");
    console.log(`   ${manifest.counts.skills} skills, ${manifest.counts.hooks} hooks, ${manifest.counts.agents} agents`);
    console.log(`   Algorithm: ${manifest.algorithmVersion}`);
    console.log(`   Product: ${manifest.productName} ${manifest.version}`);
  }
}

export { buildManifest, type ManifestData };
