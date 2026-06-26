/**
 * GitHubWriteGuard.integration.test.ts — Integration tests with real PAI_DIR.
 *
 * Tests that the hook correctly blocks GitHub write operations and allows reads.
 * Uses the real hook file from the repo, not mocks.
 *
 * Run: bun test tests/GitHubWriteGuard.integration.test.ts
 */

import { describe, test, expect } from "bun:test";
import { spawn } from "bun";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const HOOK = new URL(
  "../hooks/GitHubWriteGuard.hook.ts",
  import.meta.url
).pathname;
const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const REAL_PAI_DIR = process.env.PAI_DIR || REPO_ROOT;

async function runGuard(
  command: string,
  options: { paiDir?: string; cwd?: string; env?: Record<string, string> } = {}
): Promise<{
  continue?: boolean;
  decision?: string;
  reason?: string;
  exitCode: number;
}> {
  const payload = JSON.stringify({
    tool_name: "Bash",
    cwd: options.cwd,
    tool_input: { command },
  });

  const proc = spawn(["bun", "run", HOOK], {
    stdin: new TextEncoder().encode(payload),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, PAI_DIR: options.paiDir ?? REAL_PAI_DIR, ...options.env },
  });

  // Collect stdout chunks eagerly before awaiting exit to survive parallel load.
  // Response.text() / sequential reads can miss data when the pipe closes fast.
  const chunks: Uint8Array[] = [];
  const reader = proc.stdout.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const exitCode = await proc.exited;
  const out = new TextDecoder().decode(
    chunks.reduce((acc, c) => { const merged = new Uint8Array(acc.length + c.length); merged.set(acc); merged.set(c, acc.length); return merged; }, new Uint8Array(0))
  );

  try {
    return { ...JSON.parse(out.trim()), exitCode };
  } catch {
    return { exitCode };
  }
}

function makeAdaFixture(repoKey = "feed_bbf") {
  const root = mkdtempSync(join(tmpdir(), "pai-ada-branch-guard-"));
  const paiDir = join(root, "pai");
  const repoDir = join(root, repoKey);
  mkdirSync(join(paiDir, "ada", "procedures"), { recursive: true });
  mkdirSync(repoDir, { recursive: true });
  writeFileSync(join(paiDir, "ada", "procedures", `${repoKey}.json`), JSON.stringify({
    branch: "usp_ui",
    steps: ["verify branch==usp_ui", "PR to usp_ui"],
    guard: {
      hardBlock: ["sysevent_integration", "usp_ui"],
      warnOnly: ["*"],
      overrideEnv: "ADA_BRANCH_GUARD_OVERRIDE",
    },
  }, null, 2));
  return {
    root,
    paiDir,
    repoDir,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function extractTokenHash(reason: string | undefined): string {
  const match = reason?.match(/Token hash: ([0-9a-f]{12})/);
  if (!match) throw new Error(`No token hash found in reason: ${reason}`);
  return match[1];
}

function approveHash(paiDir: string, hash: string, ttlMs = 60_000) {
  const approvalsDir = join(paiDir, "MEMORY", "STATE", "github-approvals");
  mkdirSync(approvalsDir, { recursive: true });
  writeFileSync(join(approvalsDir, `${hash}.json`), JSON.stringify({
    command: `(approved by test hash: ${hash})`,
    hash,
    approved_at: Date.now(),
    expires_at: Date.now() + ttlMs,
    user_response: "Yes, test approval",
  }, null, 2));
}

describe("GitHubWriteGuard — blocks write operations", () => {
  test("blocks git push", async () => {
    const result = await runGuard("git push origin main");
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("GITHUB WRITE BLOCKED");
  });

  test("blocks git push --force", async () => {
    const result = await runGuard("git push --force origin main");
    expect(result.decision).toBe("block");
  });

  test("blocks gh pr create", async () => {
    const result = await runGuard('gh pr create --title "test" --body "test"');
    expect(result.decision).toBe("block");
  });

  test("blocks gh issue create", async () => {
    const result = await runGuard('gh issue create --title "bug"');
    expect(result.decision).toBe("block");
  });

  test("blocks gh release create", async () => {
    const result = await runGuard("gh release create v1.0.0");
    expect(result.decision).toBe("block");
  });

  test("blocks gh repo delete", async () => {
    const result = await runGuard("gh repo delete owner/repo --yes");
    expect(result.decision).toBe("block");
  });

  test("blocks gh api mutating methods", async () => {
    const post = await runGuard("gh api repos/owner/repo/issues --method POST -f title=test");
    expect(post.decision).toBe("block");

    const deleteResult = await runGuard("gh api -X DELETE repos/owner/repo/issues/comments/123");
    expect(deleteResult.decision).toBe("block");
  });

  test("blocks gh api mutation bypass forms", async () => {
    for (const command of [
      "gh api repos/owner/repo/issues/comments -f body=hi",
      "gh api -F title=test repos/owner/repo/issues",
      "gh api repos/owner/repo/issues --field title=test",
      "gh api repos/owner/repo/issues --raw-field body=hi",
      "gh api repos/owner/repo/issues --input payload.json",
      "gh api -XPOST repos/owner/repo/issues",
      "gh api --method=PATCH repos/owner/repo/issues/1",
    ]) {
      const result = await runGuard(command);
      expect(result.decision).toBe("block");
    }
  });

  test("blocks git push --delete (remote branch deletion)", async () => {
    const result = await runGuard("git push origin --delete feature-branch");
    expect(result.decision).toBe("block");
  });
});

describe("GitHubWriteGuard — allows read operations", () => {
  test("allows git status", async () => {
    const result = await runGuard("git status");
    expect(result.continue).toBe(true);
  });

  test("allows gh pr list", async () => {
    const result = await runGuard("gh pr list");
    expect(result.continue).toBe(true);
  });

  test("allows common gh read-only PR commands", async () => {
    for (const command of [
      "gh pr view 33 --json number,title,state",
      "gh pr diff 33",
      "gh pr checks 33",
      "gh pr status",
    ]) {
      const result = await runGuard(command);
      expect(result.continue).toBe(true);
    }
  });

  test("allows gh issue list", async () => {
    const result = await runGuard("gh issue list --state open");
    expect(result.continue).toBe(true);
  });

  test("allows gh api GET/read calls", async () => {
    for (const command of [
      "gh api repos/owner/repo/pulls/33",
      "gh api --method GET repos/owner/repo/actions/runs",
      "gh run view 123456 --log",
    ]) {
      const result = await runGuard(command);
      expect(result.continue).toBe(true);
    }
  });

  test("allows git log", async () => {
    const result = await runGuard("git log --oneline -10");
    expect(result.continue).toBe(true);
  });

  test("allows git diff", async () => {
    const result = await runGuard("git diff HEAD~1");
    expect(result.continue).toBe(true);
  });
});

describe("GitHubWriteGuard — edge cases", () => {
  test("allows github-approve.ts invocation", async () => {
    const result = await runGuard(
      'bun github-approve.ts --hash "abc123" "Approve"'
    );
    expect(result.continue).toBe(true);
  });

  test("handles empty command gracefully", async () => {
    const result = await runGuard("");
    expect(result.continue).toBe(true);
  });

  test("handles non-Bash tool gracefully", async () => {
    const payload = JSON.stringify({
      tool_name: "Read",
      tool_input: { file_path: "/tmp/test.txt" },
    });

    const proc = spawn(["bun", "run", HOOK], {
      stdin: new TextEncoder().encode(payload),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PAI_DIR: REAL_PAI_DIR },
    });

    const out = await new Response(proc.stdout).text();
    await proc.exited;
    const result = JSON.parse(out.trim());
    expect(result.continue).toBe(true);
  });
});

describe("GitHubWriteGuard — approval ergonomics", () => {
  test("approved PR comments survive body formatting changes", async () => {
    const root = mkdtempSync(join(tmpdir(), "pai-gh-approval-"));
    try {
      const paiDir = join(root, "pai");
      const first = await runGuard('gh pr comment 30 --body "Clear to merge."', { paiDir });
      expect(first.decision).toBe("block");
      const hash = extractTokenHash(first.reason);
      approveHash(paiDir, hash);

      const second = await runGuard("gh pr comment 30 --body-file /tmp/review-body.md", { paiDir });
      expect(second.continue).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("approved PR comments do not transfer to a different PR number", async () => {
    const root = mkdtempSync(join(tmpdir(), "pai-gh-approval-"));
    try {
      const paiDir = join(root, "pai");
      const first = await runGuard('gh pr comment 30 --body "Clear to merge."', { paiDir });
      const hash = extractTokenHash(first.reason);
      approveHash(paiDir, hash);

      const second = await runGuard('gh pr comment 31 --body "Clear to merge."', { paiDir });
      expect(second.decision).toBe("block");
      expect(extractTokenHash(second.reason)).not.toBe(hash);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("approved PR comments do not transfer across --repo targets", async () => {
    const root = mkdtempSync(join(tmpdir(), "pai-gh-approval-"));
    try {
      const paiDir = join(root, "pai");
      const first = await runGuard('gh pr comment 30 --repo me/repoA --body "Clear to merge."', { paiDir });
      const hash = extractTokenHash(first.reason);
      approveHash(paiDir, hash);

      const second = await runGuard('gh pr comment 30 --repo me/repoB --body "Clear to merge."', { paiDir });
      expect(second.decision).toBe("block");
      expect(extractTokenHash(second.reason)).not.toBe(hash);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("approved PR comments support --repo before the target number", async () => {
    const root = mkdtempSync(join(tmpdir(), "pai-gh-approval-"));
    try {
      const paiDir = join(root, "pai");
      const first = await runGuard('gh pr comment --repo me/repoA 30 --body "Clear to merge."', { paiDir });
      const hash = extractTokenHash(first.reason);
      approveHash(paiDir, hash);

      const second = await runGuard('gh pr comment 30 --repo me/repoA --body-file /tmp/review-body.md', { paiDir });
      expect(second.continue).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("expired approval tokens still block comment writes", async () => {
    const root = mkdtempSync(join(tmpdir(), "pai-gh-approval-"));
    try {
      const paiDir = join(root, "pai");
      const first = await runGuard('gh issue comment 42 --body "Looks good."', { paiDir });
      const hash = extractTokenHash(first.reason);
      approveHash(paiDir, hash, -1);

      const second = await runGuard('gh issue comment 42 --body-file /tmp/issue-comment.md', { paiDir });
      expect(second.decision).toBe("block");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("PR approval reviews stay on the strict command hash path", async () => {
    const root = mkdtempSync(join(tmpdir(), "pai-gh-approval-"));
    try {
      const paiDir = join(root, "pai");
      const first = await runGuard('gh pr review 30 --approve --body "Approved."', { paiDir });
      const hash = extractTokenHash(first.reason);
      approveHash(paiDir, hash);

      const second = await runGuard('gh pr review 30 --approve --body-file /tmp/approval.md', { paiDir });
      expect(second.decision).toBe("block");
      expect(extractTokenHash(second.reason)).not.toBe(hash);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("GitHubWriteGuard — ADA branch guard", () => {
  test("blocks git push targeting the wrong branch in an ADA hard-block repo", async () => {
    const fixture = makeAdaFixture();
    try {
      const result = await runGuard("git push origin main", {
        paiDir: fixture.paiDir,
        cwd: fixture.repoDir,
      });
      expect(result.decision).toBe("block");
      expect(result.reason).toContain("ADA BRANCH GUARD BLOCKED");
      expect(result.reason).toContain("Expected branch/base: usp_ui");
      expect(result.reason).toContain("Actual branch/base: main");
      expect(result.reason).toContain("verify branch==usp_ui");
    } finally {
      fixture.cleanup();
    }
  });

  test("does not ADA-block feature-branch git pushes in an ADA repo", async () => {
    const fixture = makeAdaFixture();
    try {
      const result = await runGuard("git push origin feature/my-work", {
        paiDir: fixture.paiDir,
        cwd: fixture.repoDir,
      });
      expect(result.decision).toBe("block");
      expect(result.reason).toContain("GITHUB WRITE BLOCKED");
      expect(result.reason).not.toContain("ADA BRANCH GUARD BLOCKED");
      expect(result.reason).toContain("ADA procedure checklist");
    } finally {
      fixture.cleanup();
    }
  });

  test("blocks git push targeting another protected ADA branch", async () => {
    const fixture = makeAdaFixture();
    try {
      const result = await runGuard("git push origin sysevent_integration", {
        paiDir: fixture.paiDir,
        cwd: fixture.repoDir,
      });
      expect(result.decision).toBe("block");
      expect(result.reason).toContain("ADA BRANCH GUARD BLOCKED");
      expect(result.reason).toContain("Expected branch/base: usp_ui");
      expect(result.reason).toContain("Actual branch/base: sysevent_integration");
    } finally {
      fixture.cleanup();
    }
  });

  test("allows correct ADA branch to proceed to normal GitHub approval block with procedure card", async () => {
    const fixture = makeAdaFixture();
    try {
      const result = await runGuard("git push origin usp_ui", {
        paiDir: fixture.paiDir,
        cwd: fixture.repoDir,
      });
      expect(result.decision).toBe("block");
      expect(result.reason).toContain("GITHUB WRITE BLOCKED");
      expect(result.reason).not.toContain("ADA BRANCH GUARD BLOCKED");
      expect(result.reason).toContain("ADA procedure checklist");
      expect(result.reason).toContain("PR to usp_ui");
    } finally {
      fixture.cleanup();
    }
  });

  test("blocks gh pr create when --base targets the wrong branch", async () => {
    const fixture = makeAdaFixture();
    try {
      const result = await runGuard('gh pr create --base main --title "x" --body "x"', {
        paiDir: fixture.paiDir,
        cwd: fixture.repoDir,
      });
      expect(result.decision).toBe("block");
      expect(result.reason).toContain("ADA BRANCH GUARD BLOCKED");
      expect(result.reason).toContain("Actual branch/base: main");
    } finally {
      fixture.cleanup();
    }
  });

  test("blocks gh pr create with no --base for ADA repos because target is ambiguous", async () => {
    const fixture = makeAdaFixture();
    try {
      const result = await runGuard('gh pr create --title "x" --body "x"', {
        paiDir: fixture.paiDir,
        cwd: fixture.repoDir,
      });
      expect(result.decision).toBe("block");
      expect(result.reason).toContain("ADA BRANCH GUARD BLOCKED");
      expect(result.reason).toContain("Actual branch/base: unknown");
    } finally {
      fixture.cleanup();
    }
  });

  test("override bypasses ADA branch block, logs, and still requires normal GitHub approval", async () => {
    const fixture = makeAdaFixture();
    try {
      const result = await runGuard("git push origin main", {
        paiDir: fixture.paiDir,
        cwd: fixture.repoDir,
        env: { ADA_BRANCH_GUARD_OVERRIDE: "1" },
      });
      expect(result.decision).toBe("block");
      expect(result.reason).toContain("GITHUB WRITE BLOCKED");
      expect(result.reason).not.toContain("ADA BRANCH GUARD BLOCKED");

      const logPath = join(fixture.paiDir, "MEMORY", "STATE", "ada-branch-guard-overrides.jsonl");
      expect(existsSync(logPath)).toBe(true);
      const log = readFileSync(logPath, "utf-8");
      expect(log).toContain('"repo":"feed_bbf"');
      expect(log).toContain('"expected":"usp_ui"');
      expect(log).toContain('"branch":"main"');
    } finally {
      fixture.cleanup();
    }
  });

  test("missing ADA procedure config fails open to the existing GitHub write approval flow", async () => {
    const root = mkdtempSync(join(tmpdir(), "pai-no-ada-"));
    try {
      const paiDir = join(root, "pai");
      const repoDir = join(root, "unregistered_repo");
      mkdirSync(repoDir, { recursive: true });
      const result = await runGuard("git push origin main", { paiDir, cwd: repoDir });
      expect(result.decision).toBe("block");
      expect(result.reason).toContain("GITHUB WRITE BLOCKED");
      expect(result.reason).not.toContain("ADA BRANCH GUARD BLOCKED");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("does not apply ADA branch blocking to non-branch GitHub writes", async () => {
    const fixture = makeAdaFixture();
    try {
      const result = await runGuard('gh issue create --title "bug"', {
        paiDir: fixture.paiDir,
        cwd: fixture.repoDir,
      });
      expect(result.decision).toBe("block");
      expect(result.reason).toContain("GITHUB WRITE BLOCKED");
      expect(result.reason).not.toContain("ADA BRANCH GUARD BLOCKED");
    } finally {
      fixture.cleanup();
    }
  });
});
