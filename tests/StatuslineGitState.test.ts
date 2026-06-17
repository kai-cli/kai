import { test, expect } from "bun:test";
import { parseGitState } from "../hooks/lib/git-state";

// parseGitState parses `git status --porcelain=v2 --branch` output → {ahead, dirty}.
// Pure function; this is the one realistically-testable unit of the action-tab git logic.

test("clean repo, up to date → ahead 0, dirty 0", () => {
  const out = [
    "# branch.oid abc123",
    "# branch.head main",
    "# branch.upstream origin/main",
    "# branch.ab +0 -0",
  ].join("\n");
  expect(parseGitState(out)).toEqual({ ahead: 0, dirty: 0 });
});

test("commits ahead of upstream → ahead counted from branch.ab", () => {
  const out = ["# branch.head main", "# branch.upstream origin/main", "# branch.ab +3 -0"].join("\n");
  expect(parseGitState(out).ahead).toBe(3);
});

test("dirty files: changed (1), renamed (2), unmerged (u), untracked (?) all count", () => {
  const out = [
    "# branch.ab +0 -0",
    "1 .M N... 100644 100644 100644 aaa bbb file1.ts",
    "1 M. N... 100644 100644 100644 ccc ddd file2.ts",
    "2 R. N... 100644 100644 100644 eee fff R100 new.ts\told.ts",
    "u UU N... 100644 100644 100644 100644 ggg hhh iii conflict.ts",
    "? untracked.ts",
  ].join("\n");
  const r = parseGitState(out);
  expect(r.dirty).toBe(5);
  expect(r.ahead).toBe(0);
});

test("ahead + dirty together (the real combined case)", () => {
  const out = [
    "# branch.ab +2 -1",
    "1 .M N... 100644 100644 100644 aaa bbb a.ts",
    "? b.ts",
  ].join("\n");
  expect(parseGitState(out)).toEqual({ ahead: 2, dirty: 2 });
});

test("no upstream (branch.ab absent) → ahead 0, still counts dirty", () => {
  const out = ["# branch.head feature-x", "? only-untracked.ts"].join("\n");
  expect(parseGitState(out)).toEqual({ ahead: 0, dirty: 1 });
});

test("empty / non-repo output → zeros, no throw", () => {
  expect(parseGitState("")).toEqual({ ahead: 0, dirty: 0 });
  expect(parseGitState("fatal: not a git repository")).toEqual({ ahead: 0, dirty: 0 });
});
