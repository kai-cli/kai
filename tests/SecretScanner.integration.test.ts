/**
 * SecretScanner.integration.test.ts — Integration tests with real PAI_DIR.
 *
 * Tests that the hook correctly detects credential patterns in user prompts
 * and allows clean prompts through.
 *
 * Run: bun test tests/SecretScanner.integration.test.ts
 */

import { describe, test, expect } from "bun:test";
import { spawn } from "bun";
import { homedir } from "os";
import { join } from "path";

const HOOK = new URL(
  "../hooks/SecretScanner.hook.ts",
  import.meta.url
).pathname;
const REAL_PAI_DIR = process.env.PAI_DIR || join(homedir(), ".claude");

async function runScanner(
  userPrompt: string
): Promise<{
  continue?: boolean;
  decision?: string;
  message?: string;
  exitCode: number;
}> {
  const payload = JSON.stringify({
    user_prompt: userPrompt,
    session_id: "test-session",
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

describe("SecretScanner — detects credential patterns", () => {
  test("detects AWS access key", async () => {
    const result = await runScanner(
      "Use this key: AKIAIOSFODNN7EXAMPLE to connect"
    );
    expect(result.decision).toBe("ask");
    expect(result.message).toContain("credentials detected");
  });

  test("detects Anthropic API key", async () => {
    const result = await runScanner(
      "My key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890abcdefgh"
    );
    expect(result.decision).toBe("ask");
    expect(result.message).toContain("credentials detected");
  });

  test("detects GitHub token", async () => {
    const result = await runScanner(
      "Set GITHUB_TOKEN=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij"
    );
    expect(result.decision).toBe("ask");
    expect(result.message).toContain("credentials detected");
  });

  test("detects private key header", async () => {
    const result = await runScanner(
      "Here is my key:\n-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAK..."
    );
    expect(result.decision).toBe("ask");
    expect(result.message).toContain("credentials detected");
  });

  test("detects password in connection string", async () => {
    const result = await runScanner(
      "Connect to postgres://admin:supersecretpassword@db.example.com:5432/mydb"
    );
    expect(result.decision).toBe("ask");
    expect(result.message).toContain("credentials detected");
  });

  test("detects bearer token", async () => {
    const result = await runScanner(
      "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test"
    );
    expect(result.decision).toBe("ask");
    expect(result.message).toContain("credentials detected");
  });
});

describe("SecretScanner — allows clean prompts", () => {
  test("allows normal text prompt", async () => {
    const result = await runScanner("How do I write a function in TypeScript?");
    expect(result.continue).toBe(true);
  });

  test("allows code without secrets", async () => {
    const result = await runScanner(
      "function add(a: number, b: number): number { return a + b; }"
    );
    expect(result.continue).toBe(true);
  });

  test("allows empty prompt", async () => {
    const result = await runScanner("");
    expect(result.continue).toBe(true);
  });

  test("allows git command discussion", async () => {
    const result = await runScanner(
      "How do I undo a git push --force? I made a mistake."
    );
    expect(result.continue).toBe(true);
  });
});

describe("SecretScanner — resilience", () => {
  test("handles malformed JSON input gracefully", async () => {
    const proc = spawn(["bun", "run", HOOK], {
      stdin: new TextEncoder().encode("not-json"),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PAI_DIR: REAL_PAI_DIR },
    });

    const out = await new Response(proc.stdout).text();
    await proc.exited;
    const result = JSON.parse(out.trim());
    expect(result.continue).toBe(true);
  });

  test("handles missing user_prompt field", async () => {
    const proc = spawn(["bun", "run", HOOK], {
      stdin: new TextEncoder().encode(JSON.stringify({ session_id: "test" })),
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
