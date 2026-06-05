#!/usr/bin/env bun
/**
 * MemDrift.hook.ts — UserPromptSubmit adapter. Consumes the drift file written by the async verify
 * that MemResume kicked off (keyed by this session_id), and surfaces drift as additionalContext.
 * Read-once: drift shows on the first prompt after SessionStart, then is consumed. ANNOTATE only.
 * Degrades silently if no drift / CLI unavailable.
 */
import { execFileSync } from "node:child_process";
import { basename } from "node:path";

const PAI = process.env.PAI_DIR ?? `${process.env.HOME}/.claude`;
const CLI = process.env.MEMCARRY_CLI ?? `${PAI}/memcarry/packages/cli/src/index.ts`;

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
  const sessionId = input.session_id ?? "nosession";

  let payload: any;
  try {
    const raw = execFileSync(
      "bun",
      ["run", CLI, "drift", project, "--session", sessionId],
      { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] }
    );
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  if (!payload?.annotation) process.exit(0);
  console.log(JSON.stringify({ additionalContext: `<memcarry-drift>\n${payload.annotation}\n</memcarry-drift>` }));
}

main();
