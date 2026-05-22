/**
 * ConfigValidation.test.ts — Subprocess tests for ConfigValidation.hook.ts
 *
 * Tests the contract:
 * - Missing schema/settings → exits 0, no output (graceful degradation)
 * - Valid settings → exits 0, no output (silent pass)
 * - Malformed JSON → exits 0, outputs error JSON with additionalContext
 * - Schema violations → exits 0, outputs warning JSON with additionalContext
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync } from "fs";
import { join } from "path";
import { createTempPaiDir, writeSettings, writeSchema, runHook, type TempPaiDir } from "./lib/hook-test-helpers";

const HOOK = new URL("../hooks/ConfigValidation.hook.ts", import.meta.url).pathname;

let tmp: TempPaiDir;

beforeEach(() => { tmp = createTempPaiDir("configval"); });
afterEach(() => { tmp.cleanup(); });

const MINIMAL_SCHEMA = {
  type: "object",
  properties: {
    model: { type: "string" },
    tokenBudget: { type: "number" },
  },
  additionalProperties: true,
};

describe("ConfigValidation hook", () => {
  test("exits silently when schema file missing", async () => {
    writeSettings(tmp.path, { model: "opus" });
    // No schema file written
    const { stdout, exitCode } = await runHook(HOOK, tmp.path);
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
  });

  test("exits silently when settings file missing", async () => {
    writeSchema(tmp.path, MINIMAL_SCHEMA);
    // No settings file written
    const { stdout, exitCode } = await runHook(HOOK, tmp.path);
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
  });

  test("exits silently when both files missing", async () => {
    const { stdout, exitCode } = await runHook(HOOK, tmp.path);
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
  });

  test("exits silently for valid settings", async () => {
    writeSchema(tmp.path, MINIMAL_SCHEMA);
    writeSettings(tmp.path, { model: "opus", tokenBudget: 5000 });
    const { stdout, exitCode } = await runHook(HOOK, tmp.path);
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
  });

  test("reports malformed JSON with error context", async () => {
    writeSchema(tmp.path, MINIMAL_SCHEMA);
    writeFileSync(join(tmp.path, "settings.json"), "{ broken json ???");
    const { stdout, exitCode } = await runHook(HOOK, tmp.path);
    expect(exitCode).toBe(0);
    expect(stdout).not.toBe("");
    const parsed = JSON.parse(stdout);
    expect(parsed.additionalContext).toContain("malformed JSON");
    expect(parsed.additionalContext).toContain("rebuild");
  });

  test("reports schema violations with warning context", async () => {
    // The hook uses the real SETTINGS_SCHEMA (imported, not from disk file).
    // The disk schema file is only checked for existence as a feature gate.
    // Real schema requires `hooks` to be an object — send invalid type to trigger errors.
    writeSchema(tmp.path, MINIMAL_SCHEMA); // Just needs to exist
    writeSettings(tmp.path, { hooks: "not-an-object" });

    const { stdout, exitCode } = await runHook(HOOK, tmp.path);
    expect(exitCode).toBe(0);
    expect(stdout).not.toBe("");
    const parsed = JSON.parse(stdout);
    expect(parsed.additionalContext).toContain("Config validation");
    expect(parsed.additionalContext).toContain("issue");
  });

  test("output JSON has only additionalContext key", async () => {
    writeSchema(tmp.path, MINIMAL_SCHEMA);
    writeFileSync(join(tmp.path, "settings.json"), "INVALID");
    const { stdout } = await runHook(HOOK, tmp.path);
    const parsed = JSON.parse(stdout);
    expect(Object.keys(parsed)).toEqual(["additionalContext"]);
  });
});
