import { test, expect, describe } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recall } from "./recall.js";
import { findDuplicates } from "./duplicates.js";
import { captureResumeState } from "./capture.js";
import { verifyAndWriteDrift, consumeDrift, renderDrift } from "./verify.js";
import { encodeProjectDir, resolveActiveProject } from "./project.js";
import { writeAtom, readAllAtoms } from "./store.js";
import type { LessonAtom, ResumeStateAtom, Atom } from "./schema.js";

const globalLesson: LessonAtom = {
  type: "lesson", id: "lsn_patch", scope: "global", provenance: "human-confirmed",
  trigger: ["patch", "quilt", "hunk"], created: "2026-06-04T00:00:00Z", updated: "2026-06-04T00:00:00Z",
  claim: { when: "editing a patch file", do: "use quilt then regenerate", because: "hand-edits corrupt hunks" },
  last_used: null, use_count: 0,
};
const projLesson: LessonAtom = {
  type: "lesson", id: "lsn_jenkins", scope: "project:feed-bbf", provenance: "human-confirmed",
  trigger: ["jenkins", "build", "trigger"], created: "2026-06-04T00:00:00Z", updated: "2026-06-04T00:00:00Z",
  claim: { when: "triggering a jenkins build", do: "validate feeds.conf first", because: "broke build 2026-05-22" },
  last_used: null, use_count: 0,
};

describe("recall — cross-project transfer + precondition gate", () => {
  const atoms: Atom[] = [globalLesson, projLesson];

  test("global lesson is recalled from ANY project (the transfer win)", () => {
    const hits = recall(atoms, "I need to edit a patch quilt file", "some-other-project");
    expect(hits.map((h) => h.id)).toContain("lsn_patch");
  });

  test("project lesson only recalled in its own project", () => {
    const inProj = recall(atoms, "trigger a jenkins build", "feed-bbf");
    expect(inProj.map((h) => h.id)).toContain("lsn_jenkins");
    const elsewhere = recall(atoms, "trigger a jenkins build", "other");
    expect(elsewhere.map((h) => h.id)).not.toContain("lsn_jenkins");
  });

  test("precondition gate: irrelevant prompt recalls nothing", () => {
    const hits = recall(atoms, "what is the weather today", "feed-bbf");
    expect(hits.length).toBe(0);
  });
});

describe("duplicates report (read-only, no auto-merge)", () => {
  test("detects the same lesson living in two project scopes", () => {
    const dupA: LessonAtom = { ...globalLesson, id: "d1", scope: "project:feed-bbf" };
    const dupB: LessonAtom = { ...globalLesson, id: "d2", scope: "project:du-tracking" };
    const pairs = findDuplicates([dupA, dupB], 0.6);
    expect(pairs.length).toBe(1);
    expect(pairs[0]!.suggestion).toContain("promote ONE to scope:global");
  });
});

describe("capture (mechanical cursor + F1 gate)", () => {
  const realJsonl = [
    JSON.stringify({ type: "user", message: { content: [{ type: "text", text: "fix build" }] } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "gh pr edit 81 --repo yourcompany/feed_bbf --body 'Fixes #358'" } }] } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "gh pr merge 81 --repo yourcompany/feed_bbf" } }] } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "/Users/x/Projects/feed-bbf/a.c" } }] } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "/Users/x/Projects/YourCompany-Wiki/b.md" } }] } }),
    JSON.stringify({ type: "user", message: { content: [{ type: "text", text: "ship it" }] } }),
  ].join("\n");

  test("drafts a resume-state with cursor + also_touched; next is CONFIRM-tagged", () => {
    const f = join(tmpdir(), `cap-${Date.now()}.jsonl`);
    writeFileSync(f, realJsonl);
    const res = captureResumeState(f, { name: "feed-bbf", repoPath: "/Users/x/Projects/feed-bbf", branch: "release_v1.1", worktree: null }, { nowIso: "2026-06-04T00:00:00Z", ghSlug: "yourcompany/feed_bbf" });
    rmSync(f, { force: true });
    expect(res.substantive).toBe(true);
    expect(res.atom!.next).toContain("[CONFIRM]");
    expect(res.atom!.next).toContain("#81");
    expect(res.atom!.verified_facts.some((v) => v.kind === "gh-pr" && v.recorded === "81")).toBe(true);
    expect(res.atom!.also_touched).toContain("/Users/x/Projects/YourCompany-Wiki");
  });

  test("junk session is not captured (F1)", () => {
    const f = join(tmpdir(), `junk-${Date.now()}.jsonl`);
    writeFileSync(f, JSON.stringify({ type: "ai-title" }));
    const res = captureResumeState(f, { name: "x", repoPath: "/tmp", branch: null, worktree: null }, { nowIso: "2026-06-04T00:00:00Z" });
    rmSync(f, { force: true });
    expect(res.substantive).toBe(false);
  });
});

describe("verify-at-load drift (async, annotate-not-rewrite)", () => {
  const resume: ResumeStateAtom = {
    type: "resume-state", id: "res_x", scope: "project:demo", provenance: "auto-captured",
    trigger: [], created: "2026-06-04T00:00:00Z", updated: "2026-06-04T00:00:00Z",
    origin: { repo_path: "/nonexistent/repo", branch: "main", worktree: null, session_id: "sess1", write_ts: "2026-06-04T00:00:00Z" },
    next: "verify PR merged", summary: "x",
    verified_facts: [{ kind: "git-branch", recorded: "main", state: "unverified" }],
    beliefs: [], blockers: [], also_touched: [],
  };

  test("non-repo path → indeterminate (never drifted), drift file round-trips, consume is read-once", async () => {
    const drift = await verifyAndWriteDrift(resume, { currentBranch: "main", totalBudgetMs: 800 });
    expect(drift.entries[0]!.state).toBe("indeterminate");
    expect(drift.branch_ok).toBe(true);
    const got = consumeDrift("demo", "sess1");
    expect(got).not.toBeNull();
    expect(consumeDrift("demo", "sess1")).toBeNull(); // read-once
    const text = renderDrift(got!, resume.next);
    expect(text).toContain("could not verify");
  });

  test("branch mismatch → refuse-to-present", async () => {
    const drift = await verifyAndWriteDrift(resume, { currentBranch: "different-branch", totalBudgetMs: 800 });
    expect(drift.branch_ok).toBe(false);
    const text = renderDrift(drift, resume.next);
    expect(text).toContain("different branch");
    consumeDrift("demo", "sess1");
  });
});

describe("verify writes drift keyed by LIVE session (not stored session)", () => {
  const resume: ResumeStateAtom = {
    type: "resume-state", id: "res_live", scope: "project:demo2", provenance: "auto-captured",
    trigger: [], created: "2026-06-04T00:00:00Z", updated: "2026-06-04T00:00:00Z",
    origin: { repo_path: "/nonexistent", branch: "main", worktree: null, session_id: "OLD_CAPTURE_SESSION", write_ts: "2026-06-04T00:00:00Z" },
    next: "x", summary: "x",
    verified_facts: [{ kind: "git-branch", recorded: "main", state: "unverified" }],
    beliefs: [], blockers: [], also_touched: [],
  };

  test("drift is found by the LIVE session key, not the atom's stored capture session", async () => {
    await verifyAndWriteDrift(resume, { currentBranch: "main", sessionId: "LIVE_SESSION_XYZ", totalBudgetMs: 800 });
    // stored session must NOT find it
    expect(consumeDrift("demo2", "OLD_CAPTURE_SESSION")).toBeNull();
    // live session must find it (then consume)
    const got = consumeDrift("demo2", "LIVE_SESSION_XYZ");
    expect(got).not.toBeNull();
    expect(got!.session_id).toBe("LIVE_SESSION_XYZ");
  });
});

describe("worktree concurrency — no clobber (parallel-worktree guarantee)", () => {
  test("two worktrees on different branches get DISTINCT ids and both persist (no clobber)", () => {
    const root = mkdtempSync(join(tmpdir(), "wtstore-"));
    try {
      const mk = (branch: string, wt: string): ResumeStateAtom => ({
        type: "resume-state", id: `res_proj_${branch}_${wt}`, scope: "project:proj",
        provenance: "auto-captured", trigger: [], created: "2026-06-04T00:00:00Z", updated: "2026-06-04T00:00:00Z",
        origin: { repo_path: `/tmp/${wt}`, branch, worktree: wt, session_id: null, write_ts: "2026-06-04T00:00:00Z" },
        next: `work on ${branch}`, summary: branch, verified_facts: [], beliefs: [], blockers: [], also_touched: [],
      });
      const pa = writeAtom(root, mk("feature-a", "wt-a"));
      const pb = writeAtom(root, mk("feature-b", "wt-b"));
      expect(pa).not.toBe(pb);
      const all = readAllAtoms(root).filter((x) => x.type === "resume-state");
      expect(all.length).toBe(2);
      expect(all.map((x: any) => x.origin.branch).sort()).toEqual(["feature-a", "feature-b"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("project resolution", () => {
  test("encodes path with lossy /+_→-", () => {
    expect(encodeProjectDir("/Users/x/Projects/Du_tracking")).toBe("-Users-x-Projects-Du-tracking");
  });
  test("resolves a real git repo (this core repo)", () => {
    const p = resolveActiveProject(import.meta.dir);
    expect(p.repoPath.length).toBeGreaterThan(0);
    expect(p.branch).not.toBe("HEAD");
  });
});
