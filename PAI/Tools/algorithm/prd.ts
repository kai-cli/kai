/**
 * algorithm/prd.ts - PRD creation, discovery, and management
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "fs";
import { resolve, basename, join } from "path";
import { generatePRDTemplate } from "../../../hooks/lib/prd-template";
import { readPRD, countCriteria } from "./state";
import type { PRDFrontmatter, CriteriaInfo } from "./types";

const HOME = process.env.HOME || "~";
const BASE_DIR = process.env.PAI_DIR || join(HOME, ".claude");
const PROJECTS_DIR = process.env.PROJECTS_DIR || join(HOME, "Projects");

// ─── PRD Creation ───────────────────────────────────────────────────────────

export function createNewPRD(title: string, effortLevel: string = "Standard", outputDir?: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .substring(0, 40)
    .replace(/-$/, "") || "task";

  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const filename = `PRD-${y}${m}${d}-${slug}.md`;

  // Determine output directory
  let targetDir: string;
  if (outputDir) {
    targetDir = resolve(outputDir);
  } else {
    // Default: create in MEMORY/WORK session directory
    const sessionSlug = `${y}${m}${d}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}_${slug}`;
    targetDir = join(BASE_DIR, "MEMORY", "WORK", sessionSlug);
  }
  mkdirSync(targetDir, { recursive: true });

  // Use shared PRD v2.0 template
  const prdContent = generatePRDTemplate({
    title,
    slug,
    effortLevel,
    mode: "interactive",
  });

  const fullPath = join(targetDir, filename);
  writeFileSync(fullPath, prdContent, "utf-8");
  return fullPath;
}

// ─── PRD Discovery ──────────────────────────────────────────────────────────

export function findAllPRDs(): string[] {
  const files: string[] = [];

  // 1. Scan MEMORY/WORK directory (flat PRD.md + legacy task-level PRDs)
  const workDir = join(BASE_DIR, "MEMORY", "WORK");
  if (existsSync(workDir)) {
    try {
      for (const session of readdirSync(workDir)) {
        const sessionPath = join(workDir, session);
        try {
          // Flat format: PRD.md at root (new)
          const flatPrd = join(sessionPath, "PRD.md");
          if (existsSync(flatPrd)) {
            files.push(flatPrd);
          }
          // Session-level PRD-*.md (transitional)
          for (const f of readdirSync(sessionPath)) {
            if (f.startsWith("PRD-") && f.endsWith(".md")) {
              files.push(join(sessionPath, f));
            }
          }
          // Legacy: Task-level PRDs (WORK/{session}/tasks/{task}/PRD-*.md)
          const tasksDir = join(sessionPath, "tasks");
          if (existsSync(tasksDir)) {
            for (const task of readdirSync(tasksDir)) {
              if (task === "current") continue; // skip symlink
              const taskPath = join(tasksDir, task);
              try {
                for (const f of readdirSync(taskPath)) {
                  if (f.startsWith("PRD-") && f.endsWith(".md")) {
                    files.push(join(taskPath, f));
                  }
                }
              } catch { /* not a directory */ }
            }
          }
        } catch { /* not a directory */ }
      }
    } catch {}
  }

  // 2. Scan project .prd/ directories
  if (existsSync(PROJECTS_DIR)) {
    try {
      for (const project of readdirSync(PROJECTS_DIR)) {
        const prdDir = join(PROJECTS_DIR, project, ".prd");
        if (existsSync(prdDir)) {
          try {
            for (const f of readdirSync(prdDir)) {
              if (f.startsWith("PRD-") && f.endsWith(".md")) {
                files.push(join(prdDir, f));
              }
            }
          } catch {}
        }
      }
    } catch {}
  }

  return files;
}

// ─── PRD Path Resolution ────────────────────────────────────────────────────

export function resolvePRDPath(input: string): string {
  // If it's already a path, use it
  if (input.includes("/") || input.endsWith(".md")) {
    return resolve(input);
  }

  // Search all known PRD locations
  const allPRDs = findAllPRDs();
  const matches = allPRDs.filter(p => basename(p).includes(input) || p.includes(input));

  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    console.error(`Ambiguous PRD reference "${input}". Matches:`);
    for (const m of matches) console.error(`  ${m}`);
    process.exit(1);
  }
  console.error(`PRD not found: ${input}`);
  process.exit(1);
}

// ─── CHANGELOG Append ────────────────────────────────────────────────────────

export function appendPRDChangelog(
  prdPath: string,
  iteration: number,
  preCriteria: CriteriaInfo,
  postCriteria: CriteriaInfo,
  elapsedMs: number,
): void {
  try {
    let content = readFileSync(prdPath, "utf-8");
    const changelogMarker = "## CHANGELOG";
    const changelogIdx = content.indexOf(changelogMarker);
    if (changelogIdx === -1) return; // No CHANGELOG section

    const gained = postCriteria.passing - preCriteria.passing;
    const lost = Math.max(0, preCriteria.passing - postCriteria.passing + gained); // regressions
    const regressions = preCriteria.criteria
      .filter(c => c.status === "passing")
      .filter(c => {
        const post = postCriteria.criteria.find(p => p.id === c.id);
        return post && post.status === "failing";
      })
      .map(c => c.id);

    const stillFailing = postCriteria.failingIds;
    const elapsedSec = Math.round(elapsedMs / 1000);
    const now = new Date().toISOString().split("T")[0];

    const entry = `
### Iteration ${iteration} — ${now}
- **Phase reached:** VERIFY
- **Criteria delta:** ${preCriteria.passing}/${preCriteria.total} → ${postCriteria.passing}/${postCriteria.total} (${gained >= 0 ? "+" : ""}${gained})
- **Duration:** ${elapsedSec}s
- **Still failing:** ${stillFailing.length > 0 ? stillFailing.join(", ") : "None"}
- **Regressions:** ${regressions.length > 0 ? regressions.join(", ") : "None"}
`;

    // Insert after the CHANGELOG header line (and its description line if present)
    const afterHeader = content.indexOf("\n", changelogIdx + changelogMarker.length);
    if (afterHeader === -1) return;

    // Skip the description line if it starts with underscore (template placeholder)
    let insertPoint = afterHeader + 1;
    const nextLine = content.substring(insertPoint, content.indexOf("\n", insertPoint));
    if (nextLine.trim().startsWith("_")) {
      // Replace placeholder with first entry
      const endOfPlaceholder = content.indexOf("\n", insertPoint);
      content = content.substring(0, insertPoint) + entry + content.substring(endOfPlaceholder + 1);
    } else {
      // Append after header
      content = content.substring(0, insertPoint) + entry + content.substring(insertPoint);
    }

    writeFileSync(prdPath, content, "utf-8");
  } catch {
    // Silent — CHANGELOG is best-effort
  }
}

// ─── Plateau Detection ──────────────────────────────────────────────────────

export function detectPlateau(loopHistory: Array<{ criteriaPassing: number }>, window: number = 3): boolean {
  if (loopHistory.length < window) return false;
  const recent = loopHistory.slice(-window);
  const baseline = recent[0].criteriaPassing;
  return recent.every(h => h.criteriaPassing === baseline);
}

// ─── Status Display ─────────────────────────────────────────────────────────

export function showStatus(specificPath?: string): void {
  if (specificPath) {
    const absPath = resolve(specificPath);
    const { frontmatter, content } = readPRD(absPath);
    const criteria = countCriteria(content);
    printPRDStatus(absPath, frontmatter, criteria);
    return;
  }

  const files = findAllPRDs();
  if (files.length === 0) {
    console.log("No PRDs found in MEMORY/WORK/ or project .prd/ directories.");
    return;
  }

  console.log(`\x1b[36mTHE ALGORITHM — PRD Status\x1b[0m\n`);

  for (const file of files) {
    try {
      const { frontmatter, content } = readPRD(file);
      const criteria = countCriteria(content);
      printPRDStatus(file, frontmatter, criteria);
    } catch {
      // Skip invalid files
    }
  }
}

export function printPRDStatus(path: string, fm: PRDFrontmatter, criteria: CriteriaInfo): void {
  const statusIcon =
    fm.status === "COMPLETE" ? "\x1b[32m✓\x1b[0m" :
    fm.status === "BLOCKED" ? "\x1b[33m⚠\x1b[0m" :
    fm.loopStatus === "running" ? "\x1b[36m⟳\x1b[0m" :
    fm.loopStatus === "paused" ? "\x1b[33m⏸\x1b[0m" :
    fm.loopStatus === "failed" ? "\x1b[31m✗\x1b[0m" :
    "\x1b[90m○\x1b[0m";

  const progressBar = buildProgressBar(criteria.passing, criteria.total);

  console.log(`${statusIcon} ${fm.id}`);
  console.log(`  Status: ${fm.status} | Loop: ${fm.loopStatus || "idle"} | Iteration: ${fm.iteration}/${fm.maxIterations}`);
  console.log(`  Criteria: ${progressBar} ${criteria.passing}/${criteria.total}`);
  console.log(`  Path: ${path}`);
  console.log("");
}

export function buildProgressBar(passing: number, total: number): string {
  if (total === 0) return "[\x1b[90m----------\x1b[0m]";
  const width = 10;
  const filled = Math.round((passing / total) * width);
  const empty = width - filled;
  return `[\x1b[32m${"█".repeat(filled)}\x1b[90m${"░".repeat(empty)}\x1b[0m]`;
}
