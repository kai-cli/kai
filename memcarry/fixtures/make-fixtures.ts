#!/usr/bin/env bun
/**
 * Generate Phase-0 fixture atoms (the exit proof):
 *  1. The PROVEN duplicate pair (never_hand_edit_patches.md existed in BOTH feed-bbf AND Du-tracking)
 *     collapsed into ONE scope:global lesson — the duplicate pain visibly killed by a scope choice.
 *  2. A real feed-bbf resume-state reconstructed from the Phase −1 session (PR #81, issue #358).
 */
import { writeAtom, type LessonAtom, type ResumeStateAtom, assertClaimFits, renderClaim } from "../packages/lib/src/index.js";
import { join } from "node:path";

const STORE = join(import.meta.dir, "..", "store");
const NOW = "2026-06-04T06:46:20Z";
// Generic home — keep fixtures free of personal paths (public-repo PII guard).
const HOME = process.env.HOME ?? "/home/user";

const lesson: LessonAtom = {
  type: "lesson",
  id: "lsn_never_hand_edit_patches",
  scope: "global", // <-- was duplicated in feed-bbf AND Du-tracking; now ONE global copy
  provenance: "human-confirmed",
  trigger: ["patch", "quilt", "overlay", ".patch", "hunk"],
  created: NOW,
  updated: NOW,
  claim: {
    when: "editing an existing .patch file in a feed",
    do: "edit the source via git overlay/quilt then regenerate the patch — never hand-edit",
    because: "hand-editing corrupts hunk counts/context and broke build #62 (learned twice: feed-bbf + Du)",
  },
  detail:
    "Originally captured as feedback_never_hand_edit_patches.md in BOTH feed-bbf and Du-tracking " +
    "memory stores — the canonical proof of the duplicate-file problem this system kills.",
  last_used: null,
  use_count: 0,
};

const resume: ResumeStateAtom = {
  type: "resume-state",
  id: "res_feed-bbf_release_v1.1",
  scope: "project:feed-bbf",
  provenance: "auto-captured",
  trigger: [],
  created: NOW,
  updated: NOW,
  origin: {
    repo_path: `${HOME}/Projects/feed-bbf`,
    branch: "release_v1.1",
    worktree: null,
    session_id: "9763b0b3-efb9-41d8-9faf-b239c4625338",
    write_ts: NOW,
  },
  next: "Confirm PR #81 merged cleanly; then verify ExampleWRT#358 (Dev AP-enable) closed.",
  summary: "Merged PR #81 (fixes #358); was documenting the Jenkins-v2 build migration.",
  verified_facts: [
    { kind: "gh-pr", recorded: "merged", state: "unverified" }, // probe fills this at load
    { kind: "git-branch", recorded: "release_v1.1", state: "unverified" },
  ],
  beliefs: [
    {
      text: "trigger_build POST fails on Jenkins 2.222.4; use buildWithParameters with BUILD_TYPE=release (not dev).",
      status: "conclusion",
      evidence: "Illegal choice for parameter BUILD_TYPE: dev; build #71 used release",
      as_of: NOW,
    },
  ],
  blockers: [],
  also_touched: [
    `${HOME}/Projects/YourCompany-Wiki`,
    `${HOME}/.claude`, // skill edits
  ],
};

assertClaimFits(lesson.claim);
const p1 = writeAtom(STORE, lesson);
const p2 = writeAtom(STORE, resume);
console.log("wrote lesson:", p1);
console.log("  claim:", renderClaim(lesson.claim), `(${renderClaim(lesson.claim).length} chars)`);
console.log("wrote resume:", p2);
