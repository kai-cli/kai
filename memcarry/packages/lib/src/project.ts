/**
 * Project + worktree resolution. Resolve EXACTLY ONE active project from cwd/CLAUDE_PROJECT_DIR
 * (never iterate the 32 projects — §11 #20). Reuses Claude Code's path encoding (every non-alphanumeric
 * char → '-') so we match `Du_tracking` / `TR-069_TR-369` / the dotted username the same way the live
 * MemoryRecall hook does.
 */
import { execFileSync } from "node:child_process";
import { basename } from "node:path";

export interface ActiveProject {
  /** project name = basename of the git toplevel (or CLAUDE_PROJECT_DIR) */
  name: string;
  /** absolute repo path — probes run with explicit -C this */
  repoPath: string;
  /** current branch, or null if not a git repo / detached */
  branch: string | null;
  /** worktree id (git common dir differs from gitdir in a linked worktree), or null */
  worktree: string | null;
}

/**
 * Claude Code names `projects/<dir>` by replacing EVERY non-alphanumeric char with '-'.
 * The old `/[/_]/` form left the '.' in the username (and spaces) intact, computed a
 * nonexistent store dir, and silently fell back to global memory — the bug that broke
 * all per-project recall. Match the live hook's canonical encoder exactly.
 */
export function encodeProjectDir(absPath: string): string {
  return absPath.replace(/[^a-zA-Z0-9]/g, "-");
}

function safeGit(repoPath: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", repoPath, ...args], {
      encoding: "utf8",
      timeout: 300,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Resolve the active project from a starting directory (default: CLAUDE_PROJECT_DIR or cwd).
 * Uses git toplevel as the canonical repo root. Never iterates all projects.
 */
export function resolveActiveProject(startDir?: string): ActiveProject {
  const start = startDir ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const toplevel = safeGit(start, ["rev-parse", "--show-toplevel"]);
  const repoPath = toplevel ?? start;
  const branch = safeGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  // worktree detection: in a linked worktree, --git-common-dir != --git-dir
  const gitDir = safeGit(repoPath, ["rev-parse", "--git-dir"]);
  const commonDir = safeGit(repoPath, ["rev-parse", "--git-common-dir"]);
  const worktree = gitDir && commonDir && gitDir !== commonDir ? basename(repoPath) : null;
  return {
    name: basename(repoPath),
    repoPath,
    branch: branch && branch !== "HEAD" ? branch : null,
    worktree,
  };
}

/**
 * Derive a stable slug from the git remote URL when branch resolution fails (H4).
 * Turns `git@github.com:org/repo.git` / `https://host/org/repo(.git)` → `repo`. Returns null if no remote.
 * This gives non-branch / detached-HEAD dirs a stable id instead of the generic "detached" bucket
 * (~44% of dirs measured). Only consulted in the detached case — branched ids are never affected.
 */
export function remoteSlug(repoPath: string): string | null {
  const url = safeGit(repoPath, ["remote", "get-url", "origin"]);
  if (!url) return null;
  const m = url.match(/([^/:]+?)(?:\.git)?\/?$/);
  const slug = m?.[1]?.replace(/[^A-Za-z0-9._-]/g, "-");
  return slug && slug.length > 0 ? slug : null;
}

/**
 * Stable key for a resume-state atom: project + branch (+ worktree if linked).
 * H4: when there is NO branch (detached HEAD / non-standard), prefer a remote-derived slug over the
 * generic "detached" so distinct repos don't collide in one bucket. Branched ids are byte-identical to
 * before — the fallback only changes the previously-"detached" case.
 */
export function resumeStateId(p: ActiveProject): string {
  let branchPart: string;
  if (p.branch) {
    branchPart = p.branch.replace(/[^A-Za-z0-9._-]/g, "-");
  } else {
    const slug = remoteSlug(p.repoPath);
    branchPart = slug ? `detached-${slug}` : "detached";
  }
  const wtPart = p.worktree ? `_${p.worktree}` : "";
  return `res_${p.name}_${branchPart}${wtPart}`;
}
