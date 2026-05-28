#!/usr/bin/env bun
/**
 * KAI Deployment Packager
 *
 * Creates a distributable KAI package for coworker machines.
 * Includes all system components, strips personal data,
 * creates USER scaffolding with placeholders.
 *
 * Usage:
 *   bun run deploy.ts                    # Build package
 *   bun run deploy.ts --output ~/Desktop # Custom output dir
 *   bun run deploy.ts --dry-run          # Show what would be included
 */

import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, statSync } from "fs";
import { readdir, cp, stat } from "fs/promises";
import { join, basename, relative, dirname } from "path";
import { execSync } from "child_process";

const HOME = process.env.HOME!;
const PAI_ROOT = join(HOME, ".claude");
const _manifestRaw = existsSync(join(PAI_ROOT, "manifest.json"))
  ? JSON.parse(readFileSync(join(PAI_ROOT, "manifest.json"), "utf-8"))
  : null;
const VERSION: string = _manifestRaw?.version ?? "unknown";

// --- CLI args ---
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const outputIdx = args.indexOf("--output");
const outputDir = outputIdx >= 0 ? args[outputIdx + 1] : join(HOME, "Desktop");

// --- Colors ---
const BLUE = "\x1b[38;2;59;130;246m";
const GREEN = "\x1b[38;2;34;197;94m";
const YELLOW = "\x1b[38;2;234;179;8m";
const RED = "\x1b[38;2;239;68;68m";
const GRAY = "\x1b[38;2;100;116;139m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

const info = (msg: string) => console.log(`  ${BLUE}i${RESET} ${msg}`);
const ok = (msg: string) => console.log(`  ${GREEN}+${RESET} ${msg}`);
const warn = (msg: string) => console.log(`  ${YELLOW}!${RESET} ${msg}`);
const err = (msg: string) => console.log(`  ${RED}x${RESET} ${msg}`);

// --- What to include ---
interface CopySpec {
  src: string;       // relative to PAI_ROOT
  dest?: string;     // relative to package root (defaults to src)
  exclude?: string[]; // patterns to skip
  required?: boolean;
}

const INCLUDE: CopySpec[] = [
  // Core system
  { src: "PAI/Algorithm", required: true },
  { src: "PAI/ACTIONS", required: false },
  { src: "PAI/ACTIONS.md", required: false },
  { src: "PAI/AISTEERINGRULES.md", required: true },
  { src: "PAI/CLI.md", required: false },
  { src: "PAI/CLIFIRSTARCHITECTURE.md", required: false },
  { src: "PAI/CONTEXT_ROUTING.md", required: true },
  { src: "PAI/DOCUMENTATIONINDEX.md", required: false },
  { src: "PAI/FLOWS", required: false },
  { src: "PAI/FLOWS.md", required: false },
  { src: "PAI/MEMORYSYSTEM.md", required: false },
  { src: "PAI/MEMORY-CHANGELOG.md", required: false },
  { src: "PAI/PAIAGENTSYSTEM.md", required: false },
  { src: "PAI/PAISYSTEMARCHITECTURE.md", required: false },
  { src: "PAI/PIPELINES", required: false },
  { src: "PAI/PIPELINES.md", required: false },
  { src: "PAI/PRDFORMAT.md", required: true },
  { src: "PAI/README.md", required: false },
  { src: "PAI/SKILL.md", required: false },
  { src: "PAI/SKILLSYSTEM.md", required: false },
  { src: "PAI/SYSTEM_USER_EXTENDABILITY.md", required: false },
  { src: "PAI/THEDELEGATIONSYSTEM.md", required: false },
  { src: "PAI/THEFABRICSYSTEM.md", required: false },
  { src: "PAI/THEHOOKSYSTEM.md", required: false },
  { src: "PAI/THENOTIFICATIONSYSTEM.md", required: false },
  { src: "PAI/Tools", required: false },
  { src: "PAI/TOOLS.md", required: false },
  { src: "PAI/doc-dependencies.json", required: false },
  { src: "PAI/dev", required: false },

  // Hooks (all)
  { src: "hooks", required: true, exclude: ["node_modules"] },

  // Skills (all, excluding personal USER data and runtime state)
  { src: "skills", required: true, exclude: ["node_modules", "USER", "Logs", "State"] },

  // Agents (all)
  { src: "agents", required: true },

  // Custom agents
  { src: "custom-agents", required: false },

  // Scripts (board, ralph-loop)
  { src: "scripts", required: true, exclude: ["node_modules"] },

  // Config domain files
  { src: "config", required: true },

  // Libs
  { src: "lib", required: false },

  // Templates
  { src: "CLAUDE.md.template", required: true },

  // Installer
  { src: "install.sh", required: true },

  // Manifest
  { src: "manifest.json", required: false },

  // README
  { src: "README.md", required: false },

  // Gitignore
  { src: ".gitignore", required: false },

  // Statusline
  { src: "statusline.ts", required: false },

  // Tests
  { src: "tests", required: false },

  // VoiceServer
  { src: "VoiceServer", required: false, exclude: ["node_modules"] },
];

// Files that need personal data stripped
const TEMPLATE_FILES: Record<string, (content: string) => string> = {
  "PAI/CONTEXT_ROUTING.md": (c) => c, // System file, no personal data
  "PAI/AISTEERINGRULES.md": stripPersonalRules,
};

// --- Helpers ---

function stripPersonalRules(content: string): string {
  // Keep SYSTEM rules, replace personal section with placeholder
  const marker = "# AI Steering Rules — Personal";
  const idx = content.indexOf(marker);
  if (idx < 0) return content;
  return content.slice(0, idx) + `# AI Steering Rules — Personal

Personal behavioral rules. Edit this section to add your own rules.
See SYSTEM rules above for format and examples.

<!-- Add your rules here -->
`;
}

async function copyRecursive(src: string, dest: string, exclude: string[] = []): Promise<number> {
  let count = 0;

  if (!existsSync(src)) return 0;

  const s = statSync(src);
  if (s.isFile()) {
    const dir = dirname(dest);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    copyFileSync(src, dest);
    return 1;
  }

  if (!s.isDirectory()) return 0;

  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (exclude.includes(entry.name)) continue;
    if (entry.name === ".DS_Store") continue;

    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      count += await copyRecursive(srcPath, destPath, exclude);
    } else {
      const dir = dirname(destPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      copyFileSync(srcPath, destPath);
      count++;
    }
  }
  return count;
}

function dirSize(path: string): number {
  try {
    const out = execSync(`du -sk "${path}" 2>/dev/null`, { encoding: "utf-8" });
    return parseInt(out.split("\t")[0]) * 1024;
  } catch { return 0; }
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

// --- USER scaffold ---
const USER_SCAFFOLD: Record<string, string> = {
  "PAI/USER/README.md": `# PAI User Configuration

This directory contains your personal PAI configuration.
Edit these files to customize PAI for your workflow.

## Getting Started

1. Edit IDENTITY.md with your name and role
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

  "PAI/USER/DAIDENTITY.md": `# Digital Assistant Identity

<!-- Configure your AI assistant's personality -->
Name: KAI
Personality: Professional, direct, technically capable
`,

  "PAI/USER/DEFINITIONS.md": `# Definitions

<!-- Add project-specific terminology and acronyms -->
`,

  "PAI/USER/RESPONSEFORMAT.md": `# Response Format Preferences

<!-- Configure how you want AI responses formatted -->
`,

  "PAI/USER/TECHSTACKPREFERENCES.md": `# Tech Stack Preferences

<!-- List your preferred tools, languages, and frameworks -->
Language: TypeScript
Runtime: Bun
Package Manager: bun
`,

  "PAI/USER/TELOS/README.md": `# TELOS — Life Operating System

Configure your goals, projects, and life context here.
See PAI documentation for TELOS file format.
`,

  "PAI/USER/PROJECTS/README.md": `# Projects

Track your active projects here.
`,
};

// --- Settings template ---
function createSettingsTemplate(): string {
  try {
    const raw = readFileSync(join(PAI_ROOT, "settings.json"), "utf-8");
    const settings = JSON.parse(raw);

    // Strip personal identity from env additions
    if (settings.env) {
      // Keep structure, clear personal values
      for (const key of Object.keys(settings.env)) {
        if (key.includes("NAME") || key.includes("IDENTITY")) {
          settings.env[key] = "[CONFIGURE]";
        }
      }
    }

    return JSON.stringify(settings, null, 2);
  } catch {
    return "{}";
  }
}

// --- Board config template ---
function createBoardConfigTemplate(): string {
  return JSON.stringify({
    port: 3333,
    scanDirs: ["~/.claude/MEMORY/WORK"],
    projectsDir: "~/Projects",
    autoDiscover: true,
    ignored: ["node_modules", ".git", "__pycache__", ".venv"],
    library: [],
    archived: [],
    ralphLoop: {
      defaultBudget: 5,
      defaultMaxIterations: 5,
      defaultModel: "opus",
    },
    docker: {
      enabled: true,
      image: "oven/bun:latest",
      memoryLimit: "2g",
      cpuLimit: "2.0",
      timeout: 1800,
    },
  }, null, 2) + "\n";
}

// --- .env template ---
const ENV_TEMPLATE = `# KAI Environment Configuration
# Add your API keys here

# Required for Research skill
# PERPLEXITY_API_KEY=pplx-...

# Optional: Gemini research
# GEMINI_API_KEY=...

# Optional: Grok research
# GROK_API_KEY=...

# Optional: OpenAI (for GPT-image, Codex)
# OPENAI_API_KEY=sk-...

# Optional: Apify (web scraping)
# APIFY_API_KEY=apify_api_...

# Optional: BrightData (proxy scraping)
# BRIGHTDATA_API_KEY=...
`;

// --- Main ---
async function main() {
  console.log(`\n${BOLD}KAI Deployment Packager v${VERSION}${RESET}\n`);

  const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const pkgName = `kai-${VERSION}-${timestamp}`;
  const pkgDir = join(outputDir, pkgName);
  const tarball = `${pkgDir}.tar.gz`;

  if (dryRun) {
    info("DRY RUN — showing what would be packaged\n");
  } else {
    info(`Building package: ${pkgName}`);
    info(`Output: ${outputDir}\n`);
  }

  // Validate source
  if (!existsSync(PAI_ROOT)) {
    err(`PAI root not found: ${PAI_ROOT}`);
    process.exit(1);
  }

  if (dryRun) {
    console.log(`${BOLD}Components:${RESET}`);
    for (const spec of INCLUDE) {
      const srcPath = join(PAI_ROOT, spec.src);
      const exists = existsSync(srcPath);
      const size = exists ? humanSize(dirSize(srcPath)) : "0";
      const status = exists ? `${GREEN}found${RESET}` : (spec.required ? `${RED}MISSING${RESET}` : `${GRAY}skip${RESET}`);
      console.log(`  ${status}  ${spec.src.padEnd(30)} ${size}`);
    }
    console.log(`\n${BOLD}USER scaffold:${RESET} ${Object.keys(USER_SCAFFOLD).length} template files`);
    console.log(`${BOLD}Settings:${RESET} template (personal data stripped)`);
    console.log(`${BOLD}Board config:${RESET} clean defaults`);
    console.log(`${BOLD}.env:${RESET} template with placeholders`);
    return;
  }

  // Create package directory
  if (existsSync(pkgDir)) {
    err(`Package directory already exists: ${pkgDir}`);
    process.exit(1);
  }
  mkdirSync(pkgDir, { recursive: true });

  let totalFiles = 0;

  // Copy system components
  for (const spec of INCLUDE) {
    const srcPath = join(PAI_ROOT, spec.src);
    const destPath = join(pkgDir, spec.dest || spec.src);

    if (!existsSync(srcPath)) {
      if (spec.required) {
        warn(`Required component missing: ${spec.src}`);
      }
      continue;
    }

    const count = await copyRecursive(srcPath, destPath, spec.exclude || []);
    totalFiles += count;
    ok(`${spec.src} (${count} files)`);
  }

  // Apply template transforms (strip personal data from specific files)
  for (const [relPath, transform] of Object.entries(TEMPLATE_FILES)) {
    const filePath = join(pkgDir, relPath);
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, "utf-8");
      const cleaned = transform(content);
      writeFileSync(filePath, cleaned);
      info(`Templated: ${relPath}`);
    }
  }

  // Create USER scaffold
  for (const [relPath, content] of Object.entries(USER_SCAFFOLD)) {
    const filePath = join(pkgDir, relPath);
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, content);
    totalFiles++;
  }
  ok(`USER scaffold (${Object.keys(USER_SCAFFOLD).length} files)`);

  // Settings template
  const settingsContent = createSettingsTemplate();
  writeFileSync(join(pkgDir, "settings.json"), settingsContent);
  totalFiles++;
  ok("settings.json (templated)");

  // Board config template
  writeFileSync(join(pkgDir, "scripts", "board-config.json"), createBoardConfigTemplate());
  ok("board-config.json (clean defaults)");

  // .env template
  writeFileSync(join(pkgDir, ".env.template"), ENV_TEMPLATE);
  totalFiles++;
  ok(".env.template");

  // Create MEMORY directory structure
  const memDirs = ["MEMORY/STATE", "MEMORY/WORK", "MEMORY/DECISIONS", "MEMORY/SNAPSHOTS", "MEMORY/RESEARCH"];
  for (const d of memDirs) {
    const p = join(pkgDir, d);
    mkdirSync(p, { recursive: true });
    writeFileSync(join(p, ".gitkeep"), "");
  }
  ok("MEMORY directory structure");

  // Create quick-start README
  writeFileSync(join(pkgDir, "DEPLOY-README.md"), `# KAI ${VERSION} Deployment Package

## Quick Start

1. **Prerequisites**: macOS or Linux, Claude Code installed
2. **Install Bun** (if not already): \`curl -fsSL https://bun.sh/install | bash\`
3. **Extract**: \`tar xzf ${pkgName}.tar.gz\`
4. **Copy to home**: \`cp -r ${pkgName}/ ~/.claude/\`
5. **Configure**:
   - Copy \`.env.template\` to \`.env\` and add your API keys
   - Edit \`PAI/USER/ABOUTME.md\` with your identity
   - Edit \`PAI/USER/AISTEERINGRULES.md\` with your rules
   - Review \`settings.json\` and adjust preferences
6. **Run installer**: \`bash ~/.claude/install.sh\`
7. **Start board**: \`bun ~/.claude/scripts/board.ts\`

## What's Included

| Component | Count | Description |
|-----------|-------|-------------|
| Algorithm | <!-- KAI:algorithm-version:begin -->v3.14.0<!-- KAI:algorithm-version:end --> | Core reasoning engine |
| Skills | <!-- KAI:counts:skills:begin -->86<!-- KAI:counts:skills:end --> | Research, security, writing, analysis, etc. |
| Hooks | <!-- KAI:counts:hooks:begin -->53<!-- KAI:counts:hooks:end --> | Pre/post tool guards, format enforcement, etc. |
| Agents | <!-- KAI:counts:agents:begin -->20<!-- KAI:counts:agents:end --> | Specialized agent definitions |
| Scripts | 4 | Board, Ralph Loop, deploy |
| Config | 8 | Domain configuration files |

## What's NOT Included (Personal)

- API keys (.env) — create from .env.template
- User identity (PAI/USER/) — scaffold provided, fill in your info
- Session history (MEMORY/) — empty dirs created
- Project-specific memory (projects/) — created per-project

## Board

The KAI Board runs at http://localhost:3333

\`\`\`bash
bun ~/.claude/scripts/board.ts
\`\`\`

Features: Kanban view, active sessions, project library, Ralph Loop trigger,
auto-discovery of ~/Projects/

## Architecture

\`\`\`
~/.claude/
  PAI/           Core system (Algorithm, docs, routing)
  PAI/USER/      Your personal config (identity, rules, contacts)
  hooks/         Pre/PostToolUse guards and automation
  skills/        41 skill packs (Research, Security, Writing...)
  agents/        18 specialized agent definitions
  scripts/       Board, Ralph Loop, deployment
  config/        Domain config files (hooks, permissions, etc.)
  MEMORY/        Session state, work items, decisions
  settings.json  Claude Code settings with PAI hooks
  CLAUDE.md      System prompt (generated from template)
\`\`\`
`);
  totalFiles++;
  ok("DEPLOY-README.md");

  // Package size
  const pkgSize = humanSize(dirSize(pkgDir));
  console.log(`\n${BOLD}Package built:${RESET} ${totalFiles} files, ${pkgSize}`);

  // Create tarball
  info("Creating tarball...");
  execSync(`tar czf "${tarball}" -C "${outputDir}" "${pkgName}"`, { stdio: "pipe" });
  const tarSize = humanSize(statSync(tarball).size);
  ok(`${tarball}`);
  console.log(`\n${BOLD}${GREEN}Done!${RESET} ${tarball} (${tarSize})\n`);

  // Cleanup extracted dir
  execSync(`rm -rf "${pkgDir}"`);
  info("Cleaned up staging directory");
  console.log(`\nDeploy: ${GRAY}tar xzf ${basename(tarball)} && cp -r ${pkgName}/ ~/.claude/${RESET}\n`);
}

main().catch((e) => {
  err(e.message);
  process.exit(1);
});
