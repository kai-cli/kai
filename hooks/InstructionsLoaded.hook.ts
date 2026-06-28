#!/usr/bin/env bun
/**
 * InstructionsLoaded.hook.ts — native instruction-load observability.
 *
 * Telemetry only. This hook records the current event shape and source metadata
 * so instruction churn can be analyzed without prompt-time file polling.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { emitMemoryTelemetry } from './lib/memory-telemetry';

interface InstructionsLoadedInput {
  session_id?: string;
  hook_event_name?: string;
  cwd?: string;
  path?: string;
  file_path?: string;
  memory_type?: string;
  reason?: string;
  source?: string;
  globs?: unknown;
}

function readInput(): InstructionsLoadedInput {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}') as InstructionsLoadedInput;
  } catch {
    return {};
  }
}

function projectName(input: InstructionsLoadedInput): string {
  const dir = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
  return dir.split('/').filter(Boolean).pop() ?? 'unknown';
}

function main(): void {
  try {
    const input = readInput();
    const sourcePath = input.file_path ?? input.path;
    emitMemoryTelemetry('instructions.loaded', {
      session_id: input.session_id,
      project: projectName(input),
      hook_event_name: input.hook_event_name ?? 'InstructionsLoaded',
      source: input.source,
      reason: input.reason,
      memory_type: input.memory_type,
      path: sourcePath,
      file: sourcePath ? basename(sourcePath) : undefined,
      globs_count: Array.isArray(input.globs) ? input.globs.length : undefined,
    });
  } catch {
    // Observability only. Never disrupt instruction loading.
  }
  process.exit(0);
}

if (import.meta.main) main();
