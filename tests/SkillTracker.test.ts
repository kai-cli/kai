import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// Drives the hook as a subprocess (matches how run-hook.sh invokes it) with an isolated PAI_DIR so it
// writes to a temp skill-usage.jsonl, never the live one. Hermetic — no $HOME / live-state dependency.
const HOOK = join(import.meta.dir, "..", "hooks", "SkillTracker.hook.ts");
let pai: string;

beforeEach(() => { pai = mkdtempSync(join(tmpdir(), "skilltrack-")); });
afterEach(() => { try { rmSync(pai, { recursive: true, force: true }); } catch {} });

function run(stdin: string) {
  return spawnSync("bun", [HOOK], { input: stdin, env: { ...process.env, PAI_DIR: pai }, encoding: "utf8" });
}
function logLines(): any[] {
  const p = join(pai, "MEMORY", "STATE", "skill-usage.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

test("records a named skill invocation (skill, project, session)", () => {
  const r = run(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Skill", tool_input: { skill: "Research" }, session_id: "s1", cwd: "/x/feed-bbf" }));
  expect(r.status).toBe(0);
  const lines = logLines();
  expect(lines).toHaveLength(1);
  expect(lines[0].skill).toBe("Research");
  expect(lines[0].project).toBe("feed-bbf");
  expect(lines[0].session).toBe("s1");
  expect(lines[0].source).toBe("PreToolUse:Skill");
  expect(typeof lines[0].ts).toBe("string");
});

test("records direct slash command telemetry from UserPromptExpansion", () => {
  const r = run(JSON.stringify({
    hook_event_name: "UserPromptExpansion",
    command_name: "/pai:end",
    args: "--summary",
    source: "user",
    session_id: "s2",
    cwd: "/x/kai",
  }));

  expect(r.status).toBe(0);
  const lines = logLines();
  expect(lines).toHaveLength(1);
  expect(lines[0].skill).toBe("pai:end");
  expect(lines[0].project).toBe("kai");
  expect(lines[0].session).toBe("s2");
  expect(lines[0].source).toBe("UserPromptExpansion");
});

test("records nothing when no skill field (exit 0)", () => {
  const r = run(JSON.stringify({ tool_name: "Skill", tool_input: {} }));
  expect(r.status).toBe(0);
  expect(logLines()).toHaveLength(0);
});

test("never throws on malformed input (exit 0, no log)", () => {
  const r = run("not json at all");
  expect(r.status).toBe(0);
  expect(logLines()).toHaveLength(0);
});

test("appends across multiple invocations (usage accumulates)", () => {
  run(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Skill", tool_input: { skill: "Research" }, cwd: "/x/a" }));
  run(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Skill", tool_input: { skill: "Security" }, cwd: "/x/a" }));
  run(JSON.stringify({ hook_event_name: "UserPromptExpansion", command_name: "/Research", cwd: "/x/b" }));
  const lines = logLines();
  expect(lines).toHaveLength(3);
  expect(lines.filter((l) => l.skill === "Research")).toHaveLength(2);
});
