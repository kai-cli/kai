/**
 * Project + worktree resolution. Resolve EXACTLY ONE active project from cwd/CLAUDE_PROJECT_DIR
 * (never iterate the 32 projects — §11 #20). Reuses Claude Code's lossy /+_→- path encoding so we
 * match `Du_tracking` / `TR-069_TR-369` the same way the live MemoryRecall hook does.
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

/** Claude Code encodes a project path by replacing / and _ with - (lossy). */
export function encodeProjectDir(absPath: string): string {
  return absPath.replace(/[/_]/g, "-");
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

/** Stable key for a resume-state atom: project + branch (+ worktree if linked). */
export function resumeStateId(p: ActiveProject): string {
  const branchPart = (p.branch ?? "detached").replace(/[^A-Za-z0-9._-]/g, "-");
  const wtPart = p.worktree ? `_${p.worktree}` : "";
  return `res_${p.name}_${branchPart}${wtPart}`;
}
