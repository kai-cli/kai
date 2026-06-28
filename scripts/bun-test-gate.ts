#!/usr/bin/env bun
/**
 * Parse Bun test output as a gate instead of grepping one substring.
 *
 * Fails closed on missing summary, non-zero fail count, zero tests, non-zero
 * exit status, or known runtime crash signatures.
 */

export interface BunTestSummary {
  pass: number;
  skip: number;
  fail: number;
  expectCalls: number | null;
  testsRun: number;
  filesRun: number;
}

export interface BunTestGateResult {
  ok: boolean;
  summary?: BunTestSummary;
  errors: string[];
}

const CRASH_PATTERNS = [
  /panic:/i,
  /segmentation fault/i,
  /\bSIG(?:ABRT|SEGV|BUS|ILL)\b/i,
  /Illegal instruction/i,
  /Bus error/i,
  /core dumped/i,
];

function parseCount(output: string, label: string): number {
  const match = output.match(new RegExp(`(?:^|\\n)\\s*(\\d+)\\s+${label}\\b`, 'i'));
  return match ? Number(match[1]) : 0;
}

export function parseBunTestOutput(output: string): BunTestSummary | null {
  const ran = output.match(/Ran\s+(\d+)\s+tests?\s+across\s+(\d+)\s+files?/i);
  if (!ran) return null;

  const expectMatch = output.match(/(?:^|\n)\s*(\d+)\s+expect\(\)\s+calls?/i);
  return {
    pass: parseCount(output, 'pass'),
    skip: parseCount(output, 'skip'),
    fail: parseCount(output, 'fail'),
    expectCalls: expectMatch ? Number(expectMatch[1]) : null,
    testsRun: Number(ran[1]),
    filesRun: Number(ran[2]),
  };
}

export function validateBunTestOutput(output: string, exitCode: number): BunTestGateResult {
  const errors: string[] = [];
  const summary = parseBunTestOutput(output);

  if (!summary) {
    errors.push('Bun test output did not include a complete "Ran N tests across M files" summary.');
  } else {
    if (summary.testsRun <= 0) errors.push('Bun reported zero tests run.');
    if (summary.filesRun <= 0) errors.push('Bun reported zero test files run.');
    if (summary.fail !== 0) errors.push(`Bun reported ${summary.fail} failing test(s).`);
    if (summary.pass + summary.fail <= 0) errors.push('Bun reported no passing or failing tests.');
  }

  if (exitCode !== 0) errors.push(`Bun exited non-zero (${exitCode}).`);
  for (const pattern of CRASH_PATTERNS) {
    if (pattern.test(output)) {
      errors.push(`Bun output matched crash signature: ${pattern}`);
      break;
    }
  }

  return { ok: errors.length === 0, summary: summary ?? undefined, errors };
}

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of Bun.stdin.stream()) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

function argValue(name: string, fallback = ''): string {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] ?? fallback : fallback;
}

if (import.meta.main) {
  const output = await readStdin();
  const exitCode = Number(argValue('--exit-code', '0'));
  const label = argValue('--label', 'bun test');
  const result = validateBunTestOutput(output, Number.isFinite(exitCode) ? exitCode : 1);

  if (result.ok) {
    const s = result.summary!;
    console.log(`${label}: ${s.pass} pass, ${s.skip} skip, ${s.fail} fail across ${s.filesRun} files`);
    process.exit(0);
  }

  console.error(`${label}: Bun test gate failed`);
  for (const error of result.errors) console.error(`  - ${error}`);
  process.exit(1);
}
