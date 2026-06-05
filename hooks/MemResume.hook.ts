#!/usr/bin/env bun
/**
 * MemResume.hook.ts — SessionStart adapter (KAI-first; pull into PAI once proven).
 *
 * Thin shell: resolves the active project, shells out to the `mem` CLI (NOT the MCP server — hooks
 * cannot call MCP tools), injects the cached resume payload as additionalContext, and lets the CLI
 * kick async verify keyed by THIS session_id. On any failure it degrades silently (never hangs the
 * session). Reads stdin JSON: { session_id, cwd?, ... }; CLAUDE_PROJECT_DIR from env.
 */
import { execFileSync } from "node:child_process";
import { basename } from "node:path";

// CLI path: vendored core under PAI_DIR (set by run-hook.sh). Env override wins; dev path is last resort.
const PAI = process.env.PAI_DIR ?? `${process.env.HOME}/.claude`;
const CLI = process.env.MEMCARRY_CLI ?? `${PAI}/memcarry/packages/cli/src/index.ts`;
// Heartbeat: always leave evidence the hook fired (proves "ran" vs "silently disabled").
function beat(ev: string, note: string) {
  try {
    require("node:fs").appendFileSync(
      `${PAI}/MEMORY/STATE/memcarry-heartbeat.jsonl`,
      JSON.stringify({ ts: new Date().toISOString(), hook: ev, note }) + "\n"
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
  const sessionId = input.session_id ?? "nosession";

  let payload: any;
  try {
    const raw = execFileSync(
      "bun",
      ["run", CLI, "resume", project, "--start", projectDir, "--session", sessionId],
      { encoding: "utf8", timeout: 4000, stdio: ["ignore", "pipe", "ignore"] }
    );
    payload = JSON.parse(raw);
  } catch (e) {
    // Degraded mode: CLI unavailable — say nothing rather than hang. Log so we know it tried.
    beat("SessionStart", `degraded: ${(e as Error).message?.slice(0, 80)}`);
    process.exit(0);
  }

  if (!payload?.found) {
    beat("SessionStart", `no resume-state for ${project}`);
    process.exit(0);
  }
  beat("SessionStart", `resumed ${project}`);

  const lines: string[] = [];
  lines.push(`<memcarry-resume project="${project}">`);
  lines.push(`Resuming ${project}. Verified-at-load is running; drift (if any) surfaces on your next message.`);
  lines.push(`NEXT: ${payload.cursor.next}`);
  lines.push(`WHERE: ${payload.cursor.summary}`);
  if (payload.beliefs?.length) {
    lines.push(`\nMental model (UNVERIFIED beliefs — confirm before relying):`);
    for (const b of payload.beliefs) {
      lines.push(`  • [${b.status.toUpperCase()}] ${b.text}${b.evidence ? ` (evidence: ${b.evidence})` : ""}`);
    }
  }
  if (payload.blockers?.length) lines.push(`\nBlocked on: ${payload.blockers.join("; ")}`);
  if (payload.cursor.also_touched?.length) lines.push(`Also touched last session: ${payload.cursor.also_touched.join(", ")}`);
  lines.push(`</memcarry-resume>`);

  console.log(JSON.stringify({ additionalContext: lines.join("\n") }));
}

main();
