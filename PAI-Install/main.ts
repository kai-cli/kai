#!/usr/bin/env bun
/**
 * PAI Interactive Installer
 * Usage: bun run PAI-Install/main.ts --mode gui
 *
 * Steps:
 *   1. Ensure PAI lives at ~/.claude/ (symlink if cloned elsewhere)
 *   2. Collect identity (user name, timezone, DA name)
 *   3. Choose knowledge domain archetype
 *   4. Configure AWS Bedrock (optional)
 *   5. Create PAI/USER/ scaffold if absent
 *   6. Run BuildSettings.ts → settings.json
 *   7. Run BuildCLAUDE.ts  → CLAUDE.md
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, lstatSync, symlinkSync, unlinkSync, readdirSync } from "fs";
import { join, resolve, dirname, basename } from "path";
import { execSync, spawnSync } from "child_process";
import * as readline from "readline";

// ── Paths ──────────────────────────────────────────────────────────────────
const HOME = process.env.HOME!;
const CLAUDE_DIR = join(HOME, ".claude");

// Resolve the repo root: PAI-Install/../
const INSTALL_DIR = dirname(resolve(import.meta.path));
const PAI_ROOT = resolve(join(INSTALL_DIR, ".."));

// ── Colors ─────────────────────────────────────────────────────────────────
const BLUE       = "\x1b[38;2;59;130;246m";
const LIGHT_BLUE = "\x1b[38;2;147;197;253m";
const GREEN      = "\x1b[38;2;34;197;94m";
const YELLOW     = "\x1b[38;2;234;179;8m";
const RED        = "\x1b[38;2;239;68;68m";
const GRAY       = "\x1b[38;2;100;116;139m";
const STEEL      = "\x1b[38;2;51;65;85m";
const RESET      = "\x1b[0m";
const BOLD       = "\x1b[1m";
const DIM        = "\x1b[2m";

const info  = (m: string) => console.log(`  ${BLUE}ℹ${RESET} ${m}`);
const ok    = (m: string) => console.log(`  ${GREEN}✓${RESET} ${m}`);
const warn  = (m: string) => console.log(`  ${YELLOW}⚠${RESET} ${m}`);
const fail  = (m: string) => console.log(`  ${RED}✗${RESET} ${m}`);
const step  = (n: number, total: number, label: string) =>
  console.log(`\n${STEEL}─────────────────────────────────────────────────${RESET}\n  ${BOLD}${LIGHT_BLUE}Step ${n}/${total}${RESET}  ${label}`);

// ── Prompt helpers ─────────────────────────────────────────────────────────
async function prompt(question: string, defaultVal?: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    const hint = defaultVal ? ` ${DIM}[${defaultVal}]${RESET}` : "";
    rl.question(`  ${BOLD}?${RESET} ${question}${hint}  `, answer => {
      rl.close();
      resolve(answer.trim() || defaultVal || "");
    });
  });
}

async function confirm(question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? "Y/n" : "y/N";
  const answer = await prompt(`${question} ${DIM}(${hint})${RESET}`);
  if (!answer || answer.toLowerCase() === (defaultYes ? "y" : "n")) return defaultYes;
  return answer.toLowerCase().startsWith("y");
}

// ── Run a bun script, streaming output ────────────────────────────────────
function runBun(scriptPath: string): boolean {
  const result = spawnSync("bun", [scriptPath], {
    stdio: "inherit",
    env: { ...process.env, PAI_DIR: CLAUDE_DIR },
  });
  return result.status === 0;
}

// ── JSONC writer (preserves file header comment) ───────────────────────────
export function writeIdentityConfig(paiDir: string, values: {
  daName: string;
  daFullName: string;
  daDisplayName: string;
  daColor: string;
  daCatchphrase: string;
  principalName: string;
  principalTimezone: string;
}) {
  const content = `// PAI Identity Configuration
// Configures the Digital Assistant (DA) and Principal (user) identities.
// These control how the AI presents itself and how it refers to you.
//
// Run \`bun ~/.claude/hooks/handlers/BuildSettings.ts\` after editing to
// regenerate settings.json.

{
  // Digital Assistant identity
  "daidentity": {
    // Display name used in all greetings and self-references
    "name": ${JSON.stringify(values.daName)},
    "fullName": ${JSON.stringify(values.daFullName)},
    "displayName": ${JSON.stringify(values.daDisplayName)},

    // Theme color (hex) — used in status line and UI elements
    "color": ${JSON.stringify(values.daColor)},

    // Message displayed on session start
    "startupCatchphrase": ${JSON.stringify(values.daCatchphrase)}
  },

  // Principal (user) identity
  "principal": {
    // Your name — used in tips, content, and personalizations
    "name": ${JSON.stringify(values.principalName)},

    // Your timezone for scheduling and time-aware features
    "timezone": ${JSON.stringify(values.principalTimezone)}
  }
}
`;
  const identityPath = join(paiDir, "config", "identity.jsonc");
  writeFileSync(identityPath, content, "utf-8");
}

// ── USER scaffold ──────────────────────────────────────────────────────────
export const USER_SCAFFOLD: Record<string, string> = {
  "PAI/USER/README.md": `# PAI User Configuration

This directory contains your personal PAI configuration.
Edit these files to customize PAI for your workflow.

## Getting Started

1. Edit ABOUTME.md with your name and role
2. Edit AISTEERINGRULES.md with your personal rules
3. Add contacts to CONTACTS.md
4. Configure TELOS/ with your goals and projects
`,
  "PAI/USER/ABOUTME.md": `# About Me

<!-- Replace with your information -->
Name: [Your Name]
Role: [Your Role]
Organization: [Your Org]
`,
  "PAI/USER/AISTEERINGRULES.md": `# AI Steering Rules — Personal

<!-- Add your personal steering rules here. These extend and override system rules. -->

## Example Rule

Statement
: Description of the rule

Bad
: Example of incorrect behavior

Correct
: Example of correct behavior
`,
  "PAI/USER/CONTACTS.md": `# Contacts

<!-- Add your frequent contacts here -->
<!-- Format: Name | Role | Context -->
`,
  "PAI/USER/DEFINITIONS.md": `# Definitions

<!-- Add project-specific terminology and acronyms -->
`,
  "PAI/USER/TELOS/README.md": `# TELOS — Life Operating System

Configure your goals, projects, and life context here.
See PAI documentation for TELOS file format.
`,
  "PAI/USER/PROJECTS/README.md": `# Projects

Track your active projects here.
`,
};

export function createUserScaffold(paiDir: string) {
  let created = 0;
  for (const [relPath, content] of Object.entries(USER_SCAFFOLD)) {
    const filePath = join(paiDir, relPath);
    if (existsSync(filePath)) continue;
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, content, "utf-8");
    created++;
  }
  return created;
}

export function createMemoryDirs(paiDir: string) {
  const memDirs = ["MEMORY/STATE", "MEMORY/WORK", "MEMORY/DECISIONS", "MEMORY/SNAPSHOTS", "MEMORY/RESEARCH"];
  for (const d of memDirs) {
    const p = join(paiDir, d);
    if (!existsSync(p)) {
      mkdirSync(p, { recursive: true });
      writeFileSync(join(p, ".gitkeep"), "");
    }
  }
}

// ── Bedrock config writer ──────────────────────────────────────────────────
export function enableBedrockInPreferences(paiDir: string, region: string, profile: string, model: string, smallModel: string) {
  const prefsPath = join(paiDir, "config", "preferences.jsonc");
  let content = readFileSync(prefsPath, "utf-8");

  // Replace the commented-out Bedrock block with active values
  content = content.replace(
    /\/\/ "CLAUDE_CODE_USE_BEDROCK": "1",\n\s*\/\/ "AWS_REGION": "[^"]*",\n\s*\/\/ "AWS_PROFILE": "[^"]*",\n\s*\/\/ "ANTHROPIC_MODEL": "[^"]*",\n\s*\/\/ "ANTHROPIC_SMALL_FAST_MODEL": "[^"]*"/,
    `"CLAUDE_CODE_USE_BEDROCK": "1",\n    "AWS_REGION": ${JSON.stringify(region)},\n    "AWS_PROFILE": ${JSON.stringify(profile)},\n    "ANTHROPIC_MODEL": ${JSON.stringify(model)},\n    "ANTHROPIC_SMALL_FAST_MODEL": ${JSON.stringify(smallModel)}`
  );

  writeFileSync(prefsPath, content, "utf-8");
}

// ── Detect common timezones for prompt hint ────────────────────────────────
export function guessTimezone(): string {
  try {
    const tz = execSync("date +%Z", { encoding: "utf-8" }).trim();
    const map: Record<string, string> = {
      PST: "America/Los_Angeles", PDT: "America/Los_Angeles",
      MST: "America/Denver",      MDT: "America/Denver",
      CST: "America/Chicago",     CDT: "America/Chicago",
      EST: "America/New_York",    EDT: "America/New_York",
      UTC: "UTC",                 GMT: "UTC",
    };
    return map[tz] ?? "America/Los_Angeles";
  } catch {
    return "America/Los_Angeles";
  }
}

// ── Settings migration ────────────────────────────────────────────────────
/**
 * Extract user-customized values from an existing settings.json before it's
 * replaced by the PAI-generated version. Writes config/preferences.local.jsonc
 * so BuildSettings merges these values on top of defaults.
 *
 * Preserves: env vars, MCP servers, permissions customizations, Bedrock config,
 * tech stack, temperature preference, max_tokens, runtime state.
 */
export function migrateExistingSettings(existingSettingsPath: string, paiDir: string): number {
  if (!existsSync(existingSettingsPath)) return 0;

  let existing: Record<string, unknown>;
  try {
    existing = JSON.parse(readFileSync(existingSettingsPath, "utf-8"));
  } catch {
    return 0;
  }

  const local: Record<string, unknown> = {};

  // Migrate env vars (skip PAI-managed ones — they're in preferences.jsonc)
  const paiManagedEnvKeys = new Set([
    "PAI_DIR", "PROJECTS_DIR", "CLAUDE_CODE_MAX_OUTPUT_TOKENS",
    "BASH_DEFAULT_TIMEOUT_MS", "PAI_CONFIG_DIR", "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS",
  ]);
  const env = existing.env as Record<string, unknown> | undefined;
  if (env && typeof env === "object") {
    const customEnv: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(env)) {
      if (!paiManagedEnvKeys.has(k)) customEnv[k] = v;
    }
    if (Object.keys(customEnv).length > 0) local.env = customEnv;
  }

  // Migrate MCP servers
  const mcp = existing.mcpServers as Record<string, unknown> | undefined;
  if (mcp && typeof mcp === "object" && Object.keys(mcp).length > 0) {
    local.mcpServers = mcp;
  }

  // Migrate tech stack
  const ts = existing.techStack as Record<string, unknown> | undefined;
  if (ts && typeof ts === "object") local.techStack = ts;

  // Migrate max_tokens
  if (typeof existing.max_tokens === "number") local.max_tokens = existing.max_tokens;

  // Migrate preferences
  const prefs = existing.preferences as Record<string, unknown> | undefined;
  if (prefs && typeof prefs === "object") local.preferences = prefs;

  // Preserve runtime state (counts, feedback survey)
  if (existing.counts) local.counts = existing.counts;
  if (existing.feedbackSurveyState) local.feedbackSurveyState = existing.feedbackSurveyState;

  const migrated = Object.keys(local).length;
  if (migrated === 0) return 0;

  const content = `// PAI Local Overrides — Machine-Specific Settings
// Auto-generated by PAI installer from your previous settings.json.
// These values are merged ON TOP of config/preferences.jsonc at build time.
//
// This file is gitignored — it stays on this machine only.
// Edit freely. Run \`bun ~/.claude/hooks/handlers/BuildSettings.ts\` to rebuild.

${JSON.stringify(local, null, 2)}
`;

  const configDir = join(paiDir, "config");
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "preferences.local.jsonc"), content, "utf-8");
  return migrated;
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const TOTAL_STEPS = 7;

  console.log(`\n${BOLD}${LIGHT_BLUE}PAI Setup Wizard${RESET}\n`);
  info(`Repo location: ${GRAY}${PAI_ROOT}${RESET}`);
  info(`Target:        ${GRAY}${CLAUDE_DIR}${RESET}`);
  console.log();

  // ── Step 1: Ensure PAI is at ~/.claude/ ───────────────────────────────
  step(1, TOTAL_STEPS, "Link PAI to ~/.claude/");

  const alreadyInPlace = resolve(PAI_ROOT) === resolve(CLAUDE_DIR);

  if (alreadyInPlace) {
    ok("Already installed at ~/.claude/");
  } else {
    // Check if ~/.claude/ already exists
    if (existsSync(CLAUDE_DIR)) {
      const stat = lstatSync(CLAUDE_DIR);
      if (stat.isSymbolicLink()) {
        // Already a symlink — update it
        warn(`~/.claude/ is a symlink. Relinking to this repo...`);
        unlinkSync(CLAUDE_DIR);
        symlinkSync(PAI_ROOT, CLAUDE_DIR);
        ok(`~/.claude/ → ${PAI_ROOT}`);
      } else if (stat.isDirectory()) {
        warn(`~/.claude/ already exists as a real directory.`);

        // Migrate existing settings before moving the directory
        const existingSettings = join(CLAUDE_DIR, "settings.json");
        if (existsSync(existingSettings)) {
          info("Detected existing settings.json — migrating your customizations...");
          const count = migrateExistingSettings(existingSettings, PAI_ROOT);
          if (count > 0) {
            ok(`Migrated ${count} setting groups to config/preferences.local.jsonc`);
            info(`${DIM}Your env vars, MCP servers, and preferences are preserved.${RESET}`);
          } else {
            info("No custom settings to migrate (default configuration).");
          }
        }

        console.log(`\n  ${DIM}Options:${RESET}`);
        console.log(`  ${DIM}  [s] Symlink ~/.claude/ → this repo (recommended for git workflow)${RESET}`);
        console.log(`  ${DIM}  [k] Keep existing ~/.claude/ and abort${RESET}`);
        const choice = await prompt("Choice", "s");
        if (choice.toLowerCase() === "s") {
          const backup = `${CLAUDE_DIR}.bak-${Date.now()}`;
          warn(`Backing up existing ~/.claude/ to ${backup}`);
          execSync(`mv "${CLAUDE_DIR}" "${backup}"`);
          symlinkSync(PAI_ROOT, CLAUDE_DIR);
          ok(`~/.claude/ → ${PAI_ROOT}  ${DIM}(old dir backed up)${RESET}`);
        } else {
          fail("Aborted. To install manually, copy repo contents to ~/.claude/");
          process.exit(1);
        }
      }
    } else {
      // Clean install — just symlink
      symlinkSync(PAI_ROOT, CLAUDE_DIR);
      ok(`~/.claude/ → ${PAI_ROOT}`);
    }
  }

  // From here, operate on CLAUDE_DIR (which resolves to PAI_ROOT)
  const paiDir = CLAUDE_DIR;

  // ── Step 2: Identity ───────────────────────────────────────────────────
  step(2, TOTAL_STEPS, "Configure identity");

  // Load existing identity to use as defaults
  const identityPath = join(paiDir, "config", "identity.jsonc");
  let defaultDaName = "KAI";
  let defaultDaColor = "#3B82F6";
  let defaultDaCatchphrase = "Ready";
  let defaultPrincipalName = "";
  let defaultTimezone = guessTimezone();

  if (existsSync(identityPath)) {
    try {
      const raw = readFileSync(identityPath, "utf-8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(?<!:)\/\/[^\n]*/g, "");
      const parsed = JSON.parse(raw) as {
        daidentity?: { name?: string; color?: string; startupCatchphrase?: string };
        principal?: { name?: string; timezone?: string };
      };
      defaultDaName = parsed.daidentity?.name ?? defaultDaName;
      defaultDaColor = parsed.daidentity?.color ?? defaultDaColor;
      defaultDaCatchphrase = parsed.daidentity?.startupCatchphrase ?? defaultDaCatchphrase;
      defaultPrincipalName = parsed.principal?.name ?? defaultPrincipalName;
      defaultTimezone = parsed.principal?.timezone ?? defaultTimezone;
    } catch { /* use defaults */ }
  }

  console.log(`\n  ${DIM}Your assistant's identity (press Enter to keep current)${RESET}\n`);
  const daName = await prompt("Assistant name", defaultDaName);
  const principalName = await prompt("Your name", defaultPrincipalName || undefined);
  const timezone = await prompt("Your timezone", defaultTimezone);

  writeIdentityConfig(paiDir, {
    daName,
    daFullName: daName,
    daDisplayName: daName,
    daColor: defaultDaColor,
    daCatchphrase: `${daName.split(" ")[0]} go`,
    principalName,
    principalTimezone: timezone,
  });
  ok(`Identity saved  ${DIM}(${daName} / ${principalName})${RESET}`);

  // ── Step 3: Knowledge domain archetype ──────────────────────────────
  step(3, TOTAL_STEPS, "Choose knowledge domains");

  const startersDir = join(PAI_ROOT, "config", "starters");
  const domainsTarget = join(paiDir, "config", "domains.jsonc");
  const hasExistingDomains = existsSync(domainsTarget);

  let skipArchetype = false;
  if (hasExistingDomains) {
    skipArchetype = !(await confirm("domains.jsonc already exists. Replace with a starter archetype?", false));
  }

  if (!skipArchetype && existsSync(startersDir)) {
    const starters = readdirSync(startersDir)
      .filter(f => f.endsWith("-domains.jsonc"))
      .map(f => f.replace("-domains.jsonc", ""));

    const archetypeDescriptions: Record<string, string> = {
      fullstack: "Frontend + backend + devops + security + databases (5 domains)",
      datascience: "ML + data engineering + analysis + visualization + devops + databases (6 domains)",
      devops: "Infrastructure + containers + CI/CD + observability + networking + security (6 domains)",
      generic: "Backend + frontend + devops — broad coverage (3 domains)",
    };

    console.log(`\n  ${DIM}Knowledge domains shape what your assistant learns over time.${RESET}`);
    console.log(`  ${DIM}You can edit config/domains.jsonc later to customize.${RESET}\n`);
    for (let i = 0; i < starters.length; i++) {
      const name = starters[i];
      const desc = archetypeDescriptions[name] ?? "";
      console.log(`  ${BOLD}${LIGHT_BLUE}[${i + 1}]${RESET} ${name}${desc ? `  ${GRAY}— ${desc}${RESET}` : ""}`);
    }
    console.log();

    const choice = await prompt(`Pick an archetype (1-${starters.length})`, "1");
    const idx = parseInt(choice, 10) - 1;
    if (idx >= 0 && idx < starters.length) {
      const selected = starters[idx];
      const src = join(startersDir, `${selected}-domains.jsonc`);
      copyFileSync(src, domainsTarget);
      ok(`Domains configured: ${BOLD}${selected}${RESET}  ${DIM}(${starters.length} available)${RESET}`);
    } else {
      warn("Invalid selection — keeping default domains.jsonc");
    }
  } else if (skipArchetype) {
    ok("Keeping existing domains.jsonc");
  } else {
    warn("No starter archetypes found — using default domains.jsonc");
  }

  // ── Step 4: AWS Bedrock (optional) ────────────────────────────────────
  step(4, TOTAL_STEPS, "AWS Bedrock (optional)");
  console.log(`\n  ${DIM}Skip this if you connect directly to Anthropic (most users).${RESET}\n`);
  const useBedrock = await confirm("Route Claude Code through AWS Bedrock?", false);
  if (useBedrock) {
    const region = await prompt("AWS region", "us-west-2");
    const awsProfile = await prompt("AWS profile name");
    if (awsProfile) {
      const model = await prompt("Bedrock model ID", "us.anthropic.claude-opus-4-6-v1");
      const smallModel = await prompt("Bedrock small/fast model ID", "us.anthropic.claude-haiku-4-5-20251001-v1:0");
      try {
        enableBedrockInPreferences(paiDir, region, awsProfile, model, smallModel);
        ok(`Bedrock configured  ${DIM}(profile: ${awsProfile}, region: ${region})${RESET}`);
      } catch (e) {
        warn(`Could not write Bedrock config: ${e instanceof Error ? e.message : e}`);
        warn("Edit config/preferences.jsonc manually to enable Bedrock.");
      }
    } else {
      warn("No profile name entered — skipping Bedrock config");
    }
  } else {
    ok(`Using Anthropic direct API  ${DIM}(default)${RESET}`);
  }

  // ── Step 5: USER scaffold ──────────────────────────────────────────────
  step(5, TOTAL_STEPS, "Create USER configuration scaffold");
  const created = createUserScaffold(paiDir);
  createMemoryDirs(paiDir);
  if (created > 0) {
    ok(`Created ${created} scaffold files in PAI/USER/`);
  } else {
    ok("USER scaffold already exists");
  }

  // ── Step 6: Build settings.json ────────────────────────────────────────
  step(6, TOTAL_STEPS, "Build settings.json");
  const buildSettingsPath = join(paiDir, "hooks", "handlers", "BuildSettings.ts");
  if (existsSync(buildSettingsPath)) {
    const built = runBun(buildSettingsPath);
    if (built) {
      ok("settings.json built from config/*.jsonc");
    } else {
      warn("BuildSettings failed — settings.json may need manual rebuild");
      warn(`Run: bun ~/.claude/hooks/handlers/BuildSettings.ts`);
    }
  } else {
    warn(`BuildSettings.ts not found at ${buildSettingsPath}`);
  }

  // ── Step 7: Build CLAUDE.md ────────────────────────────────────────────
  step(7, TOTAL_STEPS, "Build CLAUDE.md");
  const buildClaudePath = join(paiDir, "hooks", "handlers", "BuildCLAUDE.ts");
  if (existsSync(buildClaudePath)) {
    const built = runBun(buildClaudePath);
    if (built) {
      ok("CLAUDE.md generated from template");
    } else {
      warn("BuildCLAUDE failed — CLAUDE.md may need manual rebuild");
    }
  } else {
    warn("BuildCLAUDE.ts not found — skipping CLAUDE.md generation");
  }

  // ── Done ───────────────────────────────────────────────────────────────
  console.log(`\n${STEEL}─────────────────────────────────────────────────${RESET}`);
  console.log(`\n  ${GREEN}${BOLD}PAI installed successfully!${RESET}\n`);
  console.log(`  ${DIM}Start a new Claude Code session to activate.${RESET}`);
  console.log(`  ${DIM}Board: bun ~/.claude/scripts/board.ts${RESET}\n`);
}

if (import.meta.main) {
  main().catch(e => {
    console.error(`\n  ${RED}✗${RESET} ${e.message}`);
    process.exit(1);
  });
}
