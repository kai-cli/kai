#!/usr/bin/env bun
/**
 * kai-upgrade — Pull latest KAI version and rebuild.
 *
 * Usage:
 *   bun scripts/kai-upgrade.ts          # Pull + rebuild
 *   bun scripts/kai-upgrade.ts --check  # Check if update available (no action)
 */

import { execSync } from "child_process";
import { join } from "path";
import { existsSync, readFileSync } from "fs";

const PAI_DIR = process.env.PAI_DIR ?? join(process.env.HOME!, ".claude");
const isCheckOnly = process.argv.includes("--check");

console.log("\n  → Checking for updates...");

let upstream: string;
try {
  upstream = execSync("git rev-parse --abbrev-ref @{upstream}", { cwd: PAI_DIR, encoding: "utf-8" }).trim();
} catch {
  console.error("  ✗ No upstream branch configured. Run: git branch --set-upstream-to=origin/main");
  process.exit(1);
}
const [remoteName, ...branchParts] = upstream.split("/");
const branchName = branchParts.join("/");

try {
  execSync(`git fetch ${remoteName}`, { cwd: PAI_DIR, stdio: "pipe" });
} catch {
  console.error(`  ✗ Failed to fetch from ${remoteName}. Check network connectivity.`);
  process.exit(1);
}

const local = execSync("git rev-parse HEAD", { cwd: PAI_DIR, encoding: "utf-8" }).trim();
const remote = execSync(`git rev-parse ${upstream}`, { cwd: PAI_DIR, encoding: "utf-8" }).trim();

if (local === remote) {
  console.log("  ✓ Already up to date.\n");
  process.exit(0);
}

const commitCount = execSync(
  `git rev-list --count ${local}..${upstream}`,
  { cwd: PAI_DIR, encoding: "utf-8" }
).trim();
console.log(`  → ${commitCount} new commit(s) available on ${upstream}`);

if (isCheckOnly) {
  execSync(`git --no-pager log --oneline -5 ${local}..${upstream}`, { cwd: PAI_DIR, stdio: "inherit" });
  console.log();
  process.exit(0);
}

const status = execSync("git status --porcelain", { cwd: PAI_DIR, encoding: "utf-8" }).trim();
if (status) {
  console.log("  ⚠️  Local modifications detected:");
  console.log(status.split("\n").map(l => `    ${l}`).join("\n"));
  console.log("\n  Stash or commit before upgrading. Aborting.\n");
  process.exit(1);
}

console.log(`  → Pulling from ${upstream}...`);
try {
  execSync(`git pull ${remoteName} ${branchName} --ff-only`, { cwd: PAI_DIR, stdio: "pipe" });
} catch {
  console.error("  ✗ Pull failed (non-fast-forward). Resolve manually with git pull.");
  process.exit(1);
}

const rebuildSteps = [
  { label: "Installing dependencies", cmd: "bun install --silent", cwd: PAI_DIR },
  { label: "Rebuilding settings.json", cmd: `bun ${join(PAI_DIR, "hooks", "handlers", "BuildSettings.ts")}` },
  { label: "Rebuilding CLAUDE.md", cmd: `bun ${join(PAI_DIR, "hooks", "handlers", "BuildCLAUDE.ts")}` },
];

let rebuildFailed = false;
for (const step of rebuildSteps) {
  console.log(`  → ${step.label}...`);
  try {
    execSync(step.cmd, { stdio: "pipe", cwd: step.cwd });
  } catch (e) {
    console.error(`  ✗ ${step.label} failed: ${e instanceof Error ? e.message : e}`);
    rebuildFailed = true;
  }
}

if (rebuildFailed) {
  console.error("\n  ⚠️  Pull succeeded but rebuild had errors.");
  console.error("  Run `bun ~/.claude/scripts/kai-reset.ts` to retry.\n");
  process.exit(1);
}

const versionPath = join(PAI_DIR, "VERSION");
let version = "unknown";
if (existsSync(versionPath)) {
  version = readFileSync(versionPath, "utf-8").trim();
} else {
  try {
    version = execSync("git describe --tags --always", { cwd: PAI_DIR, encoding: "utf-8" }).trim();
  } catch { /* leave as unknown */ }
}

console.log(`\n  ✓ Upgraded to v${version}`);
console.log("  Restart your Claude Code session to use the new version.\n");
