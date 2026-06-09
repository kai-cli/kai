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

/**
 * B1 (PAI adapter — NOT the engine): read the most-recently-updated active PRD's next-action so the
 * resume block points at concrete in-flight work. "Next action" = the first unchecked `- [ ] ISC-N:`
 * criterion of the newest non-complete PRD under MEMORY/WORK/. PAI-specific (Algorithm PRD format), so
 * it lives here in the host adapter, keeping the memcarry engine PAI-free. Degrades silently to null.
 */
function activePrdNextAction(): { task: string; next: string } | null {
  try {
    const fs = require("node:fs");
    const path = require("node:path");
    const workDir = `${PAI}/MEMORY/WORK`;
    if (!fs.existsSync(workDir)) return null;
    const dirs = fs.readdirSync(workDir)
      .filter((d: string) => /^\d{8}-\d{6}_/.test(d))
      .sort()
      .reverse()
      .slice(0, 12); // newest dozen — never scan everything
    for (const d of dirs) {
      const prd = path.join(workDir, d, "PRD.md");
      if (!fs.existsSync(prd)) continue;
      const head = fs.readFileSync(prd, "utf8");
      const phase = head.match(/^phase:\s*(\w+)/m)?.[1];
      if (phase === "complete") continue; // only in-flight PRDs
      const task = head.match(/^task:\s*(.+)$/m)?.[1]?.trim() ?? d;
      const firstUnchecked = head.match(/^- \[ \] (ISC-[^\n]+)/m)?.[1]?.trim();
      if (firstUnchecked) return { task, next: firstUnchecked };
    }
  } catch { /* degrade silently */ }
  return null;
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
  // B1: surface the active PRD's next-action alongside memcarry's own cursor (PAI adapter enrichment).
  const prd = activePrdNextAction();
  if (prd) lines.push(`NEXT (PRD ${prd.task}): ${prd.next}`);
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
