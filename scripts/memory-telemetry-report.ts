#!/usr/bin/env bun
/**
 * memory-telemetry-report.ts — read-out for the Phase-1 memory observability substrate.
 *
 * Reads MEMORY/STATE/memory-telemetry.jsonl and prints current counts + the two headline metrics
 * (recall hit-rate, save-events-per-project) plus latency summaries. This is the "prove a change
 * helped" surface (MEMORY-ARCHITECTURE-PLAN.md §7 Phase 1). Baselines accumulate over real sessions —
 * run this after ~10 sessions to read the pre-change baseline before Phase 2a touches scoring.
 *
 * Read-only. Usage: bun scripts/memory-telemetry-report.ts [--json]
 */
import { readTelemetry, type MemoryTelemetryEvent } from '../hooks/lib/memory-telemetry';

function fmt(n: number, d = 1): string {
  return Number.isFinite(n) ? n.toFixed(d) : '—';
}

function pct(num: number, den: number): string {
  if (den === 0) return '— (no data yet)';
  return `${fmt((num / den) * 100)}% (${num}/${den})`;
}

function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function latencySummary(xs: number[]): { count: number; p50: number; p95: number } {
  return {
    count: xs.length,
    p50: percentile(xs, 50),
    p95: percentile(xs, 95),
  };
}

function recallLatencyByProvider(events: MemoryTelemetryEvent[]): Record<string, { count: number; p50: number; p95: number }> {
  const grouped = new Map<string, number[]>();
  for (const e of events.filter(e => e.type === 'recall.latency')) {
    const ms = Number(e.ms);
    if (!Number.isFinite(ms)) continue;
    const provider = String(e.provider ?? e.source ?? e.path ?? 'unknown');
    const arr = grouped.get(provider) ?? [];
    arr.push(ms);
    grouped.set(provider, arr);
  }
  return Object.fromEntries([...grouped.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([provider, ms]) => [provider, latencySummary(ms)]));
}

function projectActivity(events: MemoryTelemetryEvent[]): {
  activeProjects: string[];
  zeroSaveProjects: string[];
} {
  const active = new Set<string>();
  const saved = new Set<string>();

  for (const e of events) {
    const project = typeof e.project === 'string' && e.project.trim() ? e.project.trim() : '';
    if (!project || project === 'unknown') continue;
    active.add(project);
    if (e.type === 'memory.save') saved.add(project);
  }

  return {
    activeProjects: [...active].sort(),
    zeroSaveProjects: [...active].filter(p => !saved.has(p)).sort(),
  };
}

function knowledgeSyncSummary(events: MemoryTelemetryEvent[]): {
  runs: { count: number; p50: number; p95: number };
  domains: { count: number; p50: number; p95: number };
  domains_by_status: Record<string, number>;
  runs_by_status: Record<string, number>;
  updated_domains: number;
  skipped_domains: number;
} {
  const knowledgeEvents = events.filter(e => e.type === 'knowledge.sync');
  const runMs = knowledgeEvents
    .filter(e => e.phase === 'complete')
    .map(e => Number(e.ms))
    .filter(Number.isFinite);
  const domainMs = knowledgeEvents
    .filter(e => e.phase === 'domain')
    .map(e => Number(e.ms))
    .filter(Number.isFinite);

  const domainsByStatus = new Map<string, number>();
  const runsByStatus = new Map<string, number>();
  let updatedDomains = 0;
  let skippedDomains = 0;

  for (const e of knowledgeEvents) {
    const status = String(e.status ?? 'unknown');
    if (e.phase === 'domain') {
      domainsByStatus.set(status, (domainsByStatus.get(status) ?? 0) + 1);
      if (status === 'updated') updatedDomains++;
      if (status === 'skipped') skippedDomains++;
    }
    if (e.phase === 'complete') {
      runsByStatus.set(status, (runsByStatus.get(status) ?? 0) + 1);
    }
  }

  return {
    runs: latencySummary(runMs),
    domains: latencySummary(domainMs),
    domains_by_status: Object.fromEntries(domainsByStatus),
    runs_by_status: Object.fromEntries(runsByStatus),
    updated_domains: updatedDomains,
    skipped_domains: skippedDomains,
  };
}

function sessionEndCompositeSummary(events: MemoryTelemetryEvent[]): {
  decisions: number;
  completes: { count: number; p50: number; p95: number };
  trivial: number;
  substantial: number;
  skipped_hooks_total: number;
  selected_hooks_total: number;
  by_status: Record<string, number>;
} {
  const compositeEvents = events.filter(e => e.type === 'session_end.composite');
  const decisionEvents = compositeEvents.filter(e => e.phase === 'decision');
  const completeEvents = compositeEvents.filter(e => e.phase === 'complete');
  const completeMs = completeEvents.map(e => Number(e.ms)).filter(Number.isFinite);
  const byStatus = new Map<string, number>();
  for (const e of completeEvents) {
    const status = String(e.status ?? 'unknown');
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
  }

  return {
    decisions: decisionEvents.length,
    completes: latencySummary(completeMs),
    trivial: decisionEvents.filter(e => e.trivial === true).length,
    substantial: decisionEvents.filter(e => e.trivial === false).length,
    skipped_hooks_total: decisionEvents.reduce((n, e) => n + (Number(e.skipped_count) || 0), 0),
    selected_hooks_total: decisionEvents.reduce((n, e) => n + (Number(e.selected_count) || 0), 0),
    by_status: Object.fromEntries(byStatus),
  };
}

function agentReturnSummary(events: MemoryTelemetryEvent[]): {
  spawns: number;
  returns: number;
  checkpoints: number;
  task_completed: number;
  idle: number;
  returns_without_checkpoint_prompt: number;
  return_status: Record<string, number>;
  missing_context_handoff: number;
  spawn_to_return_latency: { count: number; p50: number; p95: number };
  result_chars: { count: number; p50: number; p95: number; total: number; max: number };
  by_project: Record<string, { returns: number; total_chars: number; max_chars: number }>;
  largest_returns: Array<{ ts: string; project: string; agent_type: string; description: string; result_chars: number }>;
} {
  const spawns = events.filter(e => e.type === 'agent.spawn');
  const returns = events.filter(e => e.type === 'agent.return');
  const checkpointEvents = events.filter(e => e.type === 'agent.checkpoint');
  const completedEvents = events.filter(e => e.type === 'agent.task_completed');
  const idleEvents = events.filter(e => e.type === 'agent.idle');
  const checkpoints = checkpointEvents.length;
  const checkpointIds = new Set(checkpointEvents.map(e => String(e.agent_call_id ?? '')).filter(Boolean));
  const sizes = returns.map(e => Number(e.result_chars)).filter(Number.isFinite);
  const byProject = new Map<string, { returns: number; total_chars: number; max_chars: number }>();
  const byStatus = new Map<string, number>();
  const spawnTimes = new Map<string, number>();
  const latencies: number[] = [];

  for (const e of spawns) {
    const id = String(e.agent_call_id ?? '');
    const t = Date.parse(String(e.ts ?? ''));
    if (id && Number.isFinite(t) && !spawnTimes.has(id)) spawnTimes.set(id, t);
  }

  for (const e of returns) {
    const project = String(e.project ?? 'unknown');
    const chars = Number(e.result_chars);
    const status = String(e.return_status ?? 'ok');
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
    const id = String(e.agent_call_id ?? '');
    const spawnedAt = id ? spawnTimes.get(id) : undefined;
    const returnedAt = Date.parse(String(e.ts ?? ''));
    if (spawnedAt !== undefined && Number.isFinite(returnedAt) && returnedAt >= spawnedAt) {
      latencies.push(returnedAt - spawnedAt);
    }
    const row = byProject.get(project) ?? { returns: 0, total_chars: 0, max_chars: 0 };
    row.returns++;
    if (Number.isFinite(chars)) {
      row.total_chars += chars;
      row.max_chars = Math.max(row.max_chars, chars);
    }
    byProject.set(project, row);
  }

  const largest = returns
    .map(e => ({
      ts: String(e.ts ?? ''),
      project: String(e.project ?? 'unknown'),
      agent_type: String(e.agent_type ?? ''),
      description: String(e.description ?? ''),
      result_chars: Number(e.result_chars) || 0,
    }))
    .sort((a, b) => b.result_chars - a.result_chars)
    .slice(0, 5);

  const sizeSummary = latencySummary(sizes);
  return {
    spawns: spawns.length,
    returns: returns.length,
    checkpoints,
    task_completed: completedEvents.length,
    idle: idleEvents.length,
    returns_without_checkpoint_prompt: returns.filter(e => {
      const id = String(e.agent_call_id ?? '');
      return id ? !checkpointIds.has(id) : true;
    }).length,
    return_status: Object.fromEntries(byStatus),
    missing_context_handoff: spawns.filter(e => e.context_handoff_missing === true).length,
    spawn_to_return_latency: latencySummary(latencies),
    result_chars: {
      ...sizeSummary,
      total: sizes.reduce((n, x) => n + x, 0),
      max: sizes.length ? Math.max(...sizes) : 0,
    },
    by_project: Object.fromEntries([...byProject.entries()].sort((a, b) => b[1].total_chars - a[1].total_chars)),
    largest_returns: largest,
  };
}

function turnPromptSummary(events: MemoryTelemetryEvent[]): {
  count: number;
  by_project: Record<string, number>;
  last_ts?: string;
} {
  const turns = events.filter(e => e.type === 'turn.prompt');
  const byProject = new Map<string, number>();
  for (const e of turns) {
    const project = String(e.project ?? 'unknown');
    byProject.set(project, (byProject.get(project) ?? 0) + 1);
  }
  const last = turns
    .map(e => String(e.ts ?? ''))
    .filter(Boolean)
    .sort()
    .at(-1);
  return {
    count: turns.length,
    by_project: Object.fromEntries([...byProject.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
    ...(last ? { last_ts: last } : {}),
  };
}

function main(): void {
  const events: MemoryTelemetryEvent[] = readTelemetry();
  const asJson = process.argv.includes('--json');

  const byType = new Map<string, number>();
  for (const e of events) byType.set(e.type, (byType.get(e.type) ?? 0) + 1);

  // Recall hit-rate: hits / surfaced (surfaced counts the events; surfaced.count is per-event match count).
  const surfacedEvents = events.filter(e => e.type === 'recall.surfaced');
  const hitEvents = events.filter(e => e.type === 'recall.hit');
  const surfacedCount = surfacedEvents.length;
  const hitCount = hitEvents.length;

  // Save-events per project.
  const savesByProject = new Map<string, number>();
  for (const e of events.filter(e => e.type === 'memory.save')) {
    const p = (e.project as string) ?? 'unknown';
    savesByProject.set(p, (savesByProject.get(p) ?? 0) + 1);
  }

  // Latency summaries (p50/p95).
  const recallMs = events.filter(e => e.type === 'recall.latency').map(e => Number(e.ms)).filter(Number.isFinite);
  const captureMs = events.filter(e => e.type === 'capture.latency').map(e => Number(e.ms)).filter(Number.isFinite);
  const recallByProvider = recallLatencyByProvider(events);
  const { activeProjects, zeroSaveProjects } = projectActivity(events);
  const knowledgeSync = knowledgeSyncSummary(events);
  const sessionEndComposite = sessionEndCompositeSummary(events);
  const agentReturn = agentReturnSummary(events);
  const turnPrompt = turnPromptSummary(events);

  // Agent capture-loss-guard activity (Phase 0).
  const agentReturns = byType.get('agent.return') ?? 0;
  const agentSpawns = byType.get('agent.spawn') ?? 0;
  const agentCheckpoints = byType.get('agent.checkpoint') ?? 0;
  const agentTaskCompleted = byType.get('agent.task_completed') ?? 0;
  const agentIdle = byType.get('agent.idle') ?? 0;

  // Coherence drift (D2 trigger metric).
  const driftCount = byType.get('coherence.drift') ?? 0;

  if (asJson) {
    console.log(JSON.stringify({
      total_events: events.length,
      by_type: Object.fromEntries(byType),
      recall_hit_rate: surfacedCount ? hitCount / surfacedCount : null,
      surfaced: surfacedCount, hits: hitCount,
      saves_by_project: Object.fromEntries(savesByProject),
      active_projects: activeProjects,
      zero_save_projects: zeroSaveProjects,
      recall_latency_p50: percentile(recallMs, 50), recall_latency_p95: percentile(recallMs, 95),
      recall_latency_by_provider: recallByProvider,
      capture_latency_p50: percentile(captureMs, 50), capture_latency_p95: percentile(captureMs, 95),
      knowledge_sync: knowledgeSync,
      session_end_composite: sessionEndComposite,
      agent_return: agentReturn,
      turn_prompt: turnPrompt,
      agent_spawns: agentSpawns, agent_returns: agentReturns, agent_checkpoints: agentCheckpoints,
      agent_task_completed: agentTaskCompleted, agent_idle: agentIdle,
      coherence_drift: driftCount,
    }, null, 2));
    return;
  }

  console.log('\n  MEMORY TELEMETRY — current read-out');
  console.log('  ─────────────────────────────────────────────');
  console.log(`  Total events: ${events.length}`);
  if (events.length === 0) {
    console.log('  (no telemetry yet — emitters are wired; data accumulates over real sessions)\n');
    return;
  }
  console.log('\n  Headline metrics (plan §7 Phase 1):');
  console.log(`    • recall hit-rate         : ${pct(hitCount, surfacedCount)}`);
  console.log(`    • save-events per project :`);
  if (savesByProject.size === 0) console.log('        (none recorded yet)');
  for (const [p, n] of [...savesByProject.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`        ${p.padEnd(28)} ${n}`);
  }
  console.log(`    • active projects w/ zero saves : ${zeroSaveProjects.length}`);
  for (const p of zeroSaveProjects) {
    console.log(`        ${p}`);
  }
  console.log('\n  Latency (ms, p50 / p95):');
  console.log(`    • recall  : ${fmt(percentile(recallMs, 50))} / ${fmt(percentile(recallMs, 95))}  (n=${recallMs.length})`);
  for (const [provider, summary] of Object.entries(recallByProvider)) {
    console.log(`      - ${provider.padEnd(24)} ${fmt(summary.p50)} / ${fmt(summary.p95)}  (n=${summary.count})`);
  }
  console.log(`    • capture : ${fmt(percentile(captureMs, 50))} / ${fmt(percentile(captureMs, 95))}  (n=${captureMs.length})`);
  console.log(`    • KnowledgeSync runs    : ${fmt(knowledgeSync.runs.p50)} / ${fmt(knowledgeSync.runs.p95)}  (n=${knowledgeSync.runs.count})`);
  console.log(`    • KnowledgeSync domains : ${fmt(knowledgeSync.domains.p50)} / ${fmt(knowledgeSync.domains.p95)}  (n=${knowledgeSync.domains.count})`);
  if (knowledgeSync.domains.count > 0) {
    console.log(`      - updated domains      ${knowledgeSync.updated_domains}`);
    console.log(`      - skipped domains      ${knowledgeSync.skipped_domains}`);
  }
  console.log(`    • SessionEndComposite : ${fmt(sessionEndComposite.completes.p50)} / ${fmt(sessionEndComposite.completes.p95)}  (n=${sessionEndComposite.completes.count})`);
  if (sessionEndComposite.decisions > 0) {
    console.log(`      - decisions           ${sessionEndComposite.decisions}`);
    console.log(`      - trivial/substantial ${sessionEndComposite.trivial}/${sessionEndComposite.substantial}`);
    console.log(`      - selected hooks      ${sessionEndComposite.selected_hooks_total}`);
    console.log(`      - skipped hooks       ${sessionEndComposite.skipped_hooks_total}`);
  }
  console.log('\n  Phase-0 capture-loss guard:');
  console.log(`    • subagent spawns       : ${agentSpawns}`);
  console.log(`    • subagent returns      : ${agentReturns}`);
  console.log(`    • checkpoint prompts    : ${agentCheckpoints}`);
  console.log(`    • task completed events : ${agentTaskCompleted}`);
  console.log(`    • idle events           : ${agentIdle}`);
  if (agentReturn.returns > 0) {
    console.log(`    • no-checkpoint returns : ${agentReturn.returns_without_checkpoint_prompt}`);
    console.log(`    • missing handoffs      : ${agentReturn.missing_context_handoff}`);
    console.log(`    • spawn→return ms p50/p95: ${fmt(agentReturn.spawn_to_return_latency.p50, 0)} / ${fmt(agentReturn.spawn_to_return_latency.p95, 0)}  (n=${agentReturn.spawn_to_return_latency.count})`);
    for (const [status, count] of Object.entries(agentReturn.return_status)) {
      console.log(`      - status ${status.padEnd(9)} ${count}`);
    }
    console.log(`    • return chars total    : ${agentReturn.result_chars.total}`);
    console.log(`    • return chars p50/p95  : ${fmt(agentReturn.result_chars.p50, 0)} / ${fmt(agentReturn.result_chars.p95, 0)}`);
    console.log(`    • largest return chars  : ${agentReturn.result_chars.max}`);
    console.log('    • largest returns:');
    for (const r of agentReturn.largest_returns) {
      const desc = r.description ? ` — ${r.description.slice(0, 70)}` : '';
      console.log(`      - ${String(r.result_chars).padStart(6)} ${r.project}${desc}`);
    }
  }
  console.log('\n  Turn telemetry:');
  console.log(`    • prompt heartbeats    : ${turnPrompt.count}`);
  if (turnPrompt.last_ts) console.log(`    • last heartbeat       : ${turnPrompt.last_ts}`);
  for (const [project, count] of Object.entries(turnPrompt.by_project).slice(0, 8)) {
    console.log(`      - ${project.padEnd(24)} ${count}`);
  }
  console.log('\n  D2 trigger metric:');
  console.log(`    • coherence-drift count : ${driftCount}`);
  console.log('\n  Event counts by type:');
  for (const [t, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${t.padEnd(20)} ${n}`);
  }
  console.log('');
}

if (import.meta.main) { main(); }
