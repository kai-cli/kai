/**
 * inference-telemetry.ts — metadata-only latency telemetry for local PAI inference calls.
 *
 * This intentionally records no prompt text and no model output. It exists to separate
 * Bedrock/API/model latency from hook/runtime latency during live Claude slowdown
 * incidents.
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface InferenceTelemetryEvent {
  ts: string;
  type: 'inference.latency';
  caller: string;
  provider: string;
  model: string;
  level: string;
  success: boolean;
  latency_ms: number;
  timeout_ms: number;
  error_class?: string;
}

function paiDir(): string {
  return process.env.PAI_DIR ?? `${process.env.HOME}/.claude`;
}

export function inferenceTelemetryPath(): string {
  return join(paiDir(), 'MEMORY', 'STATE', 'inference-telemetry.jsonl');
}

export function classifyInferenceError(error?: string): string | undefined {
  if (!error) return undefined;
  if (/timeout|timed out|ETIMEDOUT/i.test(error)) return 'timeout';
  if (/credential|auth|unauthorized|forbidden|AccessDenied|ExpiredToken/i.test(error)) return 'auth';
  if (/network|ECONN|ENOTFOUND|EAI_AGAIN|socket|TLS/i.test(error)) return 'network';
  if (/rate.?limit|throttl/i.test(error)) return 'rate_limit';
  if (/parse|json/i.test(error)) return 'parse';
  if (/code\s+\d+|exited/i.test(error)) return 'process_exit';
  return 'unknown';
}

export function inferProviderFromEnv(): string {
  if (process.env.CLAUDE_CODE_USE_BEDROCK === '1') {
    return 'bedrock-via-claude-cli';
  }
  return 'claude-cli';
}

export function emitInferenceTelemetry(fields: Omit<InferenceTelemetryEvent, 'ts' | 'type'> & { ts?: string }): boolean {
  try {
    const event: InferenceTelemetryEvent = {
      ts: fields.ts ?? new Date().toISOString(),
      type: 'inference.latency',
      caller: fields.caller,
      provider: fields.provider,
      model: fields.model,
      level: fields.level,
      success: fields.success,
      latency_ms: fields.latency_ms,
      timeout_ms: fields.timeout_ms,
      ...(fields.error_class ? { error_class: fields.error_class } : {}),
    };
    const path = inferenceTelemetryPath();
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(event) + '\n');
    return true;
  } catch {
    return false;
  }
}

export function readInferenceTelemetry(): InferenceTelemetryEvent[] {
  try {
    return readFileSync(inferenceTelemetryPath(), 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line) as InferenceTelemetryEvent; } catch { return null; }
      })
      .filter((e): e is InferenceTelemetryEvent => e !== null);
  } catch {
    return [];
  }
}
