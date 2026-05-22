#!/usr/bin/env bun
/**
 * kai-doctor — Verify installation health and report issues.
 *
 * Usage:
 *   bun scripts/kai-doctor.ts          # Full diagnostic
 *   bun scripts/kai-doctor.ts --json   # Machine-readable output
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { validateSettingsFile } from "./settings-validate";

const PAI_DIR = process.env.PAI_DIR ?? join(process.env.HOME!, ".claude");
const isJson = process.argv.includes("--json");

interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}

const checks: Check[] = [];

// 1. Core files exist
const coreFiles = [
  "settings.json",
  "CLAUDE.md",
  "config/identity.jsonc",
  "config/preferences.jsonc",
  "config/hooks.jsonc",
  "hooks/lib/run-hook.sh",
  "package.json",
];

for (const f of coreFiles) {
  const path = join(PAI_DIR, f);
  checks.push({ name: f, pass: existsSync(path) });
}

// 2. Dependencies installed
checks.push({
  name: "node_modules",
  pass: existsSync(join(PAI_DIR, "node_modules")),
  detail: existsSync(join(PAI_DIR, "node_modules")) ? undefined : "Run: bun install",
});

// 3. settings.json valid against schema
const settingsPath = join(PAI_DIR, "settings.json");
if (existsSync(settingsPath)) {
  const result = validateSettingsFile(settingsPath);
  checks.push({
    name: "settings.json schema",
    pass: result.valid,
    detail: result.valid ? undefined : result.errors.slice(0, 3).join("; "),
  });
} else {
  checks.push({ name: "settings.json schema", pass: false, detail: "File missing" });
}

// 4. Claude Code CLI
let claudeVersion = "";
try {
  claudeVersion = execSync("claude --version 2>/dev/null", { encoding: "utf-8" }).trim();
  checks.push({ name: "Claude Code CLI", pass: true, detail: claudeVersion });
} catch {
  checks.push({ name: "Claude Code CLI", pass: false, detail: "Not found — install: npm i -g @anthropic-ai/claude-code" });
}

// 5. Git status
try {
  execSync("git rev-parse HEAD", { cwd: PAI_DIR, stdio: "pipe" });
  checks.push({ name: "git repository", pass: true });
} catch {
  checks.push({ name: "git repository", pass: false, detail: "Not a git repo" });
}

// 6. API keys
const requiredKeys = ["ANTHROPIC_API_KEY"];
const optionalKeys = ["GITHUB_TOKEN", "OPENAI_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY"];
const setRequired = requiredKeys.filter(k => !!process.env[k]).length;
const setOptional = optionalKeys.filter(k => !!process.env[k]).length;
checks.push({
  name: "API keys",
  pass: setRequired === requiredKeys.length,
  detail: `${setRequired}/${requiredKeys.length} required, ${setOptional}/${optionalKeys.length} optional`,
});

// 7. MCP servers configured
try {
  const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
  const mcpCount = Object.keys(settings.mcpServers ?? {}).length;
  checks.push({ name: "MCP servers", pass: true, detail: `${mcpCount} configured` });
} catch {
  checks.push({ name: "MCP servers", pass: true, detail: "0 configured" });
}

// 8. Skills lock
const lockPath = join(PAI_DIR, "skills-lock.json");
if (existsSync(lockPath)) {
  checks.push({ name: "skills-lock.json", pass: true });
} else {
  checks.push({ name: "skills-lock.json", pass: false, detail: "Missing — run: bun scripts/skills-lock.ts generate" });
}

// 9. MEMORY directories
const memDirs = ["STATE", "KNOWLEDGE", "WISDOM", "LEARNING", "STAGING"];
const existingMem = memDirs.filter(d => existsSync(join(PAI_DIR, "MEMORY", d)));
checks.push({
  name: "MEMORY directories",
  pass: existingMem.length === memDirs.length,
  detail: `${existingMem.length}/${memDirs.length}`,
});

// 10. Hooks count
try {
  const hookFiles = readdirSync(join(PAI_DIR, "hooks")).filter(f => f.endsWith(".hook.ts"));
  checks.push({ name: "hooks", pass: hookFiles.length > 0, detail: `${hookFiles.length} registered` });
} catch {
  checks.push({ name: "hooks", pass: false, detail: "hooks/ not found" });
}

// Output
if (isJson) {
  const passed = checks.filter(c => c.pass).length;
  console.log(JSON.stringify({ passed, total: checks.length, checks }, null, 2));
  process.exit(checks.every(c => c.pass) ? 0 : 1);
}

console.log("\n  KAI Doctor — Installation Health Check\n");
console.log("  " + "─".repeat(50));

let allPass = true;
for (const c of checks) {
  const icon = c.pass ? "✅" : "❌";
  const detail = c.detail ? `  (${c.detail})` : "";
  console.log(`  ${icon} ${c.name}${detail}`);
  if (!c.pass) allPass = false;
}

console.log("  " + "─".repeat(50));
const passed = checks.filter(c => c.pass).length;
if (allPass) {
  console.log(`\n  ✓ All ${checks.length} checks pass. Installation is healthy.\n`);
} else {
  console.log(`\n  ${passed}/${checks.length} checks pass. Fix issues above.\n`);
}

process.exit(allPass ? 0 : 1);
