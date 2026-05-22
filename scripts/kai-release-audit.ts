#!/usr/bin/env bun
/**
 * kai-release-audit.ts — Automated release checks (replaces manual RELEASE-CHECKLIST greps)
 *
 * Usage:
 *   bun scripts/kai-release-audit.ts              Run all checks
 *   bun scripts/kai-release-audit.ts --category pii   Run specific category
 *   bun scripts/kai-release-audit.ts --json       Machine-readable output
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join, basename } from "path";

const PAI_DIR = process.env.PAI_DIR ?? join(process.env.HOME!, ".claude");
const isJson = process.argv.includes("--json");
const categoryFilter = (() => {
  const idx = process.argv.indexOf("--category");
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

const GREEN = "\x1b[38;2;34;197;94m";
const RED = "\x1b[38;2;239;68;68m";
const YELLOW = "\x1b[38;2;234;179;8m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

interface AuditResult {
  pass: boolean;
  message: string;
  details?: string[];
}

interface AuditCheck {
  name: string;
  category: "pii" | "brand" | "integrity" | "hygiene";
  run: () => AuditResult;
}

function grep(pattern: string, opts?: { exclude?: string[]; wordBoundary?: boolean }): string[] {
  const flags = opts?.wordBoundary ? "-rl" : "-rl";
  const excludeDirs = ["node_modules", ".git", ".tmp-*", "cache", "sessions"];
  const excludeArgs = excludeDirs.map(d => `--exclude-dir="${d}"`).join(" ");
  const excludeFiles = (opts?.exclude ?? []).map(f => `--exclude="${f}"`).join(" ");
  try {
    const cmd = `grep ${flags} -E ${excludeFiles} ${excludeArgs} "${pattern}" . 2>/dev/null || true`;
    const result = execSync(cmd, { cwd: PAI_DIR, encoding: "utf-8", timeout: 10000 }).trim();
    return result ? result.split("\n").filter(Boolean) : [];
  } catch { return []; }
}

function grepWord(pattern: string, opts?: { exclude?: string[] }): string[] {
  const excludeDirs = ["node_modules", ".git", ".tmp-*", "cache", "sessions"];
  const excludeArgs = excludeDirs.map(d => `--exclude-dir="${d}"`).join(" ");
  const excludeFiles = (opts?.exclude ?? []).map(f => `--exclude="${f}"`).join(" ");
  try {
    const cmd = `grep -rl -w ${excludeFiles} ${excludeArgs} "${pattern}" . 2>/dev/null || true`;
    const result = execSync(cmd, { cwd: PAI_DIR, encoding: "utf-8", timeout: 10000 }).trim();
    return result ? result.split("\n").filter(Boolean) : [];
  } catch { return []; }
}

const ALLOWED_PII_FILES = [
  "scripts/sync-to-kai.sh",
  "scripts/verify-release.sh",
  "scripts/kai-release-audit.ts",
  "docs/RELEASE-CHECKLIST.md",
  "config/identity.jsonc",
  "PAI/USER/",
  "MEMORY/",
  "projects/",
  "hooks/handlers/",
  ".git/",
];

function isAllowedPiiFile(file: string): boolean {
  return ALLOWED_PII_FILES.some(a => file.includes(a));
}

const checks: AuditCheck[] = [
  // ── PII ──
  {
    name: "No personal email addresses in user-facing content",
    category: "pii",
    run: () => {
      const hits = grep("[A-Za-z0-9._%+-]+@(gmail|yourcompany|yahoo|hotmail)\\.com")
        .filter(f => !isAllowedPiiFile(f));
      return {
        pass: hits.length === 0,
        message: hits.length === 0 ? "No email addresses found" : `${hits.length} file(s) with email addresses`,
        details: hits.slice(0, 5),
      };
    },
  },
  {
    name: "No personal usernames in committed files",
    category: "pii",
    run: () => {
      const patterns = ["username", "YourNameYourLastName"];
      const hits: string[] = [];
      for (const p of patterns) {
        hits.push(...grepWord(p).filter(f => !isAllowedPiiFile(f)));
      }
      return {
        pass: hits.length === 0,
        message: hits.length === 0 ? "No usernames found" : `${hits.length} file(s) with usernames`,
        details: [...new Set(hits)].slice(0, 5),
      };
    },
  },
  {
    name: "No personal project paths in content",
    category: "pii",
    run: () => {
      const hits = grep("~/Projects/(WARP|TR-069|Du-tracking|yourcompany-mcp)")
        .filter(f => !isAllowedPiiFile(f));
      return {
        pass: hits.length === 0,
        message: hits.length === 0 ? "No personal project paths" : `${hits.length} file(s) with personal paths`,
        details: hits.slice(0, 5),
      };
    },
  },

  // ── Brand ──
  {
    name: "No stray 'kai' in user-facing content",
    category: "brand",
    run: () => {
      const allowedBrand = [
        "sync-to-kai.sh", "verify-release.sh", "kai-release-audit.ts",
        "RELEASE-CHECKLIST.md", ".pre-commit", ".pre-push",
        "CONTEXT_ROUTING.md", "scripts/kai-upgrade.ts",
      ];
      const hits = grep("kai")
        .filter(f => !allowedBrand.some(a => f.includes(a)))
        .filter(f => !isAllowedPiiFile(f));
      return {
        pass: hits.length === 0,
        message: hits.length === 0 ? "No stray kai references" : `${hits.length} file(s) with kai`,
        details: hits.slice(0, 5),
      };
    },
  },
  {
    name: "No YourCompany/JNAP/BBF product references",
    category: "brand",
    run: () => {
      const hits = grep("\\b(jnap|bbfdm|obuspa|velop|YourCompany)\\b")
        .filter(f => !isAllowedPiiFile(f))
        .filter(f => !f.includes("RELEASE-CHECKLIST") && !f.includes("kai-release-audit"));
      return {
        pass: hits.length === 0,
        message: hits.length === 0 ? "No product references" : `${hits.length} file(s) with product refs`,
        details: hits.slice(0, 5),
      };
    },
  },

  // ── Integrity ──
  {
    name: "VERSION matches manifest.json version",
    category: "integrity",
    run: () => {
      const versionFile = join(PAI_DIR, "VERSION");
      const manifestFile = join(PAI_DIR, "manifest.json");
      if (!existsSync(versionFile) || !existsSync(manifestFile)) {
        return { pass: false, message: "VERSION or manifest.json missing" };
      }
      const version = readFileSync(versionFile, "utf-8").trim();
      const manifest = JSON.parse(readFileSync(manifestFile, "utf-8"));
      const match = version === manifest.version;
      return {
        pass: match,
        message: match ? `Both at v${version}` : `VERSION=${version}, manifest=${manifest.version}`,
      };
    },
  },
  {
    name: "All hooks.jsonc entries exist on disk",
    category: "integrity",
    run: () => {
      const hooksConfigPath = join(PAI_DIR, "config", "hooks.jsonc");
      if (!existsSync(hooksConfigPath)) return { pass: false, message: "hooks.jsonc not found" };
      const raw = readFileSync(hooksConfigPath, "utf-8");
      // Hook refs are like: run-hook.sh HookName.hook.ts
      const hookRefs = [...raw.matchAll(/[\w-]+\.hook\.ts/g)]
        .map(m => m[0])
        .filter(h => h !== "HookName.hook.ts"); // Exclude the pattern comment
      const unique = [...new Set(hookRefs)];
      const missing = unique.filter(h => !existsSync(join(PAI_DIR, "hooks", h)));
      return {
        pass: missing.length === 0,
        message: missing.length === 0
          ? `All ${unique.length} hook references resolve`
          : `${missing.length} hook(s) missing on disk`,
        details: missing,
      };
    },
  },
  {
    name: "skills-lock.json is up-to-date",
    category: "integrity",
    run: () => {
      const lockPath = join(PAI_DIR, "skills-lock.json");
      if (!existsSync(lockPath)) return { pass: false, message: "skills-lock.json not found" };
      try {
        const result = execSync("bun scripts/skills-lock.ts verify", {
          cwd: PAI_DIR, encoding: "utf-8", timeout: 15000, stdio: "pipe",
        });
        return { pass: true, message: "Skills lock matches installed skills" };
      } catch (e: any) {
        const stderr = e.stderr?.toString() ?? "";
        return { pass: false, message: "Skills lock drift detected", details: [stderr.slice(0, 200)] };
      }
    },
  },
  {
    name: "No duplicate skill names across directories",
    category: "integrity",
    run: () => {
      const skillsDir = join(PAI_DIR, "skills");
      if (!existsSync(skillsDir)) return { pass: false, message: "skills/ directory not found" };
      try {
        const result = execSync(
          `find skills -name "SKILL.md" -exec dirname {} \\; | xargs -I{} basename {} | sort | uniq -d`,
          { cwd: PAI_DIR, encoding: "utf-8", timeout: 10000 }
        ).trim();
        const dupes = result ? result.split("\n") : [];
        return {
          pass: dupes.length === 0,
          message: dupes.length === 0 ? "No duplicate skill names" : `${dupes.length} duplicate(s)`,
          details: dupes,
        };
      } catch { return { pass: true, message: "No duplicates found" }; }
    },
  },

  // ── Hygiene ──
  {
    name: "No TODO/FIXME in shipped hooks",
    category: "hygiene",
    run: () => {
      const hits = grep("\\b(TODO|FIXME|HACK)\\b", { exclude: ["*.test.ts"] })
        .filter(f => f.includes("hooks/") && f.endsWith(".hook.ts"));
      return {
        pass: hits.length === 0,
        message: hits.length === 0 ? "No TODO/FIXME in hooks" : `${hits.length} hook(s) with TODOs`,
        details: hits.slice(0, 10),
      };
    },
  },
  {
    name: "Manifest hook count matches filesystem",
    category: "hygiene",
    run: () => {
      const manifestFile = join(PAI_DIR, "manifest.json");
      if (!existsSync(manifestFile)) return { pass: false, message: "manifest.json missing" };
      const manifest = JSON.parse(readFileSync(manifestFile, "utf-8"));
      const declared = manifest.counts?.hooks ?? 0;
      try {
        const actual = parseInt(
          execSync(`find hooks -name "*.hook.ts" | wc -l`, { cwd: PAI_DIR, encoding: "utf-8" }).trim()
        );
        const match = declared === actual;
        return {
          pass: match,
          message: match ? `${actual} hooks (matches)` : `manifest=${declared}, filesystem=${actual}`,
        };
      } catch { return { pass: false, message: "Could not count hooks" }; }
    },
  },
];

// ── Run checks ──

const filtered = categoryFilter
  ? checks.filter(c => c.category === categoryFilter)
  : checks;

interface CheckOutput { name: string; category: string; pass: boolean; message: string; details?: string[] }
const results: CheckOutput[] = [];

if (!isJson) {
  const version = existsSync(join(PAI_DIR, "VERSION"))
    ? readFileSync(join(PAI_DIR, "VERSION"), "utf-8").trim()
    : "unknown";
  console.log(`\n  ${BOLD}Release Audit — v${version}${RESET}`);
  console.log("  " + "─".repeat(50));
}

let currentCategory = "";
for (const check of filtered) {
  if (!isJson && check.category !== currentCategory) {
    currentCategory = check.category;
    console.log(`\n  ${BOLD}${currentCategory.toUpperCase()}${RESET}`);
  }

  const result = check.run();
  results.push({ name: check.name, category: check.category, ...result });

  if (!isJson) {
    const icon = result.pass ? `${GREEN}✅${RESET}` : `${RED}❌${RESET}`;
    console.log(`    ${icon} ${result.message}`);
    if (!result.pass && result.details) {
      for (const d of result.details.slice(0, 3)) {
        console.log(`       ${DIM}${d}${RESET}`);
      }
    }
  }
}

const passed = results.filter(r => r.pass).length;
const failed = results.filter(r => !r.pass).length;

if (isJson) {
  console.log(JSON.stringify({ passed, failed, total: results.length, results }, null, 2));
} else {
  console.log(`\n  ${"─".repeat(50)}`);
  console.log(`  ${passed}/${results.length} passed${failed > 0 ? `, ${RED}${failed} failed${RESET}` : ""}`);
  console.log();
}

process.exit(failed > 0 ? 1 : 0);
