#!/usr/bin/env bun
/**
 * telemetry-fast-gate.ts — short pre-trial gate for latency telemetry work.
 *
 * Default path runs the wiring doctor plus the focused tests that cover telemetry,
 * hook timeouts, reports, and prompt-latency parsing. Use --reports when you also
 * want the current live telemetry read-out.
 */
import { spawnSync } from 'node:child_process';

export const FOCUSED_TELEMETRY_TESTS = [
  'tests/TelemetryDoctor.test.ts',
  'tests/TurnTelemetry.test.ts',
  'tests/MemoryTelemetryHooks.test.ts',
  'tests/InferenceTelemetry.test.ts',
  'tests/PromptLatencyReport.test.ts',
  'tests/SessionEndComposite.test.ts',
  'tests/RunHookTimeout.test.ts',
] as const;

const REPORTS = [
  ['scripts/prompt-latency-report.ts', '--recent', '10'],
  ['scripts/memory-telemetry-report.ts'],
  ['scripts/inference-telemetry-report.ts'],
] as const;

function run(args: string[], env: NodeJS.ProcessEnv = process.env): void {
  console.log(`\n$ bun ${args.join(' ')}`);
  const result = spawnSync('bun', args, {
    stdio: 'inherit',
    env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function main(): void {
  const withReports = process.argv.includes('--reports');
  const env = { ...process.env, PAI_DIR: process.env.PAI_DIR ?? process.cwd() };

  run(['scripts/telemetry-doctor.ts'], env);
  run(['test', ...FOCUSED_TELEMETRY_TESTS], env);

  if (withReports) {
    for (const report of REPORTS) run([...report], env);
  }

  console.log('\n✓ telemetry fast gate passed');
}

if (import.meta.main) main();
