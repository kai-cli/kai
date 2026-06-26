#!/usr/bin/env bun
/**
 * ci-observability.ts — summarize CI logs into actionable diagnostics.
 *
 * Reads Bun/test/gate output and reports:
 * - slowest tests/steps with parsed durations
 * - timeout counts
 * - failure classification: likely infra/network vs code/unknown
 *
 * It is report-only by default: exit status is controlled by the underlying gate,
 * not by this summarizer.
 */

import { readFileSync } from 'fs';

export interface TimedEntry {
  name: string;
  ms: number;
}

export interface CiObservation {
  slowest: TimedEntry[];
  timeout_count: number;
  classification: 'infra/network' | 'code' | 'unknown';
  signals: string[];
}

const PASS_LINE = /^\((?:pass|fail)\)\s+(.+?)\s+\[([0-9.]+)(ms|s)\]$/;

function toMs(value: string, unit: string): number {
  const n = Number(value);
  return unit === 's' ? n * 1000 : n;
}

export function parseTimedEntries(output: string): TimedEntry[] {
  const entries: TimedEntry[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(PASS_LINE);
    if (!match) continue;
    entries.push({ name: match[1].trim(), ms: toMs(match[2], match[3]) });
  }
  return entries.sort((a, b) => b.ms - a.ms);
}

export function countTimeouts(output: string): number {
  const matches = output.match(/\b(timeout|timed out|TimeoutError|ETIMEDOUT)\b/gi);
  return matches?.length ?? 0;
}

export function classifyFailure(output: string): { classification: CiObservation['classification']; signals: string[] } {
  const signals: string[] = [];

  const infraPatterns: Array<[RegExp, string]> = [
    [/\b(ECONNRESET|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network issue|DNS|TLS handshake|rate limit|429)\b/i, 'network/transport signal'],
    [/\bapt-get update\b.*\bfailed\b/i, 'package manager/update failure'],
    [/\bFailed to fetch\b/i, 'dependency fetch failure'],
    [/\btimeout\b/i, 'timeout signal'],
    [/\bbun .*panic|crash-on-exit|segmentation fault\b/i, 'runtime crash signal'],
  ];

  const codePatterns: Array<[RegExp, string]> = [
    [/[1-9][0-9]*\s+fail\b/i, 'test failure count'],
    [/\bAssertionError\b/i, 'assertion failure'],
    [/\bexpect\(.*\)/i, 'expectation failure'],
    [/\bTypeError|ReferenceError|SyntaxError\b/i, 'runtime/code exception'],
    [/\berror:\s+expect\(received\)/i, 'bun expectation failure'],
  ];

  for (const [pattern, signal] of infraPatterns) {
    if (pattern.test(output)) signals.push(signal);
  }
  for (const [pattern, signal] of codePatterns) {
    if (pattern.test(output)) signals.push(signal);
  }

  const hasInfra = signals.some(s => /network|package|fetch|timeout|runtime crash/.test(s));
  const hasCode = signals.some(s => /test|assertion|expectation|exception|bun expectation/.test(s));

  if (hasInfra && !hasCode) return { classification: 'infra/network', signals };
  if (hasCode) return { classification: 'code', signals };
  return { classification: 'unknown', signals };
}

export function analyzeCiOutput(output: string, limit = 10): CiObservation {
  const slowest = parseTimedEntries(output).slice(0, limit);
  const timeout_count = countTimeouts(output);
  const { classification, signals } = classifyFailure(output);
  return { slowest, timeout_count, classification, signals };
}

export function formatObservation(obs: CiObservation): string {
  const lines: string[] = [
    '## CI observability',
    '',
    `Failure classification: ${obs.classification}`,
    `Timeout signals: ${obs.timeout_count}`,
  ];

  if (obs.signals.length > 0) {
    lines.push(`Signals: ${[...new Set(obs.signals)].join(', ')}`);
  }

  lines.push('', 'Slowest parsed tests/steps:');
  if (obs.slowest.length === 0) {
    lines.push('- none parsed');
  } else {
    for (const entry of obs.slowest) {
      lines.push(`- ${entry.ms.toFixed(entry.ms >= 100 ? 0 : 2)} ms — ${entry.name}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

if (import.meta.main) {
  const args = new Map<string, string>();
  for (let i = 2; i < Bun.argv.length; i++) {
    const arg = Bun.argv[i];
    if (arg.startsWith('--') && Bun.argv[i + 1] && !Bun.argv[i + 1].startsWith('--')) {
      args.set(arg.slice(2), Bun.argv[++i]);
    }
  }

  const file = args.get('file');
  const limit = Number(args.get('limit') || '10');
  const output = file ? readFileSync(file, 'utf8') : await new Response(Bun.stdin.stream()).text();
  const formatted = formatObservation(analyzeCiOutput(output, limit));
  console.log(formatted);
}
