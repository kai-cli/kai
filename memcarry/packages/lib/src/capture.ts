/**
 * Auto-capture — draft a resume-state from a session transcript (ARCHITECTURE.md §4, Phase −1).
 *
 * Phase −1 proved: the MECHANICAL cursor (branch/PR/files/also_touched) is reliable; the next/why
 * lives in prose and needs an LLM draft + /end confirm. This module produces the reliable mechanical
 * half and a PLACEHOLDER next/summary tagged for confirmation. The LLM draft + confirm is the
 * adapter's job (it prints to /end output); this lib never blocks or prompts.
 */
import { parseTranscript, isSubstantive, touchedRepos, type MechanicalCapture } from "./transcript.js";
import type { ResumeStateAtom, VerifiableFact } from "./schema.js";
import type { ActiveProject } from "./project.js";
import { resumeStateId } from "./project.js";

export interface CaptureResult {
  substantive: boolean;
  atom?: ResumeStateAtom;
  capture: MechanicalCapture;
}

/**
 * Build a resume-state draft. `ghSlug` (e.g. "yourcompany/feed_bbf") lets us record a gh-pr fact.
 * `next`/`summary` are mechanical placeholders — the adapter overwrites them with an LLM draft the
 * user confirms at /end. Provenance is auto-captured (lowest trust) until confirmed.
 */
export function captureResumeState(
  transcriptPath: string,
  project: ActiveProject,
  opts: { nowIso: string; ghSlug?: string; deviceHost?: string }
): CaptureResult {
  const cap = parseTranscript(transcriptPath);
  if (!isSubstantive(cap)) {
    return { substantive: false, capture: cap };
  }

  const facts: VerifiableFact[] = [];
  if (project.branch) {
    facts.push({ kind: "git-branch", recorded: project.branch, state: "unverified" });
  }
  // Most recent PR ref becomes a gh-pr fact (records "merged" as the common end-state to verify).
  const lastPr = cap.prRefs[cap.prRefs.length - 1];
  if (lastPr && opts.ghSlug) {
    facts.push({ kind: "gh-pr", recorded: lastPr, state: "unverified" });
  }
  if (opts.deviceHost) {
    facts.push({ kind: "ping", recorded: opts.deviceHost, state: "unverified" });
  }

  const prPart = lastPr ? `PR #${lastPr}` : "work";
  const issuePart = cap.issueRefs.length ? ` (refs #${cap.issueRefs[cap.issueRefs.length - 1]})` : "";

  const atom: ResumeStateAtom = {
    type: "resume-state",
    id: resumeStateId(project),
    scope: `project:${project.name}`,
    provenance: "auto-captured",
    trigger: [],
    created: opts.nowIso,
    updated: opts.nowIso,
    origin: {
      repo_path: project.repoPath,
      branch: project.branch ?? "detached",
      worktree: project.worktree,
      session_id: null,
      write_ts: opts.nowIso,
    },
    // PLACEHOLDERS — adapter replaces with LLM draft + user confirm at /end:
    next: `[CONFIRM] continue ${prPart}${issuePart}`,
    summary: `[auto] last on ${prPart}${issuePart}; ${cap.filesTouched.length} files touched`,
    verified_facts: facts,
    beliefs: [],
    blockers: [],
    also_touched: touchedRepos(cap).filter((r) => r !== project.repoPath),
  };

  return { substantive: true, atom, capture: cap };
}
