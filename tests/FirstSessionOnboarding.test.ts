/**
 * FirstSessionOnboarding.test.ts — Subprocess tests for the one-time onboarding hook.
 *
 * Tests the contract:
 * - First run: creates flag file, outputs JSON with additionalContext
 * - Second run: exits 0 silently (no output)
 * - Deleting flag re-triggers
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { spawn } from "bun";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const HOOK = new URL("../hooks/FirstSessionOnboarding.hook.ts", import.meta.url).pathname;
const TMP_DIR = join(tmpdir(), `pai-onboarding-test-${Date.now()}`);
const FLAG_FILE = join(TMP_DIR, "MEMORY", "STATE", ".onboarding-complete");

beforeEach(() => {
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
  mkdirSync(join(TMP_DIR, "MEMORY", "STATE"), { recursive: true });
});

afterEach(() => {
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
});

async function runHook(): Promise<{ stdout: string; exitCode: number }> {
  const proc = spawn(["bun", "run", HOOK], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, PAI_DIR: TMP_DIR },
  });

  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), exitCode };
}

describe("FirstSessionOnboarding hook", () => {
  test("first run: creates flag file and outputs context", async () => {
    expect(existsSync(FLAG_FILE)).toBe(false);

    const { stdout, exitCode } = await runHook();

    expect(exitCode).toBe(0);
    expect(existsSync(FLAG_FILE)).toBe(true);

    const parsed = JSON.parse(stdout);
    expect(parsed.additionalContext).toBeDefined();
    expect(parsed.additionalContext).toContain("Welcome to KAI");
    expect(parsed.additionalContext).toContain("/help");
    expect(parsed.additionalContext).toContain("/research");
    expect(parsed.additionalContext).toContain("/end");
  });

  test("second run: exits silently (no output)", async () => {
    // First run creates the flag
    await runHook();
    expect(existsSync(FLAG_FILE)).toBe(true);

    // Second run should be silent
    const { stdout, exitCode } = await runHook();
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
  });

  test("deleting flag re-triggers orientation", async () => {
    // First run
    await runHook();
    expect(existsSync(FLAG_FILE)).toBe(true);

    // Delete flag
    rmSync(FLAG_FILE);
    expect(existsSync(FLAG_FILE)).toBe(false);

    // Should fire again
    const { stdout, exitCode } = await runHook();
    expect(exitCode).toBe(0);
    expect(stdout).not.toBe("");
    const parsed = JSON.parse(stdout);
    expect(parsed.additionalContext).toContain("Welcome to KAI");
  });

  test("output is valid JSON with only additionalContext key", async () => {
    const { stdout } = await runHook();
    const parsed = JSON.parse(stdout);
    const keys = Object.keys(parsed);
    expect(keys).toEqual(["additionalContext"]);
  });

  test("creates STATE directory if missing", async () => {
    rmSync(join(TMP_DIR, "MEMORY"), { recursive: true });
    const { exitCode } = await runHook();
    expect(exitCode).toBe(0);
    expect(existsSync(FLAG_FILE)).toBe(true);
  });
});
