#!/usr/bin/env bun
/**
 * PAI Interactive Installer
 * Usage: bun run PAI-Install/main.ts --mode gui
 *
 * Steps:
 *   1. Ensure PAI lives at ~/.claude/ (symlink if cloned elsewhere)
 *   2. Choose knowledge archetype
 *   3. Collect identity (user name, timezone, DA name)
 *   4. Configure AWS Bedrock (optional)
 *   5. Create PAI/USER/ scaffold
 *   6. Detect tools & build TOOLS.md
 *   7. Run BuildSettings.ts → settings.json
 *   8. Run BuildCLAUDE.ts  → CLAUDE.md
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, lstatSync, symlinkSync, unlinkSync } from "fs";
import { join, resolve, dirname } from "path";
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
  "PAI/USER/AISTEERINGRULES.md.template": `# AI Steering Rules — Personal (Template)
<!-- Copy or rename this file to AISTEERINGRULES.md and fill in your rules. -->
<!-- These extend and override system rules. Each rule follows this format: -->

## Rule Name

Statement
: One-sentence description of the behavior you want.

Bad
: Example of what you don't want the assistant to do.

Correct
: Example of the behavior you do want.

## Examples to get you started

### Be concise
Statement
: Keep responses tight. No padding, no restating what I just said.

Bad
: "Great question! Let me explain..." followed by a 3-paragraph preamble.

Correct
: Answer the question directly in the first sentence.

### Ask before refactoring
Statement
: Don't clean up surrounding code unless I explicitly ask.

Bad
: Fixing a bug while also renaming variables and reorganizing imports.

Correct
: Fix exactly what was asked. Note other issues separately if you spot them.
`,
  "PAI/USER/PROJECTS/PROJECTS.md.template": `# Projects (Template)
<!-- Copy or rename this file to PROJECTS.md and fill in your projects. -->
<!-- Format: one section per active project. -->

## [Project Name]

**Repo:** github.com/yourorg/project-name
**Stack:** TypeScript, Node.js, PostgreSQL
**Status:** Active
**What it is:** One sentence describing the project.
**Current focus:** What you're working on right now.
**Key files:** List 2-3 files Claude should know about.

---

## [Another Project]

**Repo:** github.com/yourorg/another-project
**Stack:** Python, FastAPI
**Status:** Maintenance
**What it is:** One sentence.
**Current focus:** Bug fixes and dependency updates.
`,
};

export function createSecurityPatterns(paiDir: string): boolean {
  const userPatternsPath = join(paiDir, "PAI", "USER", "PAISECURITYSYSTEM", "patterns.yaml");
  if (existsSync(userPatternsPath)) return false;

  const examplePath = join(paiDir, "skills", "PAI", "PAISECURITYSYSTEM", "patterns.example.yaml");
  if (!existsSync(examplePath)) return false;

  const dir = dirname(userPatternsPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const content = readFileSync(examplePath, "utf-8");
  writeFileSync(userPatternsPath, content, "utf-8");
  return true;
}

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
  const memDirs = [
    "MEMORY/STATE", "MEMORY/WORK", "MEMORY/DECISIONS", "MEMORY/SNAPSHOTS",
    "MEMORY/RESEARCH", "MEMORY/KNOWLEDGE", "MEMORY/LEARNING",
    "MEMORY/LEARNING/REFLECTIONS", "MEMORY/RELATIONSHIP", "MEMORY/SECURITY",
    "MEMORY/STAGING", "MEMORY/WISDOM",
  ];
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

// ── Archetype starter writer ───────────────────────────────────────────────

const ARCHETYPES: Record<string, { label: string; description: string; file: string }> = {
  "1": { label: "Generic",     description: "3 broad domains (backend, frontend, devops)",                     file: "generic-domains.jsonc" },
  "2": { label: "Full-Stack",  description: "5 domains (backend, frontend, devops, security, databases)",      file: "fullstack-domains.jsonc" },
  "3": { label: "Data Science", description: "6 domains (ML, data-eng, analysis, viz, devops, databases)",   file: "datascience-domains.jsonc" },
  "4": { label: "DevOps",      description: "6 domains (infra, containers, CI/CD, observability, networking, security)", file: "devops-domains.jsonc" },
  "5": { label: "Custom",      description: "Start with Generic, edit config/domains.jsonc afterward",        file: "generic-domains.jsonc" },
};

export function applyArchetype(paiDir: string, archetypeFile: string): boolean {
  const starterPath = join(paiDir, "config", "starters", archetypeFile);
  const domainsPath = join(paiDir, "config", "domains.jsonc");
  if (!existsSync(starterPath)) return false;
  const content = readFileSync(starterPath, "utf-8");
  // Validate before writing — a broken starter file should not overwrite domains.jsonc
  try {
    const stripped = content
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(?<!:)\/\/[^\n]*/g, '')
      .replace(/,(\s*[}\]])/g, '$1');
    JSON.parse(stripped);
  } catch {
    return false;
  }
  writeFileSync(domainsPath, content, "utf-8");
  return true;
}

// ── Main ───────────────────────────────────────────────────────────────────
// ── Tool Detection ────────────────────────────────────────────────────────
interface DetectedTool {
  name: string;
  category: "api" | "cli" | "cloud";
  status: "✅ Set" | "✅ Installed" | "✅ Authenticated" | "❌ Not found";
  detail?: string;
}

function detectTools(): DetectedTool[] {
  const tools: DetectedTool[] = [];

  // API keys from environment
  const apiKeys: [string, string][] = [
    ["ANTHROPIC_API_KEY", "Claude API"],
    ["GEMINI_API_KEY", "Google Gemini"],
    ["OPENAI_API_KEY", "OpenAI GPT-4o"],
    ["DEEPSEEK_API_KEY", "DeepSeek"],
    ["MISTRAL_API_KEY", "Mistral"],
    ["GROK_API_KEY", "xAI Grok"],
    ["GITHUB_TOKEN", "GitHub API"],
    ["ELEVENLABS_API_KEY", "ElevenLabs TTS"],
    ["REPLICATE_API_TOKEN", "Replicate"],
    ["APIFY_API_KEY", "Apify"],
    ["BRIGHT_DATA_API_KEY", "Bright Data"],
  ];

  for (const [key, name] of apiKeys) {
    if (process.env[key]) {
      tools.push({ name, category: "api", status: "✅ Set", detail: key });
    }
  }

  // CLI tools
  const cliTools: [string, string][] = [
    ["gh", "GitHub CLI"],
    ["rg", "ripgrep (fast search)"],
    ["ffmpeg", "Audio/video processing"],
    ["jq", "JSON processing"],
    ["python3", "Python"],
    ["docker", "Docker"],
    ["kubectl", "Kubernetes"],
    ["terraform", "Terraform"],
    ["aws", "AWS CLI"],
  ];

  for (const [cmd, name] of cliTools) {
    try {
      execSync(`which ${cmd}`, { stdio: "pipe" });
      tools.push({ name, category: "cli", status: "✅ Installed", detail: cmd });
    } catch {
      // Not installed — skip
    }
  }

  // GitHub auth
  try {
    const ghResult = execSync("gh auth status 2>&1", { stdio: "pipe" }).toString();
    if (ghResult.includes("Logged in")) {
      const accountMatch = ghResult.match(/account\s+(\S+)/);
      tools.push({ name: "GitHub", category: "cloud", status: "✅ Authenticated", detail: accountMatch?.[1] });
    }
  } catch { /* not authed */ }

  // AWS identity
  try {
    const awsResult = execSync("aws sts get-caller-identity 2>/dev/null", { stdio: "pipe" }).toString();
    const parsed = JSON.parse(awsResult);
    tools.push({ name: "AWS", category: "cloud", status: "✅ Authenticated", detail: parsed.Arn?.split("/").pop() });
  } catch { /* not configured */ }

  return tools;
}

function generateToolsMd(tools: DetectedTool[], extraLines: string[]): string {
  let content = `# Tools, Services & Access Registry

> Cross-project reference. Every session loads this at startup.
> Last verified: ${new Date().toISOString().split("T")[0]}

---

## API Keys & AI Services

| Key | Service | Status |
|-----|---------|--------|
`;

  const apiTools = tools.filter(t => t.category === "api");
  if (apiTools.length > 0) {
    for (const t of apiTools) {
      content += `| ${t.detail} | ${t.name} | ${t.status} |\n`;
    }
  } else {
    content += `| ANTHROPIC_API_KEY | Claude API | ❌ Not configured |\n`;
  }

  content += `
## Cloud & Infrastructure

| Service | Account | Status |
|---------|---------|--------|
`;

  const cloudTools = tools.filter(t => t.category === "cloud");
  if (cloudTools.length > 0) {
    for (const t of cloudTools) {
      content += `| ${t.name} | ${t.detail || "—"} | ${t.status} |\n`;
    }
  } else {
    content += `| — | — | No cloud services detected |\n`;
  }

  content += `
## CLI Tools

| Tool | Purpose | Status |
|------|---------|--------|
| bun | Runtime, package manager, test runner | ✅ Installed |
`;

  const cliDetected = tools.filter(t => t.category === "cli");
  for (const t of cliDetected) {
    content += `| ${t.detail} | ${t.name} | ${t.status} |\n`;
  }

  content += `
## MCP Servers

| Server | Scope | URL |
|--------|-------|-----|
`;
  content += `| (add your MCP servers here) | | |\n`;

  if (extraLines.length > 0) {
    content += `
## Additional (user-provided)

`;
    for (const line of extraLines) {
      content += `- ${line}\n`;
    }
  }

  content += `
---

## Maintenance Scripts

Full runbook: \`scripts/MAINTENANCE.md\`

| Cadence | Command | What |
|---------|---------|------|
| Weekly | \`bun scripts/tools-sync.ts\` | Scan projects for new tools/services |
| Weekly | \`bun PAI/Tools/MemoryCurate.ts\` | Review STAGING memory drafts |
| Release | \`bash scripts/verify-release.sh\` | Full system validation |

**Convention:** Add a \`## Tools & Access\` section to any project's CLAUDE.md to register
tools/services for auto-collection by \`tools-sync.ts\`.

---

## File Maintenance

This file is maintained manually + \`bun scripts/tools-sync.ts --apply\`.

To check what's actually available in a session:
\`\`\`bash
env | grep -E "KEY|TOKEN|SECRET" | sed 's/=.*/=✅/'
\`\`\`
`;

  return content;
}

async function main() {
  const TOTAL_STEPS = 9;

  // Detect upgrade vs fresh install
  const isUpgrade = existsSync(join(PAI_ROOT, "config", "preferences.local.jsonc"))
    || existsSync(join(PAI_ROOT, "config", "identity.jsonc"));

  console.log(`\n${BOLD}${LIGHT_BLUE}KAI Setup Wizard${RESET}${isUpgrade ? `  ${DIM}(upgrade detected)${RESET}` : ""}\n`);
  info(`Repo location: ${GRAY}${PAI_ROOT}${RESET}`);
  info(`Target:        ${GRAY}${CLAUDE_DIR}${RESET}`);
  if (isUpgrade) {
    info(`Mode:          ${GRAY}Upgrade — skipping already-configured steps${RESET}`);
  }
  console.log();

  // ── Step 1: Ensure PAI is at ~/.claude/ ───────────────────────────────
  step(1, TOTAL_STEPS, "Link KAI to ~/.claude/");

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

  // ── Step 2: Claude Code & Authentication ───────────────────────────────
  step(2, TOTAL_STEPS, "Claude Code & authentication");

  // Check if Claude Code CLI is available
  let claudeInstalled = false;
  try {
    const ver = execSync("claude --version 2>/dev/null", { encoding: "utf-8" }).trim();
    claudeInstalled = true;
    ok(`Claude Code installed: ${DIM}${ver}${RESET}`);
  } catch {
    // not found
  }

  if (!claudeInstalled) {
    console.log(`\n  ${RED}Claude Code is not installed.${RESET}`);
    console.log(`  ${DIM}KAI requires Claude Code to function. Install it first:${RESET}\n`);
    console.log(`    ${BOLD}npm install -g @anthropic-ai/claude-code${RESET}`);
    console.log(`    ${DIM}or:${RESET} ${BOLD}brew install claude${RESET}\n`);
    const continueAnyway = await confirm("Continue setup without Claude Code?", false);
    if (!continueAnyway) {
      fail("Install Claude Code first, then re-run this installer.");
      process.exit(1);
    }
    warn("Continuing — you'll need to install Claude Code before using KAI");
  }

  // Check if API key already configured
  const hasApiKey = !!process.env.ANTHROPIC_API_KEY;

  if (isUpgrade && claudeInstalled && hasApiKey) {
    ok(`ANTHROPIC_API_KEY set in environment`);
  } else if (isUpgrade && claudeInstalled) {
    ok(`Using OAuth authentication`);
  } else {
    // Fresh install — walk through auth options
    console.log(`\n  ${DIM}Claude Code authenticates in two ways:${RESET}`);
    console.log(`    ${BOLD}1${RESET}  OAuth ${DIM}— log in with your claude.ai account (most users)${RESET}`);
    console.log(`    ${BOLD}2${RESET}  API Key ${DIM}— set ANTHROPIC_API_KEY in your shell profile${RESET}`);
    console.log(`\n  ${DIM}OAuth is simpler — just run \`claude\` and it opens a browser login.${RESET}`);
    console.log(`  ${DIM}An API key is optional but needed for research agents and multi-model skills.${RESET}\n`);

    const wantsApiKey = await confirm("Do you have an Anthropic API key to configure?", false);
    if (wantsApiKey) {
      const apiKey = await prompt("ANTHROPIC_API_KEY (starts with sk-ant-)");
      if (apiKey && apiKey.startsWith("sk-")) {
        // Detect shell profile
        const shell = process.env.SHELL ?? "/bin/zsh";
        const profileFile = shell.includes("zsh") ? ".zshrc" : ".bashrc";
        const profilePath = join(HOME, profileFile);

        // Check if already set
        let alreadySet = false;
        if (existsSync(profilePath)) {
          const content = readFileSync(profilePath, "utf-8");
          alreadySet = content.includes("ANTHROPIC_API_KEY");
        }

        if (alreadySet) {
          ok(`ANTHROPIC_API_KEY already in ~/${profileFile}`);
        } else {
          const addToProfile = await confirm(`Add to ~/${profileFile}?`, true);
          if (addToProfile) {
            const line = `\nexport ANTHROPIC_API_KEY="${apiKey}"\n`;
            const existing = existsSync(profilePath) ? readFileSync(profilePath, "utf-8") : "";
            writeFileSync(profilePath, existing + line, "utf-8");
            ok(`Added ANTHROPIC_API_KEY to ~/${profileFile}`);
            info(`${DIM}Run: source ~/${profileFile} (or open a new terminal)${RESET}`);
          } else {
            info(`Set it yourself: export ANTHROPIC_API_KEY="${apiKey.slice(0, 8)}..."`);
          }
        }
      } else if (apiKey) {
        warn("That doesn't look like an Anthropic key (should start with sk-ant-)");
        info(`${DIM}You can set it later: export ANTHROPIC_API_KEY=sk-ant-...${RESET}`);
      } else {
        ok("Skipped — you can add it later if needed");
      }
    } else {
      ok(`Using OAuth  ${DIM}(run \`claude\` to log in after install)${RESET}`);
    }
  }

  // ── Step 3: Archetype selection ────────────────────────────────────────
  step(3, TOTAL_STEPS, "Choose your knowledge archetype");

  const domainsPath = join(paiDir, "config", "domains.jsonc");
  const hasExistingDomains = existsSync(domainsPath);

  if (hasExistingDomains) {
    ok(`config/domains.jsonc already exists — keeping current domain configuration`);
    info(`${DIM}To reconfigure, delete config/domains.jsonc and re-run installer${RESET}`);
  } else {
    console.log(`\n  ${DIM}Select the archetype that best matches your work.${RESET}`);
    console.log(`  ${DIM}This sets up the knowledge domains KAI uses to organize what it learns.${RESET}\n`);
    for (const [key, arch] of Object.entries(ARCHETYPES)) {
      console.log(`  ${BOLD}${key}${RESET}  ${arch.label.padEnd(14)} ${DIM}${arch.description}${RESET}`);
    }
    console.log();

    const choice = await prompt("Archetype", "1");
    const archetype = ARCHETYPES[choice] ?? ARCHETYPES["1"];
    const applied = applyArchetype(paiDir, archetype.file);
    if (applied) {
      ok(`Applied ${archetype.label} archetype → config/domains.jsonc`);
      if (choice === "5") {
        info(`${DIM}Edit config/domains.jsonc to customize your domains${RESET}`);
      }
    } else {
      warn(`Starter file not found — skipping archetype setup`);
      warn(`Run manually: cp config/starters/generic-domains.jsonc config/domains.jsonc`);
    }
  }

  // ── Step 4: Identity ───────────────────────────────────────────────────
  step(4, TOTAL_STEPS, "Configure identity");

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

  let daName = defaultDaName;
  let principalName = defaultPrincipalName;
  let timezone = defaultTimezone;

  if (isUpgrade && defaultPrincipalName) {
    ok(`Identity: ${DIM}${defaultDaName} / ${defaultPrincipalName} (${defaultTimezone})${RESET}`);
  } else {
    console.log(`\n  ${DIM}Your assistant's identity (press Enter to keep current)${RESET}\n`);
    daName = await prompt("Assistant name", defaultDaName);
    principalName = await prompt("Your name", defaultPrincipalName || undefined);
    timezone = await prompt("Your timezone", defaultTimezone);

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
  }

  // ── Step 5: About You ──────────────────────────────────────────────────
  step(5, TOTAL_STEPS, "About You");

  const aboutMePath = join(paiDir, "PAI", "USER", "ABOUTME.md");
  let aboutMeHasPlaceholders = true;

  if (existsSync(aboutMePath)) {
    const content = readFileSync(aboutMePath, "utf-8");
    aboutMeHasPlaceholders = content.includes("[Your Name]") || content.includes("[Your Role]");
  }

  if (!aboutMeHasPlaceholders) {
    ok("ABOUTME.md already personalized");
  } else if (isUpgrade && principalName) {
    // Upgrade with identity already set — auto-fill with what we know
    const dir = dirname(aboutMePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const aboutContent = `# About Me\n\nName: ${principalName}\nRole: [Your Role]\nOrganization: [Your Org]\n\n## Preferences\n\n<!-- Add your communication/work preferences here -->\n`;
    writeFileSync(aboutMePath, aboutContent, "utf-8");
    ok(`ABOUTME.md updated with name from identity  ${DIM}(edit to add role/org)${RESET}`);
  } else {
    console.log(`\n  ${DIM}Your About Me profile helps KAI personalize its responses.${RESET}`);
    console.log(`  ${DIM}It's loaded into context so the AI knows who you are.${RESET}\n`);
    const fillAboutMe = await confirm("Would you like to fill in your profile now?", true);

    if (fillAboutMe) {
      const aboutName = principalName || await prompt("Your name");
      const aboutRole = await prompt("Your role (e.g. Software Engineer, Data Scientist)");
      const aboutOrg = await prompt("Organization (or 'personal')", "personal");
      const aboutFocus = await prompt("What are you working on? (one line, optional)");

      let aboutContent = `# About Me\n\nName: ${aboutName}\nRole: ${aboutRole}\nOrganization: ${aboutOrg}\n`;
      if (aboutFocus) {
        aboutContent += `\n## Current Focus\n\n${aboutFocus}\n`;
      }
      aboutContent += `\n## Preferences\n\n<!-- Add your communication/work preferences here -->\n`;

      const dir = dirname(aboutMePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(aboutMePath, aboutContent, "utf-8");
      ok(`ABOUTME.md saved  ${DIM}(${aboutName} / ${aboutRole})${RESET}`);
    } else {
      ok("Skipped — edit ~/.claude/PAI/USER/ABOUTME.md anytime");
    }
  }

  // ── Step 6: AWS Bedrock (optional) ────────────────────────────────────
  step(6, TOTAL_STEPS, "AWS Bedrock (optional)");

  // Check if Bedrock is already configured
  const prefsPath = join(paiDir, "config", "preferences.jsonc");
  let bedrockAlreadyConfigured = false;
  if (existsSync(prefsPath)) {
    const prefsContent = readFileSync(prefsPath, "utf-8");
    bedrockAlreadyConfigured = prefsContent.includes('"CLAUDE_CODE_USE_BEDROCK": "1"');
  }

  if (bedrockAlreadyConfigured) {
    ok(`Bedrock already configured`);
  } else if (isUpgrade) {
    ok(`Anthropic direct API  ${DIM}(unchanged)${RESET}`);
  } else {
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
  }

  // ── Step 7: Scaffold, tools & dependencies ─────────────────────────────
  step(7, TOTAL_STEPS, "Scaffold, tools & dependencies");

  // USER scaffold
  const created = createUserScaffold(paiDir);
  createMemoryDirs(paiDir);
  const securityCreated = createSecurityPatterns(paiDir);
  if (created > 0 || securityCreated) {
    ok(`Created ${created} scaffold files in PAI/USER/${securityCreated ? ' + security patterns' : ''}`);
  } else {
    ok("USER scaffold already exists");
  }

  // Install bun dependencies
  const pkgJsonPath = join(paiDir, "package.json");
  if (existsSync(pkgJsonPath)) {
    info("Installing dependencies...");
    try {
      execSync("bun install --silent", { cwd: paiDir, stdio: "pipe" });
      ok("Dependencies installed");
    } catch {
      warn("bun install failed — run manually: cd ~/.claude && bun install");
    }
  }

  // Detect tools & build TOOLS.md
  const toolsMdPath = join(paiDir, "TOOLS.md");
  if (existsSync(toolsMdPath)) {
    ok("TOOLS.md already exists — keeping current registry");
  } else {
    console.log(`\n  ${DIM}Scanning your environment for API keys, CLI tools, and services...${RESET}\n`);
    const detected = detectTools();

    const apiCount = detected.filter(t => t.category === "api").length;
    const cliCount = detected.filter(t => t.category === "cli").length;
    const cloudCount = detected.filter(t => t.category === "cloud").length;

    if (detected.length > 0) {
      info(`Found: ${apiCount} API keys, ${cliCount} CLI tools, ${cloudCount} cloud services`);
      console.log();
      for (const t of detected) {
        console.log(`    ${t.status}  ${t.name}${t.detail ? `  ${DIM}(${t.detail})${RESET}` : ""}`);
      }
      console.log();
    } else {
      info("No tools detected in environment (you can add them to TOOLS.md later)");
    }

    const addMore = await confirm("Anything else to add? (databases, devices, internal services)", false);
    const extraLines: string[] = [];
    if (addMore) {
      console.log(`\n  ${DIM}Enter items one per line. Empty line to finish.${RESET}\n`);
      let entry = await prompt("Tool/service");
      while (entry) {
        extraLines.push(entry);
        entry = await prompt("Tool/service (empty to finish)");
      }
    }

    const toolsContent = generateToolsMd(detected, extraLines);
    writeFileSync(toolsMdPath, toolsContent);
    ok(`Created TOOLS.md with ${detected.length} detected items${extraLines.length > 0 ? ` + ${extraLines.length} manual` : ""}`);
  }

  // ── Step 8: Build configuration ────────────────────────────────────────
  step(8, TOTAL_STEPS, "Build configuration");

  // Build settings.json
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

  // Build CLAUDE.md
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

  // ── Step 9: Verify installation ─────────────────────────────────────────
  step(9, TOTAL_STEPS, "Verify installation");

  const checks: { label: string; pass: boolean; detail?: string }[] = [];

  // Check ~/.claude symlink or directory
  const claudeDirExists = existsSync(CLAUDE_DIR);
  checks.push({ label: "~/.claude/ exists", pass: claudeDirExists });

  // Check settings.json
  const settingsExists = existsSync(join(paiDir, "settings.json"));
  checks.push({ label: "settings.json", pass: settingsExists });

  // Check CLAUDE.md
  const claudeMdExists = existsSync(join(paiDir, "CLAUDE.md"));
  checks.push({ label: "CLAUDE.md", pass: claudeMdExists });

  // Check identity.jsonc
  const identityExists = existsSync(join(paiDir, "config", "identity.jsonc"));
  checks.push({ label: "config/identity.jsonc", pass: identityExists });

  // Check hooks directory
  const hooksExist = existsSync(join(paiDir, "hooks", "lib", "run-hook.sh"));
  checks.push({ label: "hooks/lib/run-hook.sh", pass: hooksExist });

  // Check node_modules
  const depsInstalled = existsSync(join(paiDir, "node_modules"));
  checks.push({ label: "dependencies installed", pass: depsInstalled });

  // Check ABOUTME.md is not just placeholders
  const aboutMeReady = existsSync(aboutMePath) && !readFileSync(aboutMePath, "utf-8").includes("[Your Name]");
  checks.push({ label: "ABOUTME.md personalized", pass: aboutMeReady });

  // Check Claude Code available
  checks.push({ label: "Claude Code CLI", pass: claudeInstalled });

  console.log();
  let allPass = true;
  for (const c of checks) {
    if (c.pass) {
      ok(`${c.label}${c.detail ? `  ${DIM}${c.detail}${RESET}` : ""}`);
    } else {
      warn(`${c.label}${c.detail ? `  ${DIM}${c.detail}${RESET}` : ""}`);
      allPass = false;
    }
  }

  // ── Done ───────────────────────────────────────────────────────────────
  console.log(`\n${STEEL}─────────────────────────────────────────────────${RESET}`);
  if (allPass) {
    console.log(`\n  ${GREEN}${BOLD}KAI installed successfully!${RESET}  ${DIM}(${checks.length}/${checks.length} checks pass)${RESET}\n`);
  } else {
    const passCount = checks.filter(c => c.pass).length;
    console.log(`\n  ${YELLOW}${BOLD}KAI installed with warnings${RESET}  ${DIM}(${passCount}/${checks.length} checks pass)${RESET}\n`);
  }
  console.log(`  ${DIM}Start a new Claude Code session to activate.${RESET}`);
  console.log(`  ${DIM}Board: bun ~/.claude/scripts/board.ts${RESET}\n`);
}

if (import.meta.main) {
  main().catch(e => {
    console.error(`\n  ${RED}✗${RESET} ${e.message}`);
    process.exit(1);
  });
}
