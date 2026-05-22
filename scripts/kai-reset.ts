#!/usr/bin/env bun
/**
 * kai-reset — Rebuild configuration from source files.
 * With --hard, also clears runtime state for a fresh start.
 *
 * Usage:
 *   bun scripts/kai-reset.ts          # Soft: rebuild generated files
 *   bun scripts/kai-reset.ts --hard   # Hard: also clear runtime state
 *   bun scripts/kai-reset.ts --dry-run # Show what would be done
 */

import { execSync } from "child_process";
import { rmSync, existsSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";

const PAI_DIR = process.env.PAI_DIR ?? join(process.env.HOME!, ".claude");
if (!existsSync(join(PAI_DIR, "hooks"))) {
  console.error("  ✗ PAI_DIR does not look like a KAI installation:", PAI_DIR);
  process.exit(1);
}

const isHard = process.argv.includes("--hard");
const isDryRun = process.argv.includes("--dry-run");

interface SoftAction { label: string; cmd: string; cwd?: string }
interface HardAction { label: string; path: string }

const SOFT_ACTIONS: SoftAction[] = [
  { label: "Rebuild settings.json", cmd: `bun ${join(PAI_DIR, "hooks", "handlers", "BuildSettings.ts")}` },
  { label: "Rebuild CLAUDE.md", cmd: `bun ${join(PAI_DIR, "hooks", "handlers", "BuildCLAUDE.ts")}` },
  { label: "Reinstall dependencies", cmd: "bun install --silent", cwd: PAI_DIR },
];

const HARD_ACTIONS: HardAction[] = [
  { label: "Clear session state", path: join(PAI_DIR, "MEMORY", "STATE") },
  { label: "Clear work PRDs", path: join(PAI_DIR, "MEMORY", "WORK") },
  { label: "Clear staging", path: join(PAI_DIR, "MEMORY", "STAGING") },
  { label: "Clear cache", path: join(PAI_DIR, "cache") },
  { label: "Clear sessions", path: join(PAI_DIR, "sessions") },
  { label: "Clear tasks", path: join(PAI_DIR, "tasks") },
  { label: "Remove onboarding flag", path: join(PAI_DIR, "MEMORY", "STATE", ".onboarding-complete") },
];

console.log(`\n  KAI Reset${isHard ? " (--hard)" : ""}${isDryRun ? " [dry-run]" : ""}\n`);

for (const action of SOFT_ACTIONS) {
  if (isDryRun) {
    console.log(`  [dry-run] ${action.label}`);
    continue;
  }
  console.log(`  → ${action.label}...`);
  try {
    execSync(action.cmd, { stdio: "pipe", cwd: action.cwd });
    console.log(`    ✓ done`);
  } catch (e) {
    console.error(`    ✗ failed: ${e instanceof Error ? e.message : e}`);
  }
}

if (isHard) {
  const existing = HARD_ACTIONS.filter(a => existsSync(a.path));
  const counts = existing
    .map(a => {
      if (a.path.endsWith(".onboarding-complete")) return null;
      const stat = statSync(a.path);
      if (stat.isDirectory()) {
        const entries = readdirSync(a.path).filter(f => !f.startsWith(".")).length;
        return `${entries} in ${basename(a.path)}`;
      }
      return basename(a.path);
    })
    .filter(Boolean);

  if (!isDryRun && counts.length > 0) {
    console.log(`\n  ⚠️  --hard will delete: ${counts.join(", ")}`);
    console.log("  Config files, MEMORY/KNOWLEDGE, and WISDOM are preserved.\n");
  }

  for (const action of HARD_ACTIONS) {
    if (!action.path.startsWith(PAI_DIR)) {
      console.error(`  ✗ Refusing to delete path outside PAI_DIR: ${action.path}`);
      continue;
    }
    if (!existsSync(action.path)) continue;
    if (isDryRun) {
      console.log(`  [dry-run] ${action.label}: rm ${action.path}`);
      continue;
    }
    rmSync(action.path, { recursive: true, force: true });
    console.log(`  → ${action.label}`);
  }
}

console.log(`\n  ✓ Reset complete.${isHard ? " Start a new session to re-initialize." : ""}\n`);
