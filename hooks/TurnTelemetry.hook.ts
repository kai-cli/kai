#!/usr/bin/env bun
/**
 * TurnTelemetry.hook.ts — metadata-only UserPromptSubmit heartbeat.
 *
 * This does not record prompt text. It only proves the prompt-path telemetry hook fired and gives
 * latency reports a cheap per-turn anchor to correlate against memory/inference/session logs.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { emitMemoryTelemetry } from './lib/memory-telemetry';

interface PromptInput {
  session_id?: string;
  transcript_path?: string;
  hook_event_name?: string;
  cwd?: string;
  prompt?: string;
  user_prompt?: string;
}

function readInput(): PromptInput {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}') as PromptInput;
  } catch {
    return {};
  }
}

function projectName(input: PromptInput): string {
  const dir = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
  return dir.split('/').filter(Boolean).pop() ?? 'unknown';
}

function main(): void {
  try {
    const input = readInput();
    const prompt = input.prompt ?? input.user_prompt ?? '';
    emitMemoryTelemetry('turn.prompt', {
      session_id: input.session_id,
      project: projectName(input),
      hook_event_name: input.hook_event_name ?? 'UserPromptSubmit',
      transcript: input.transcript_path ? basename(input.transcript_path) : undefined,
      prompt_chars: typeof prompt === 'string' ? prompt.length : 0,
    });
  } catch {
    // Telemetry is strictly fail-open.
  }
  process.exit(0);
}

if (import.meta.main) main();
