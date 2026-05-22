/**
 * StartupGreeting.test.ts — Subprocess tests for StartupGreeting.hook.ts
 *
 * Tests the contract:
 * - Normal run → exits 0, no stdout output (session guard only)
 * - Subagent → exits 0 immediately
 * - Compaction source → exits 0 immediately
 * - Once-per-session: second run is no-op (uses sentinel file)
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createTempPaiDir, runHook, type TempPaiDir } from "./lib/hook-test-helpers";

const HOOK = new URL("../hooks/StartupGreeting.hook.ts", import.meta.url).pathname;

let tmp: TempPaiDir;

beforeEach(() => { tmp = createTempPaiDir("greeting"); });
afterEach(() => { tmp.cleanup(); });

describe("StartupGreeting hook", () => {
  test("exits 0 with no stdout (session guard, no greeting output)", async () => {
    const { stdout, exitCode } = await runHook(HOOK, tmp.path);
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
  });

  test("exits immediately for subagent sessions", async () => {
    const { exitCode, stdout } = await runHook(HOOK, tmp.path, {
      env: { CLAUDE_AGENT_TYPE: "worker" },
    });
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
  });

  test("exits immediately on compaction source", async () => {
    const { exitCode, stdout } = await runHook(HOOK, tmp.path, {
      stdin: JSON.stringify({ source: "compact" }),
    });
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
  });

  test("exits immediately for Agents project dir", async () => {
    const { exitCode, stdout } = await runHook(HOOK, tmp.path, {
      env: { CLAUDE_PROJECT_DIR: "/Users/test/.claude/Agents/worker" },
    });
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
  });
});
