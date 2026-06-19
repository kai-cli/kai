/**
 * Fast environment status check for session startup.
 * No network calls — just checks env vars and file existence.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";

export interface EnvStatus {
  keys: { set: number; total: number };
  mcp: { configured: number };
  bedrock: boolean;
  critical?: string;
  /** Set when the session started from a parent dir with no project marker — memories route to the catch-all project. */
  cwdWarning?: string;
}

// Project markers that prove a directory is a real project root (not a parent/catch-all dir).
// Deliberately NOT including .claude/ or CLAUDE.md: a `.claude` dir is a side-effect of running
// claude in ANY directory (local settings, scheduled_tasks) — the catch-all parent ~/Projects has
// one, which is exactly the dir that caused the rayhunter loss. Only VCS / package manifests prove
// a real project root.
const PROJECT_MARKERS = [".git", "package.json", "pyproject.toml", "go.mod", "Cargo.toml", "Gemfile", "pom.xml", "build.gradle"];

/**
 * Detect the rayhunter failure mode: a session started from a parent dir (e.g. ~/Projects, ~)
 * with no project marker. Memories saved here route to the catch-all project, invisible to
 * sessions later started inside a real subdirectory. Returns a warning string, or undefined if safe.
 *
 * Conservative by design (ISC-A3): only warns for the HOME dir or an immediate child of it that
 * lacks every project marker. A real project dir (has .git/.claude/etc.) is always silent, even
 * if it lives directly under ~. Avoids nagging legitimate sessions.
 */
export function detectCwdMismatch(cwd: string, home: string): string | undefined {
  if (!cwd || !home) return undefined;
  const norm = (p: string) => p.replace(/\/+$/, "");
  const c = norm(cwd);
  const h = norm(home);

  // Has any project marker → it's a real project root, always safe.
  for (const marker of PROJECT_MARKERS) {
    if (existsSync(join(c, marker))) return undefined;
  }

  // HOME itself, or an immediate child of HOME (e.g. ~/Projects), with no marker → catch-all risk.
  const isHome = c === h;
  const isImmediateChildOfHome = c.startsWith(h + "/") && !c.slice(h.length + 1).includes("/");
  if (!isHome && !isImmediateChildOfHome) return undefined;

  const where = isHome ? "your home directory" : `a parent directory (${c})`;
  return `⚠️ Session started from ${where} — it has no project marker (.git/package.json/etc.). ` +
    `Memories saved this session will route to the catch-all project, NOT a specific project, and ` +
    `will be invisible to sessions started inside a project subdirectory. ` +
    `If you meant to work on a project, exit and restart with \`cd <project> && claude\`.`;
}

export function checkEnvironment(paiDir: string, cwd?: string): EnvStatus {
  const keyNames = [
    "ANTHROPIC_API_KEY", "GITHUB_TOKEN", "OPENAI_API_KEY", "GEMINI_API_KEY",
    "XAI_API_KEY", "PERPLEXITY_API_KEY", "DEEPSEEK_API_KEY", "MISTRAL_API_KEY",
  ];

  const set = keyNames.filter(k => !!process.env[k]).length;

  let mcpCount = 0;
  try {
    const settingsPath = join(paiDir, "settings.json");
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      mcpCount = Object.keys(settings.mcpServers ?? {}).length;
    }
  } catch { /* ignore */ }

  const bedrock = !!process.env.CLAUDE_CODE_USE_BEDROCK;

  let critical: string | undefined;
  if (!process.env.ANTHROPIC_API_KEY && !bedrock) {
    critical = "ANTHROPIC_API_KEY not set — run `bun ~/.claude/scripts/kai-keys.ts add` or check ~/.zshrc";
  }

  const cwdWarning = cwd ? detectCwdMismatch(cwd, process.env.HOME ?? "") : undefined;

  return { keys: { set, total: keyNames.length }, mcp: { configured: mcpCount }, bedrock, critical, cwdWarning };
}

export function formatStatus(status: EnvStatus): string {
  const keyPart = `🔑 Keys: ${status.keys.set}/${status.keys.total} active`;
  const mcpPart = `🔌 MCP: ${status.mcp.configured} configured`;
  const apiPart = status.bedrock ? "⚡ Bedrock" : "⚡ Direct API";
  return `${keyPart} | ${mcpPart} | ${apiPart}`;
}
