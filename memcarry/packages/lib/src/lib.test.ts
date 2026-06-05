import { test, expect, describe } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseAtom,
  assertClaimFits,
  renderClaim,
  CLAIM_DISPLAY_CAP,
  serializeAtom,
  deserializeAtom,
  writeAtom,
  readAllAtoms,
  type LessonAtom,
  type ResumeStateAtom,
} from "./index.js";
import { parseTranscript, isSubstantive, touchedRepos } from "./transcript.js";
import { probeGitBranch, probeGhPr } from "./probes.js";

const lesson: LessonAtom = {
  type: "lesson",
  id: "lsn_test",
  scope: "global",
  provenance: "human-confirmed",
  trigger: ["patch"],
  created: "2026-06-04T00:00:00Z",
  updated: "2026-06-04T00:00:00Z",
  claim: { when: "editing a patch", do: "use quilt then regenerate", because: "hand-edits corrupt hunks (build #62)" },
  last_used: null,
  use_count: 0,
};

const resume: ResumeStateAtom = {
  type: "resume-state",
  id: "res_test",
  scope: "project:feed-bbf",
  provenance: "auto-captured",
  trigger: [],
  created: "2026-06-04T00:00:00Z",
  updated: "2026-06-04T00:00:00Z",
  origin: { repo_path: "/tmp/x", branch: "release_v1.1", worktree: null, session_id: "s1", write_ts: "2026-06-04T00:00:00Z" },
  next: "verify PR #81 merged",
  summary: "merged PR #81",
  verified_facts: [{ kind: "gh-pr", recorded: "merged", state: "unverified" }],
  beliefs: [{ text: "use BUILD_TYPE=release", status: "conclusion", as_of: "2026-06-04T00:00:00Z" }],
  blockers: [],
  also_touched: ["/Users/x/Projects/YourCompany-Wiki"],
};

describe("schema", () => {
  test("validates a lesson atom", () => {
    expect(parseAtom(lesson).type).toBe("lesson");
  });
  test("validates a resume-state atom with verified/unverified split", () => {
    const a = parseAtom(resume) as ResumeStateAtom;
    expect(a.beliefs[0]!.status).toBe("conclusion");
    expect(a.verified_facts[0]!.state).toBe("unverified");
    expect(a.also_touched).toContain("/Users/x/Projects/YourCompany-Wiki");
  });
  test("rejects a bad scope", () => {
    expect(() => parseAtom({ ...lesson, scope: "nonsense" })).toThrow();
  });
  test("claim fits the display cap", () => {
    expect(renderClaim(lesson.claim).length).toBeLessThanOrEqual(CLAIM_DISPLAY_CAP);
    expect(() => assertClaimFits(lesson.claim)).not.toThrow();
  });
  test("oversized claim is rejected at write time", () => {
    expect(() => assertClaimFits({ when: "x".repeat(600), do: "y", because: "z" })).toThrow();
  });
});

describe("store round-trip", () => {
  test("serialize → deserialize preserves both types", () => {
    expect(deserializeAtom(serializeAtom(lesson))).toEqual(lesson);
    expect(deserializeAtom(serializeAtom(resume))).toEqual(resume);
  });
  test("write + readAll from disk", () => {
    const root = mkdtempSync(join(tmpdir(), "memstore-"));
    try {
      writeAtom(root, lesson);
      writeAtom(root, resume);
      const all = readAllAtoms(root);
      expect(all.length).toBe(2);
      expect(all.map((a) => a.type).sort()).toEqual(["lesson", "resume-state"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("transcript parser (F1/F2/F3)", () => {
  // a REAL work session shape: typed-block tool_use lines
  const realJsonl = [
    JSON.stringify({ type: "user", message: { content: [{ type: "text", text: "fix the build" }] } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "gh pr edit 81 --repo yourcompany/feed_bbf --body 'Fixes ExampleWRT#358'" } }] } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "gh pr merge 81 --repo yourcompany/feed_bbf --merge" } }] } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "/Users/x/Projects/feed-bbf/a.c" } }] } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "/Users/x/Projects/YourCompany-Wiki/b.md" } }] } }),
    JSON.stringify({ type: "user", message: { content: [{ type: "text", text: "great, ship it #358" }] } }),
  ].join("\n");

  // a JUNK file: housekeeping line types, no real turns (F1)
  const junkJsonl = [
    JSON.stringify({ type: "queue-operation" }),
    JSON.stringify({ type: "ai-title", title: "x" }),
    JSON.stringify({ type: "last-prompt" }),
  ].join("\n");

  test("extracts cursor from a real session", () => {
    const f = join(tmpdir(), `real-${Date.now()}.jsonl`);
    writeFileSync(f, realJsonl);
    const cap = parseTranscript(f);
    rmSync(f, { force: true });
    expect(cap.prRefs).toContain("81");
    expect(cap.issueRefs).toContain("358");
    expect(cap.gitGhBuild.length).toBe(2);
    expect(cap.filesTouched.length).toBe(2);
    expect(cap.realTurns).toBe(6);
    expect(isSubstantive(cap)).toBe(true);
    expect(touchedRepos(cap).sort()).toEqual([
      "/Users/x/Projects/YourCompany-Wiki",
      "/Users/x/Projects/feed-bbf",
    ]);
  });

  test("junk file is NOT substantive (F1 gate)", () => {
    const f = join(tmpdir(), `junk-${Date.now()}.jsonl`);
    writeFileSync(f, junkJsonl);
    const cap = parseTranscript(f);
    rmSync(f, { force: true });
    expect(cap.realTurns).toBe(0);
    expect(isSubstantive(cap)).toBe(false);
  });

  test("malformed lines do not throw (F2 defensive)", () => {
    const f = join(tmpdir(), `bad-${Date.now()}.jsonl`);
    writeFileSync(f, "not json\n{broken\n" + realJsonl);
    const cap = parseTranscript(f);
    rmSync(f, { force: true });
    expect(cap.prRefs).toContain("81");
  });
});

describe("probes (3-state)", () => {
  test("git-branch on a non-repo path → indeterminate (never drifted)", async () => {
    const r = await probeGitBranch("/nonexistent/path/xyz", "main");
    expect(r.state).toBe("indeterminate");
  });
  test("invalid branch name → indeterminate", async () => {
    const r = await probeGitBranch("/tmp", "bad branch with spaces!!");
    expect(r.state).toBe("indeterminate");
  });
  test("invalid repo slug → indeterminate", async () => {
    const r = await probeGhPr("notaslug", "81", "merged");
    expect(r.state).toBe("indeterminate");
  });
  test("invalid pr number → indeterminate", async () => {
    const r = await probeGhPr("owner/repo", "abc", "merged");
    expect(r.state).toBe("indeterminate");
  });
});
