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
const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const REAL_PAI_DIR = process.env.PAI_DIR || REPO_ROOT;
const ANTHROPIC_EXAMPLE_KEY = "sk" + "-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890abcdefgh";
const GITHUB_EXAMPLE_TOKEN = "gh" + "p_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";
const RSA_PRIVATE_KEY_HEADER = "-----BEGIN RSA " + "PRIVATE KEY-----";

async function runScanner(
  userPrompt: string,
  field: "prompt" | "user_prompt" = "prompt"
): Promise<{
  continue?: boolean;
  decision?: string;
  reason?: string;
  message?: string;
  suppressOriginalPrompt?: boolean;
  exitCode: number;
}> {
  const payload = JSON.stringify({
    [field]: userPrompt,
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
    expect(result.decision).toBe("block");
    expect(result.suppressOriginalPrompt).toBe(true);
    expect(result.reason).toContain("credentials detected");
  });

  test("detects Anthropic API key", async () => {
    const result = await runScanner(
      `My key is ${ANTHROPIC_EXAMPLE_KEY}`
    );
    expect(result.decision).toBe("block");
    expect(result.suppressOriginalPrompt).toBe(true);
    expect(result.reason).toContain("credentials detected");
  });

  test("detects GitHub token", async () => {
    const result = await runScanner(
      `Set GITHUB_TOKEN=${GITHUB_EXAMPLE_TOKEN}`
    );
    expect(result.decision).toBe("block");
    expect(result.suppressOriginalPrompt).toBe(true);
    expect(result.reason).toContain("credentials detected");
  });

  test("detects private key header", async () => {
    const result = await runScanner(
      `Here is my key:\n${RSA_PRIVATE_KEY_HEADER}\nMIIEpAIBAAK...`
    );
    expect(result.decision).toBe("block");
    expect(result.suppressOriginalPrompt).toBe(true);
    expect(result.reason).toContain("credentials detected");
  });

  test("detects password in connection string", async () => {
    const result = await runScanner(
      "Connect to postgres://admin:supersecretpassword@db.example.com:5432/mydb"
    );
    expect(result.decision).toBe("block");
    expect(result.suppressOriginalPrompt).toBe(true);
    expect(result.reason).toContain("credentials detected");
  });

  test("detects bearer token", async () => {
    const result = await runScanner(
      "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test"
    );
    expect(result.decision).toBe("block");
    expect(result.suppressOriginalPrompt).toBe(true);
    expect(result.reason).toContain("credentials detected");
  });

  test("reads current `prompt` field (PAI-SR-030)", async () => {
    const result = await runScanner("Use AKIAIOSFODNN7EXAMPLE", "prompt");
    expect(result.decision).toBe("block");
  });

  test("still reads legacy `user_prompt` field (back-compat)", async () => {
    const result = await runScanner("Use AKIAIOSFODNN7EXAMPLE", "user_prompt");
    expect(result.decision).toBe("block");
  });

  test("block reason never contains the secret value", async () => {
    const secret = "AKIAIOSFODNN7EXAMPLE";
    const result = await runScanner(`Use ${secret} to connect`);
    expect(result.decision).toBe("block");
    expect(result.reason ?? "").not.toContain(secret);
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
