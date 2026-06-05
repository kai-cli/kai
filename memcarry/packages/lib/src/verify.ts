/**
 * Verify-at-load orchestrator — the resumption fix (ARCHITECTURE.md §4, §11 #3,#9,#16).
 *
 * Critical design (solves the SessionStart-hang while still verifying):
 *  - SessionStart injects the CACHED resume-state IMMEDIATELY (zero blocking probes).
 *  - Probes run with a hard total budget (~800ms) in PARALLEL, each with its own timeout.
 *  - Results are written to a per-(project,session) DRIFT FILE. The NEXT UserPromptSubmit reads it
 *    and surfaces drift. This is the cross-hook handoff (the riskiest-unknown #2 from build review).
 *  - Drift is ANNOTATED, never silently rewritten (§11 #16). Auto-rewrite only on VERIFIED drift.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  probeGitBranch,
  probeGhPr,
  probePing,
  probeSsh,
  type ProbeResult,
} from "./probes.js";
import type { ResumeStateAtom, VerifiableFact } from "./schema.js";

export interface DriftEntry {
  kind: VerifiableFact["kind"];
  recorded: string;
  state: ProbeResult["state"];
  observed?: string;
  reason?: string;
}

export interface DriftFile {
  project: string;
  session_id: string | null;
  atom_id: string;
  branch_ok: boolean; // false => origin branch mismatch, refuse-to-present
  completed: boolean; // false => probes still running / never finished
  entries: DriftEntry[];
  written_at: string;
}

/** Where the SessionStart→UserPromptSubmit drift handoff lives (per project+session). */
export function driftFilePath(project: string, sessionId: string | null): string {
  const dir = join(tmpdir(), "memcarry-drift");
  mkdirSync(dir, { recursive: true });
  const sid = (sessionId ?? "nosession").replace(/[^A-Za-z0-9._-]/g, "-");
  const proj = project.replace(/[^A-Za-z0-9._-]/g, "-");
  return join(dir, `${proj}__${sid}.json`);
}

/** Map a fact + the host hint (for ping/ssh) to its probe. */
async function probeFact(
  fact: VerifiableFact,
  repoPath: string,
  ghSlug: string | undefined,
  host: string | undefined,
  budgetMs: number
): Promise<DriftEntry> {
  let r: ProbeResult;
  switch (fact.kind) {
    case "git-branch":
      r = await probeGitBranch(repoPath, fact.recorded, Math.min(200, budgetMs));
      break;
    case "gh-pr":
      if (!ghSlug) r = { state: "indeterminate", reason: "no repo slug for gh-pr probe" };
      else r = await probeGhPr(ghSlug, fact.recorded.replace(/\D/g, "") || "0", "merged", Math.min(1500, budgetMs));
      break;
    case "ping":
      r = await probePing(host ?? fact.recorded, Math.min(500, budgetMs));
      break;
    case "ssh":
      r = await probeSsh(host ?? fact.recorded, Math.min(1500, budgetMs));
      break;
    default:
      r = { state: "indeterminate", reason: "unknown probe kind" };
  }
  return { kind: fact.kind, recorded: fact.recorded, state: r.state, observed: r.observed, reason: r.reason };
}

/**
 * Run verification under a hard total budget. Whatever hasn't resolved by the deadline is marked
 * indeterminate("budget exhausted"). Writes the drift file atomically. NEVER throws.
 */
export async function verifyAndWriteDrift(
  atom: ResumeStateAtom,
  opts: {
    currentBranch: string | null;
    /** LIVE session id — the drift file is keyed by this so THIS session's next prompt finds it.
     *  NOT the atom's stored origin.session_id (that's the old capture session). */
    sessionId?: string | null;
    ghSlug?: string;
    host?: string;
    totalBudgetMs?: number;
  }
): Promise<DriftFile> {
  const totalBudget = opts.totalBudgetMs ?? 800;
  const sessionKey = opts.sessionId ?? atom.origin.session_id;
  const branchOk = !atom.origin.branch || !opts.currentBranch || atom.origin.branch === opts.currentBranch;

  const deadline = Promise.race([
    Promise.allSettled(
      atom.verified_facts.map((f) =>
        probeFact(f, atom.origin.repo_path, opts.ghSlug, opts.host, totalBudget)
      )
    ),
    new Promise<"timeout">((res) => setTimeout(() => res("timeout"), totalBudget)),
  ]);

  const settled = await deadline;
  let entries: DriftEntry[];
  let completed: boolean;
  if (settled === "timeout") {
    entries = atom.verified_facts.map((f) => ({
      kind: f.kind,
      recorded: f.recorded,
      state: "indeterminate" as const,
      reason: "budget exhausted",
    }));
    completed = false;
  } else {
    entries = settled.map((s, i) =>
      s.status === "fulfilled"
        ? s.value
        : {
            kind: atom.verified_facts[i]!.kind,
            recorded: atom.verified_facts[i]!.recorded,
            state: "indeterminate" as const,
            reason: "probe error",
          }
    );
    completed = true;
  }

  const drift: DriftFile = {
    project: atom.scope.replace("project:", ""),
    session_id: sessionKey,
    atom_id: atom.id,
    branch_ok: branchOk,
    completed,
    entries,
    written_at: new Date().toISOString(),
  };

  const path = driftFilePath(drift.project, sessionKey);
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(drift, null, 2), "utf8");
  renameSync(tmp, path);
  return drift;
}

/** Read + consume the drift file (read-once: deletes after reading so it surfaces only once). */
export function consumeDrift(project: string, sessionId: string | null): DriftFile | null {
  const path = driftFilePath(project, sessionId);
  if (!existsSync(path)) return null;
  try {
    const drift = JSON.parse(readFileSync(path, "utf8")) as DriftFile;
    rmSync(path, { force: true });
    return drift;
  } catch {
    rmSync(path, { force: true });
    return null;
  }
}

/** Render drift as human/LLM-facing annotation text. ANNOTATE, never rewrite (§11 #16). */
export function renderDrift(drift: DriftFile, recordedNext: string): string | null {
  if (!drift.branch_ok) {
    return `⚠ Resume mismatch: this resume-state was captured on a different branch than the one checked out. Not presenting its cursor to avoid acting on stale state.`;
  }
  const drifted = drift.entries.filter((e) => e.state === "drifted");
  const indet = drift.entries.filter((e) => e.state === "indeterminate");
  if (!drifted.length && !indet.length) return null; // all verified, nothing to surface

  const lines: string[] = [];
  for (const e of drifted) {
    lines.push(`• ${e.kind}: recorded "${e.recorded}", observed "${e.observed}" (VERIFIED drift)`);
  }
  for (const e of indet) {
    lines.push(`• ${e.kind}: could not verify "${e.recorded}" — ${e.reason} (treat as unknown, not changed)`);
  }
  return (
    `Resume verification for the cursor "${recordedNext}":\n${lines.join("\n")}\n` +
    `(Drift is reported, not auto-applied. Confirm before acting on changed items.)`
  );
}
