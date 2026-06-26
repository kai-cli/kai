#!/usr/bin/env bun
/**
 * MemRecall.hook.ts — UserPromptSubmit adapter (A2 / US2): surface relevant memcarry LESSONS on
 * EVERY prompt, hybrid keyword+semantic (RRF). Distinct from MemDrift (read-once resume drift) —
 * this is the every-turn lesson recall channel.
 *
 * IN-PROCESS (not a CLI shell-out): semantic recall needs the async, host-side jina ScoreProvider,
 * which the CLI path can't use (CLI is keyword-only by design). So this hook imports the memcarry
 * lib + the host provider directly, embeds up front, and runs recall() with the sync provider.
 *
 * Degrade WITHOUT crashing (observability rule, not silent): embedder down → keyword-only recall;
 * store/lib unavailable → emit nothing + heartbeat the degrade. Never throws, always exit 0.
 *
 * Reads stdin JSON: { session_id, prompt?, cwd? }. CLAUDE_PROJECT_DIR from env.
 */
import { basename } from "node:path";
import { appendFileSync, readFileSync } from "node:fs";
import { recallLessons } from "./lib/memcarry-semantic.js";
import { emitMemoryTelemetry } from "./lib/memory-telemetry";

const PAI = process.env.PAI_DIR ?? `${process.env.HOME}/.claude`;
const STORE = process.env.MEMCARRY_STORE ?? `${PAI}/MEMORY/memcarry/store`;
const CACHE = process.env.MEMCARRY_VEC_CACHE ?? `${PAI}/memcarry/index/recall-vectors.json`;
const K = Number(process.env.MEMCARRY_RECALL_K ?? 5);

function beat(note: string) {
  try {
    appendFileSync(
      `${PAI}/MEMORY/STATE/memcarry-heartbeat.jsonl`,
      JSON.stringify({ ts: new Date().toISOString(), hook: "UserPromptSubmit-recall", note }) + "\n"
    );
  } catch {}
}

function readStdin(): any {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

async function main() {
  const input = readStdin();
  const prompt: string = input.prompt ?? input.user_prompt ?? "";
  if (!prompt.trim()) process.exit(0); // nothing to recall against

  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
  const project = basename(projectDir);

  // Shared recall flow (same helper PostCompactRecovery uses — single source, can't drift).
  const t0 = Date.now();
  const { hits, semantic } = await recallLessons(STORE, CACHE, prompt, project, K, beat);
  emitMemoryTelemetry("recall.latency", {
    session_id: input.session_id,
    project,
    provider: "MemRecall",
    source: "memcarry",
    semantic,
    hits: hits.length,
    ms: Date.now() - t0,
  });
  if (hits.length === 0) {
    beat(`no recall hits (semantic=${semantic ? "on" : "off"})`);
    process.exit(0);
  }

  const lines = [`<memcarry-recall>`];
  for (const h of hits) lines.push(`- [${h.id}] ${h.claim}`); // id shown so it can be named for `refine` (backflow)
  lines.push(`</memcarry-recall>`);
  beat(`recalled ${hits.length} (semantic=${semantic ? "on" : "off"}) for ${project}`);
  emitMemoryTelemetry("recall.surfaced", {
    session_id: input.session_id,
    project,
    provider: "MemRecall",
    source: "memcarry",
    source_type: "memcarry",
    count: hits.length,
    sources: hits.map((h) => h.id),
    semantic,
  });

  // Record which GLOBAL lesson ids were recalled this session → the End-skill backflow safety net
  // (FR8) reads this to ask "did you learn anything that refines these?". Keyed by session_id.
  try {
    const sid = input.session_id ?? "nosession";
    const globalIds = hits.filter((h) => h.scope === "global").map((h) => h.id);
    if (globalIds.length) {
      appendFileSync(
        `${PAI}/MEMORY/STATE/memcarry-recalled-${sid}.jsonl`,
        globalIds.map((id) => JSON.stringify({ ts: new Date().toISOString(), id })).join("\n") + "\n"
      );
    }
  } catch {}

  console.log(JSON.stringify({ additionalContext: lines.join("\n") }));
}

main().catch((e) => {
  // Final backstop: never let the hook throw into the session. Log, exit 0.
  try { beat(`uncaught: ${(e as Error).message?.slice(0, 80)}`); } catch {}
  process.exit(0);
});
