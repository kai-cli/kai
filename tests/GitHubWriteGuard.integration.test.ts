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
import { homedir } from "os";
import { join } from "path";

const HOOK = new URL(
  "../hooks/GitHubWriteGuard.hook.ts",
  import.meta.url
).pathname;
const REAL_PAI_DIR = process.env.PAI_DIR || join(homedir(), ".claude");

async function runGuard(
  command: string
): Promise<{
  continue?: boolean;
  decision?: string;
  reason?: string;
  exitCode: number;
}> {
  const payload = JSON.stringify({
    tool_name: "Bash",
    tool_input: { command },
  });

  const proc = spawn(["bun", "run", HOOK], {
    stdin: new TextEncoder().encode(payload),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, PAI_DIR: REAL_PAI_DIR },
  });

  const [out, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);

  try {
    return { ...JSON.parse(out.trim()), exitCode };
  } catch {
    return { exitCode };
  }
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

  test("allows gh issue list", async () => {
    const result = await runGuard("gh issue list --state open");
    expect(result.continue).toBe(true);
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
