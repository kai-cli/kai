/**
 * Fast environment status check for session startup.
 * No network calls — just checks env vars and file existence.
 */

import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

export interface EnvStatus {
  keys: { set: number; total: number };
  mcp: { configured: number };
  bedrock: boolean;
  critical?: string;
  /** Set when the session started from a parent dir with no project marker — memories route to the catch-all project. */
  cwdWarning?: string;
  /** Set when the live PAI checkout is not on/synced with the expected stable branch. */
  liveCheckoutWarning?: string;
}

// Project markers that prove a directory is a real project root (not a parent/catch-all dir).
// Deliberately NOT including .claude/ or CLAUDE.md: a `.claude` dir is a side-effect of running
// claude in ANY directory (local settings, scheduled_tasks) — the catch-all parent ~/Projects has
// one, which is exactly the dir that caused the rayhunter loss. Only VCS / package manifests prove
// a real project root.
// `.pai-project` is an explicit sentinel for non-VCS project leaves (e.g. a planning/docs folder
// that is not a git repo): dropping an empty `.pai-project` file marks it as a real project root so
// sessions started there stay silent, while marker-less domain containers still warn. This is what
// makes a nested workspace (~/Projects/<Domain>/<project>) safe — see detectCwdMismatch below.
const PROJECT_MARKERS = [".git", ".pai-project", "package.json", "pyproject.toml", "go.mod", "Cargo.toml", "Gemfile", "pom.xml", "build.gradle"];

/**
 * Detect the rayhunter failure mode: a session started from a parent dir (e.g. ~/Projects, ~)
 * with no project marker. Memories saved here route to the catch-all project, invisible to
 * sessions later started inside a real subdirectory. Returns a warning string, or undefined if safe.
 *
 * Conservative by design (ISC-A3): warns for the HOME dir, or for ~/Projects and ANY directory
 * beneath it that lacks every project marker — this covers nested domain containers like
 * ~/Projects/LinksysPrograms (depth ≥ 2), which the original immediate-child-only check missed
 * and which a workspace reorg into domain folders would otherwise silently re-arm as catch-alls.
 * A real project dir (has .git or a .pai-project sentinel) is always silent, at any depth.
 * Anything outside the ~/Projects tree (and not HOME itself) is silent. Avoids nagging legit sessions.
 */
export function detectCwdMismatch(cwd: string, home: string): string | undefined {
  if (!cwd || !home) return undefined;
  const norm = (p: string) => p.replace(/\/+$/, "");
  const c = norm(cwd);
  const h = norm(home);

  // Has any project marker → it's a real project root, always safe (at any depth).
  for (const marker of PROJECT_MARKERS) {
    if (existsSync(join(c, marker))) return undefined;
  }

  // HOME itself, or ~/Projects and anything below it, with no marker → catch-all risk.
  const isHome = c === h;
  const projectsRoot = h + "/Projects";
  const isProjectsTree = c === projectsRoot || c.startsWith(projectsRoot + "/");
  if (!isHome && !isProjectsTree) return undefined;

  const where = isHome ? "your home directory" : `a non-project directory (${c})`;
  return `⚠️ Session started from ${where} — it has no project marker (.git/package.json/etc.). ` +
    `Memories saved this session will route to the catch-all project, NOT a specific project, and ` +
    `will be invisible to sessions started inside a project subdirectory. ` +
    `If you meant to work on a project, exit and restart with \`cd <project> && claude\`.`;
}

interface GitBranchState {
  branch?: string;
  upstream?: string;
  ahead: number;
  behind: number;
}

function parseGitBranchState(output: string): GitBranchState {
  const state: GitBranchState = { ahead: 0, behind: 0 };
  for (const line of output.split("\n")) {
    if (line.startsWith("# branch.head ")) {
      state.branch = line.slice("# branch.head ".length).trim();
    } else if (line.startsWith("# branch.upstream ")) {
      state.upstream = line.slice("# branch.upstream ".length).trim();
    } else if (line.startsWith("# branch.ab ")) {
      const match = line.match(/\+(\d+)\s+-(\d+)/);
      if (match) {
        state.ahead = Number(match[1]);
        state.behind = Number(match[2]);
      }
    }
  }
  return state;
}

/**
 * Detect the live-install drift that caused Claude to run from an old PR branch.
 * Read-only and local-only: no fetch/network. It uses the currently fetched upstream
 * refs, so "behind" means "behind the last known origin/main", not live GitHub.
 */
export function detectLiveCheckoutDrift(paiDir: string, expectedBranch = "main"): string | undefined {
  if (!paiDir || !existsSync(join(paiDir, ".git"))) return undefined;

  let state: GitBranchState;
  try {
    const out = execFileSync("git", ["-C", paiDir, "status", "--porcelain=v2", "--branch", "--untracked-files=no"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 750,
    });
    state = parseGitBranchState(out);
  } catch {
    return undefined;
  }

  const branch = state.branch;
  if (!branch || branch === "(detached)") {
    return `⚠️ PAI live checkout is detached or unknown — expected branch \`${expectedBranch}\`. ` +
      `Claude may be running hooks from an unexpected commit.`;
  }

  const problems: string[] = [];
  if (branch !== expectedBranch) problems.push(`on \`${branch}\``);
  if (state.behind > 0) problems.push(`${state.behind} commit(s) behind ${state.upstream ?? `origin/${expectedBranch}`}`);
  if (state.ahead > 0) problems.push(`${state.ahead} local commit(s) ahead of ${state.upstream ?? `origin/${expectedBranch}`}`);

  if (problems.length === 0) return undefined;
  return `⚠️ PAI live checkout drift: ${problems.join(", ")}; expected clean/synced \`${expectedBranch}\`. ` +
    `Keep the live install on main and do feature work in a separate clone.`;
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
  const liveCheckoutWarning = detectLiveCheckoutDrift(paiDir, process.env.PAI_EXPECTED_BRANCH ?? "main");

  return { keys: { set, total: keyNames.length }, mcp: { configured: mcpCount }, bedrock, critical, cwdWarning, liveCheckoutWarning };
}

export function formatStatus(status: EnvStatus): string {
  const keyPart = `🔑 Keys: ${status.keys.set}/${status.keys.total} active`;
  const mcpPart = `🔌 MCP: ${status.mcp.configured} configured`;
  const apiPart = status.bedrock ? "⚡ Bedrock" : "⚡ Direct API";
  return `${keyPart} | ${mcpPart} | ${apiPart}`;
}
