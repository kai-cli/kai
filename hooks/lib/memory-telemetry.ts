/**
 * memory-telemetry.ts — the observability substrate for the memory track (Phase 1).
 *
 * Emits typed, append-only telemetry events to MEMORY/STATE/memory-telemetry.jsonl so we can later
 * PROVE a change helped (the rayhunter loss was invisible precisely because none of this existed).
 * See docs/planning/MEMORY-ARCHITECTURE-PLAN.md §7 Phase 1.
 *
 * HARD RULE: every emit is non-blocking and swallows its own errors — telemetry must NEVER disrupt a
 * hook or the turn. This mirrors the events.jsonl contract (synchronous appendFileSync, errors eaten).
 *
 * The metrics, with their plan-defined meanings:
 *  - recall.surfaced / recall.hit  → recall HIT-RATE. A "hit" = a surfaced memory whose source file is
 *    subsequently Read in the same session (the useful-recall proxy). Surfaced is logged at recall
 *    time; the hit is logged later by the Read-side correlation. Rate = hits / surfaced.
 *  - memory.save                   → SAVE-EVENTS-PER-PROJECT. A project worked but showing 0 saves is
 *    the rayhunter signature.
 *  - recall.latency / capture.latency → wall-time of those paths (ms). Health + revert signal.
 *  - coherence.drift               → the D2 proceed-to-5 TRIGGER metric: facts diverging between the
 *    PAI .md store and the atom store (correctness drift; see plan §6/§9 — sufficient-not-necessary).
 *  - agent.return / agent.checkpoint → Phase-0 capture-loss-guard signal (subagent returned; parent
 *    prompted to persist).
 *  - knowledge.sync                → KnowledgeSync run/domain cost baseline: mode, status, facts,
 *    output size, and wall time. Observability only; must not change SessionEnd behavior.
 *  - session_end.composite         → SessionEndComposite gate observability: metrics, selected/skipped
 *    hooks, succeeded/failed counts, and wall time. This explains why KnowledgeSync did or did not run.
 *  - turn.prompt                   → cheap UserPromptSubmit heartbeat. Metadata only; proves prompt
 *    telemetry is wired and gives offline reports a per-turn anchor before model response latency.
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

export type MemoryTelemetryType =
  | 'recall.surfaced'
  | 'recall.hit'
  | 'memory.save'
  | 'recall.latency'
  | 'capture.latency'
  | 'coherence.drift'
  | 'agent.return'
  | 'agent.checkpoint'
  | 'knowledge.sync'
  | 'session_end.composite'
  | 'turn.prompt';

export interface MemoryTelemetryEvent {
  ts: string;
  type: MemoryTelemetryType;
  session_id?: string;
  project?: string;
  /** type-specific payload: { count?, ms?, source?, agent_type?, surfaced?, ... } */
  [k: string]: unknown;
}

function paiDir(): string {
  return process.env.PAI_DIR ?? `${process.env.HOME}/.claude`;
}

export function telemetryPath(): string {
  return join(paiDir(), 'MEMORY', 'STATE', 'memory-telemetry.jsonl');
}

/**
 * Append one telemetry event. Never throws. Returns true if written, false if swallowed —
 * callers ignore the return; it exists only for tests.
 */
export function emitMemoryTelemetry(
  type: MemoryTelemetryType,
  fields: Record<string, unknown> = {},
): boolean {
  try {
    const ts = fields.ts as string | undefined ?? isoNow(fields.now as number | undefined);
    const event: MemoryTelemetryEvent = { ts, type, ...fields };
    delete (event as Record<string, unknown>).now;
    const path = telemetryPath();
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(event) + '\n');
    return true;
  } catch {
    return false;
  }
}

/** ISO timestamp. Accepts an injected epoch-ms for testability (Date.now() is disallowed in some contexts). */
function isoNow(nowMs?: number): string {
  try {
    return new Date(nowMs ?? Date.now()).toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

/** Convenience: wall-time a sync fn and emit a latency event. Never throws from the emit side. */
export function timeAndEmit<T>(
  type: 'recall.latency' | 'capture.latency',
  fn: () => T,
  fields: Record<string, unknown> = {},
): T {
  const start = nowMsSafe();
  try {
    return fn();
  } finally {
    const ms = nowMsSafe() - start;
    emitMemoryTelemetry(type, { ...fields, ms });
  }
}

function nowMsSafe(): number {
  try { return Date.now(); } catch { return 0; }
}

/**
 * Read all telemetry events (for the readout script). Returns [] on any error.
 * Bounded: callers should treat this as a tail-friendly log, not unbounded growth (rotation TODO Phase 1b).
 */
export function readTelemetry(): MemoryTelemetryEvent[] {
  try {
    return readFileSync(telemetryPath(), 'utf-8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        try { return JSON.parse(l) as MemoryTelemetryEvent; } catch { return null; }
      })
      .filter((e): e is MemoryTelemetryEvent => e !== null);
  } catch {
    return [];
  }
}
