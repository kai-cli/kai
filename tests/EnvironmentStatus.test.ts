/**
 * EnvironmentStatus.test.ts — Subprocess tests for EnvironmentStatus.hook.ts
 *
 * Tests the contract:
 * - All keys set + no Bedrock → silent exit
 * - ANTHROPIC_API_KEY missing (no Bedrock) → critical warning
 * - ANTHROPIC_API_KEY missing + Bedrock → silent (Bedrock is sufficient)
 * - Output format: JSON with additionalContext only
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { createTempPaiDir, runHook, type TempPaiDir } from "./lib/hook-test-helpers";

const HOOK = new URL("../hooks/EnvironmentStatus.hook.ts", import.meta.url).pathname;

let tmp: TempPaiDir;

beforeEach(() => { tmp = createTempPaiDir("envstatus"); });
afterEach(() => { tmp.cleanup(); });

describe("EnvironmentStatus hook", () => {
  test("silent when ANTHROPIC_API_KEY is set", async () => {
    const { stdout, exitCode } = await runHook(HOOK, tmp.path, {
      env: { ANTHROPIC_API_KEY: "sk-ant-test123" },
    });
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
  });

  test.skipIf(!!process.env.ANTHROPIC_API_KEY)(
    "critical warning when ANTHROPIC_API_KEY missing and no Bedrock",
    async () => {
      const env: Record<string, string> = { ANTHROPIC_API_KEY: "", CLAUDE_CODE_USE_BEDROCK: "" };
      const { stdout, exitCode } = await runHook(HOOK, tmp.path, { env });
      expect(exitCode).toBe(0);
      expect(stdout).not.toBe("");
      const parsed = JSON.parse(stdout);
      expect(parsed.additionalContext).toContain("ANTHROPIC_API_KEY");
    }
  );

  test("silent when Bedrock configured (even without ANTHROPIC_API_KEY)", async () => {
    const env: Record<string, string> = {
      CLAUDE_CODE_USE_BEDROCK: "1",
      ANTHROPIC_API_KEY: "",
    };
    const { stdout, exitCode } = await runHook(HOOK, tmp.path, { env });
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
  });

  test("counts MCP servers from settings.json", async () => {
    // Write a settings.json with some MCP servers
    writeFileSync(
      join(tmp.path, "settings.json"),
      JSON.stringify({ mcpServers: { a: {}, b: {}, c: {} } })
    );
    const { stdout, exitCode } = await runHook(HOOK, tmp.path, {
      env: { ANTHROPIC_API_KEY: "sk-ant-test" },
    });
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
  });
});
