#!/usr/bin/env bun
/**
 * MemCapture.hook.ts — SessionEnd/Stop adapter. Auto-captures a resume-state from the session
 * transcript (mechanical cursor; F1 substantive-gate enforced in the CLI/lib). The next/why is a
 * [CONFIRM]-tagged placeholder — the /end skill prints it for a 10-second user confirm/edit
 * (hooks cannot prompt modally). Degrades silently. Optional MEMCARRY_GH_SLUG / MEMCARRY_DEVICE env hints.
 */
import { execFileSync } from "node:child_process";
import { basename } from "node:path";

const PAI = process.env.PAI_DIR ?? `${process.env.HOME}/.claude`;
const CLI = process.env.MEMCARRY_CLI ?? `${PAI}/memcarry/packages/cli/src/index.ts`;
function beat(note: string) {
  try {
    require("node:fs").appendFileSync(
      `${PAI}/MEMORY/STATE/memcarry-heartbeat.jsonl`,
      JSON.stringify({ ts: new Date().toISOString(), hook: "Stop", note }) + "\n"
    );
  } catch {}
}

function readStdin(): any {
  try {
    return JSON.parse(require("node:fs").readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

function main() {
  const input = readStdin();
  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
  const project = basename(projectDir);
  const transcript = input.transcript_path;
  if (!transcript) process.exit(0);

  const args = ["run", CLI, "capture", project, "--transcript", transcript, "--start", projectDir];
  if (process.env.MEMCARRY_GH_SLUG) args.push("--slug", process.env.MEMCARRY_GH_SLUG);
  if (process.env.MEMCARRY_DEVICE) args.push("--device", process.env.MEMCARRY_DEVICE);

  try {
    const raw = execFileSync("bun", args, { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] });
    let r: any = {}; try { r = JSON.parse(raw); } catch {}
    beat(r.captured ? `captured ${project}` : `skipped ${project} (${r.reason ?? "not substantive"})`);
  } catch (e) {
    beat(`error: ${(e as Error).message?.slice(0, 80)}`);
    /* never disrupt session end */
  }
  process.exit(0);
}

main();
