#!/usr/bin/env bun
/**
 * inference-telemetry-report.ts — read-only report for PAI inference latency.
 *
 * Usage:
 *   bun scripts/inference-telemetry-report.ts
 *   bun scripts/inference-telemetry-report.ts --json
 */
import { readInferenceTelemetry, type InferenceTelemetryEvent } from '../hooks/lib/inference-telemetry';

function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function fmt(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function summarize(events: InferenceTelemetryEvent[]) {
  const groups = new Map<string, InferenceTelemetryEvent[]>();
  for (const e of events) {
    const key = `${e.caller} | ${e.provider} | ${e.model} | ${e.level}`;
    const arr = groups.get(key) ?? [];
    arr.push(e);
    groups.set(key, arr);
  }

  return [...groups.entries()]
    .map(([key, xs]) => {
      const ms = xs.map(e => Number(e.latency_ms)).filter(Number.isFinite);
      return {
        key,
        count: xs.length,
        success: xs.filter(e => e.success).length,
        failures: xs.filter(e => !e.success).length,
        timeouts: xs.filter(e => e.error_class === 'timeout').length,
        p50: percentile(ms, 50),
        p95: percentile(ms, 95),
        error_classes: xs.reduce<Record<string, number>>((acc, e) => {
          if (e.error_class) acc[e.error_class] = (acc[e.error_class] ?? 0) + 1;
          return acc;
        }, {}),
      };
    })
    .sort((a, b) => b.count - a.count || b.p95 - a.p95);
}

function main(): void {
  const events = readInferenceTelemetry();
  const rows = summarize(events);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ total_events: events.length, groups: rows }, null, 2));
    return;
  }

  console.log('\n  INFERENCE TELEMETRY REPORT');
  console.log('  ─────────────────────────────────────────────');
  console.log(`  Total events: ${events.length}`);
  if (events.length === 0) {
    console.log('  (no local PAI/Tools/Inference telemetry yet)');
    console.log('  Note: this file does not observe Claude Code main-response model latency.\n');
    return;
  }

  for (const row of rows) {
    console.log(`\n  ${row.key}`);
    console.log(`    count=${row.count} success=${row.success} failures=${row.failures} timeouts=${row.timeouts}`);
    console.log(`    latency p50/p95=${fmt(row.p50)} / ${fmt(row.p95)}`);
    const errors = Object.entries(row.error_classes).map(([k, v]) => `${k}:${v}`).join(', ');
    if (errors) console.log(`    errors=${errors}`);
  }
  console.log('');
}

if (import.meta.main) main();
