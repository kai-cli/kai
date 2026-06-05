#!/usr/bin/env bun
/**
 * replay-sessions.ts — the real-world smoke harness.
 *
 * Runs the transcript parser + auto-capture across ALL real Claude Code sessions on disk and reports
 * aggregate quality signals — the cheapest way to find where capture breaks on REAL data:
 *  - how many sessions are substantive vs junk (validates the F1 gate against reality)
 *  - capture coverage: do substantive sessions actually yield a cursor (PR/issue/files)?
 *  - parse failures / anomalies (validates F2 defensiveness)
 *  - the "shallow cursor" rate: sessions with dev activity but NO PR/issue ref (where next/why
 *    will be weakest — the Phase −1 known limit, now MEASURED)
 *
 * Usage:
 *   bun run fixtures/replay-sessions.ts [--limit N] [--project NAME] [--samples K] [--json]
 */
import { readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { parseTranscript, isSubstantive, touchedRepos } from "../packages/lib/src/index.js";

const PROJECTS = join(homedir(), ".claude", "projects");
const flag = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const has = (n: string) => process.argv.includes(`--${n}`);

const limit = Number(flag("limit") ?? 400);
const onlyProject = flag("project");
const sampleK = Number(flag("samples") ?? 8);

interface Row {
  project: string;
  file: string;
  sizeKB: number;
  realTurns: number;
  bash: number;
  devCmds: number;
  files: number;
  prs: number;
  issues: number;
  repos: number;
  substantive: boolean;
  shallow: boolean; // substantive but no PR/issue ref → weak cursor
  error?: string;
}

function listSessions(): { project: string; path: string }[] {
  const out: { project: string; path: string }[] = [];
  for (const dir of readdirSync(PROJECTS, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    if (onlyProject && !dir.name.includes(onlyProject)) continue;
    const projDir = join(PROJECTS, dir.name);
    let files: string[] = [];
    try { files = readdirSync(projDir).filter((f) => f.endsWith(".jsonl")); } catch { continue; }
    for (const f of files) out.push({ project: dir.name, path: join(projDir, f) });
  }
  return out;
}

const rows: Row[] = [];
const sessions = listSessions()
  .map((s) => ({ ...s, mtime: statSync(s.path).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime)
  .slice(0, limit);

for (const s of sessions) {
  const sizeKB = Math.round(statSync(s.path).size / 1024);
  try {
    const cap = parseTranscript(s.path);
    const sub = isSubstantive(cap);
    rows.push({
      project: s.project.replace(/^-Users-[^-]+-[^-]+-/, ""),
      file: basename(s.path).slice(0, 8),
      sizeKB,
      realTurns: cap.realTurns,
      bash: cap.bashCommands.length,
      devCmds: cap.gitGhBuild.length,
      files: cap.filesTouched.length,
      prs: cap.prRefs.length,
      issues: cap.issueRefs.length,
      repos: touchedRepos(cap).length,
      substantive: sub,
      shallow: sub && cap.prRefs.length === 0 && cap.issueRefs.length === 0,
    });
  } catch (e) {
    rows.push({ project: s.project, file: basename(s.path).slice(0, 8), sizeKB, realTurns: 0, bash: 0, devCmds: 0, files: 0, prs: 0, issues: 0, repos: 0, substantive: false, shallow: false, error: (e as Error).message });
  }
}

// S1 diagnostic: bucket WHY each non-substantive session was skipped.
function skipReason(r: Row): string {
  if (r.error) return "parse-error";
  if (r.realTurns === 0) return "non-conversation (stub/harvester/queue)";
  if (r.realTurns < 4) return `too-few-turns (${r.realTurns})`;
  if (r.devCmds + r.files === 0) return "no-dev-activity";
  return "other";
}

if (has("why-skipped")) {
  const skipped = rows.filter((r) => !r.substantive);
  const buckets: Record<string, number> = {};
  for (const r of skipped) buckets[skipReason(r)] = (buckets[skipReason(r)] ?? 0) + 1;
  console.log("\n=== WHY-SKIPPED buckets (of", skipped.length, "non-substantive) ===");
  console.log(buckets);
  // show the near-misses: real conversation (turns>=4) but no dev activity, OR 1-3 turns with dev
  const nearMiss = skipped.filter((r) => (r.realTurns >= 4 && r.devCmds + r.files === 0) || (r.realTurns > 0 && r.realTurns < 4 && r.devCmds + r.files > 0));
  console.log(`\nnear-misses (would the gate wrongly exclude real work?): ${nearMiss.length}`);
  for (const r of nearMiss.slice(0, 10)) console.log(`  ${r.project.padEnd(20)} turns=${r.realTurns} dev=${r.devCmds} files=${r.files}`);
  process.exit(0);
}

const sub = rows.filter((r) => r.substantive);
const errors = rows.filter((r) => r.error);
const shallow = rows.filter((r) => r.shallow);
const withCursor = sub.filter((r) => r.prs > 0 || r.issues > 0);
const multiRepo = sub.filter((r) => r.repos > 1);

const summary = {
  scanned: rows.length,
  parse_errors: errors.length,
  substantive: sub.length,
  substantive_pct: rows.length ? Math.round((sub.length / rows.length) * 100) : 0,
  with_cursor_ref: withCursor.length,
  cursor_coverage_pct: sub.length ? Math.round((withCursor.length / sub.length) * 100) : 0,
  shallow_cursor: shallow.length,
  shallow_pct: sub.length ? Math.round((shallow.length / sub.length) * 100) : 0,
  multi_repo_sessions: multiRepo.length,
};

if (has("json")) {
  console.log(JSON.stringify({ summary, rows }, null, 2));
} else {
  console.log("\n=== Memcarry replay smoke report ===\n");
  console.log(summary);
  console.log(`\n--- ${Math.min(sampleK, sub.length)} sample SUBSTANTIVE captures (the warm-start candidates) ---`);
  for (const r of sub.slice(0, sampleK)) {
    console.log(`  ${r.project.padEnd(20)} turns=${String(r.realTurns).padStart(3)} dev=${String(r.devCmds).padStart(3)} files=${String(r.files).padStart(2)} pr=${r.prs} iss=${r.issues} repos=${r.repos}${r.shallow ? "  ⚠SHALLOW" : ""}`);
  }
  if (errors.length) {
    console.log(`\n--- ${Math.min(5, errors.length)} PARSE ERRORS (F2 stress) ---`);
    for (const r of errors.slice(0, 5)) console.log(`  ${r.project}/${r.file}: ${r.error}`);
  }
  console.log(`\nINTERPRETATION:`);
  console.log(`  • substantive_pct = how aggressively the F1 gate fires on your real sessions`);
  console.log(`  • cursor_coverage_pct = % of real sessions where mechanical capture finds a PR/issue anchor`);
  console.log(`  • shallow_pct = real work sessions with NO pr/issue → where next/why will be weakest (need LLM draft)`);
  console.log(`  • parse_errors should be 0 (F2 defensiveness holds on real data)\n`);
}
