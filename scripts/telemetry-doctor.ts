#!/usr/bin/env bun
/**
 * telemetry-doctor.ts — verifies latency telemetry is wired before a live trial.
 *
 * Checks source hook config, generated settings.json, timeout headroom, local inference telemetry
 * plumbing, and a hermetic smoke emission for the prompt heartbeat. It never sends prompts to an LLM.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseJSONC } from '../hooks/handlers/BuildSettings';

export interface DoctorResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

type HookConfig = { hooks?: Record<string, Array<{ matcher?: string; hooks?: Array<{ command?: string; async?: boolean }> }>> };

const REQUIRED_CONFIG_HOOKS = [
  { event: 'UserPromptSubmit', hook: 'TurnTelemetry.hook.ts' },
  { event: 'UserPromptSubmit', hook: 'MemoryRecall.hook.ts' },
  { event: 'UserPromptSubmit', hook: 'MemRecall.hook.ts' },
  { event: 'PostToolUse', matcher: 'Agent', hook: 'AgentMemoryCapture.hook.ts' },
  { event: 'SessionEnd', hook: 'SessionEndComposite.hook.ts' },
  { event: 'UserPromptExpansion', hook: 'SkillTracker.hook.ts' },
] as const;

function readConfig(path: string): HookConfig | null {
  try {
    const parsed = parseJSONC(readFileSync(path, 'utf8')) as HookConfig;
    return parsed;
  } catch {
    return null;
  }
}

function readSettings(path: string): HookConfig | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as HookConfig;
  } catch {
    return null;
  }
}

function commandIncludesHook(command: string | undefined, hook: string): boolean {
  return typeof command === 'string'
    && command.includes('/hooks/lib/run-hook.sh')
    && command.includes(hook);
}

function hasHook(config: HookConfig | null, event: string, hook: string, matcher?: string): boolean {
  const groups = config?.hooks?.[event] ?? [];
  return groups.some(group => {
    if (matcher && group.matcher !== matcher) return false;
    return (group.hooks ?? []).some(h => commandIncludesHook(h.command, hook));
  });
}

function checkHookConfig(config: HookConfig | null, label: string, errors: string[], warnings: string[]): void {
  if (!config) {
    warnings.push(`${label}: not readable; skipping hook wiring check`);
    return;
  }
  for (const req of REQUIRED_CONFIG_HOOKS) {
    if (!hasHook(config, req.event, req.hook, 'matcher' in req ? req.matcher : undefined)) {
      errors.push(`${label}: missing ${req.event}${'matcher' in req ? `:${req.matcher}` : ''} → ${req.hook}`);
    }
  }
}

function checkRunHookTimeouts(repo: string, errors: string[]): void {
  const path = join(repo, 'hooks', 'lib', 'run-hook.sh');
  const source = readFileSync(path, 'utf8');
  if (!/KnowledgeSync\)\s+DEFAULT_TIMEOUT=180\b/.test(source)) {
    errors.push('run-hook.sh: KnowledgeSync timeout is not 180s');
  }
  if (!/SessionEndComposite\)\s+DEFAULT_TIMEOUT=240\b/.test(source)) {
    errors.push('run-hook.sh: SessionEndComposite timeout is not 240s');
  }
}

function checkInferencePlumbing(repo: string, errors: string[]): void {
  const source = readFileSync(join(repo, 'PAI', 'Tools', 'Inference.ts'), 'utf8');
  for (const needle of ['emitInferenceTelemetry', 'inferProviderFromEnv', 'classifyInferenceError']) {
    if (!source.includes(needle)) errors.push(`PAI/Tools/Inference.ts: missing ${needle}`);
  }
}

function smokeTurnTelemetry(repo: string, errors: string[]): void {
  const tmp = mkdtempSync(join(tmpdir(), 'pai-telemetry-doctor-'));
  try {
    const hook = join(repo, 'hooks', 'TurnTelemetry.hook.ts');
    const payload = JSON.stringify({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'telemetry-doctor',
      cwd: join(repo),
      prompt: 'diagnostic prompt text',
    });
    const result = spawnSync('bun', [hook], {
      input: payload,
      encoding: 'utf8',
      env: { ...process.env, PAI_DIR: tmp },
    });
    if (result.status !== 0) {
      errors.push(`TurnTelemetry smoke failed with status ${result.status}`);
      return;
    }
    const telemetry = join(tmp, 'MEMORY', 'STATE', 'memory-telemetry.jsonl');
    const lines = existsSync(telemetry) ? readFileSync(telemetry, 'utf8').trim().split('\n').filter(Boolean) : [];
    if (!lines.some(line => {
      try {
        const event = JSON.parse(line);
        return event.type === 'turn.prompt' && event.session_id === 'telemetry-doctor' && event.prompt_chars === 22;
      } catch {
        return false;
      }
    })) {
      errors.push('TurnTelemetry smoke did not emit expected turn.prompt event');
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export function runTelemetryDoctor(repo = process.env.PAI_DIR ?? process.cwd()): DoctorResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  checkHookConfig(readConfig(join(repo, 'config', 'hooks.jsonc')), 'config/hooks.jsonc', errors, warnings);
  checkHookConfig(readSettings(join(repo, 'settings.json')), 'settings.json', errors, warnings);
  checkRunHookTimeouts(repo, errors);
  checkInferencePlumbing(repo, errors);
  smokeTurnTelemetry(repo, errors);
  return { ok: errors.length === 0, errors, warnings };
}

function main(): void {
  const result = runTelemetryDoctor();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  console.log('\n  TELEMETRY DOCTOR');
  console.log('  ─────────────────────────────────────────────');
  for (const warning of result.warnings) console.log(`  ! ${warning}`);
  for (const error of result.errors) console.log(`  ✗ ${error}`);
  if (result.ok) console.log('  ✓ telemetry wiring checks passed');
  console.log('');
  process.exit(result.ok ? 0 : 1);
}

if (import.meta.main) main();
