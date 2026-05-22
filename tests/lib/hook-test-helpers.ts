/**
 * hook-test-helpers.ts — Shared fixtures for subprocess hook tests.
 *
 * Creates a minimal temp PAI_DIR with just enough structure for hooks to run.
 */

import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawn } from "bun";

export interface TempPaiDir {
  path: string;
  cleanup: () => void;
}

export function createTempPaiDir(suffix: string = ""): TempPaiDir {
  const path = join(tmpdir(), `pai-hook-test-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(join(path, "MEMORY", "STATE"), { recursive: true });
  mkdirSync(join(path, "MEMORY", "KNOWLEDGE"), { recursive: true });
  mkdirSync(join(path, "MEMORY", "WORK"), { recursive: true });
  mkdirSync(join(path, "config"), { recursive: true });
  mkdirSync(join(path, "skills"), { recursive: true });
  return {
    path,
    cleanup: () => { if (existsSync(path)) rmSync(path, { recursive: true }); },
  };
}

export function writeSettings(paiDir: string, settings: Record<string, unknown>): void {
  writeFileSync(join(paiDir, "settings.json"), JSON.stringify(settings, null, 2));
}

export function writeSchema(paiDir: string, schema: Record<string, unknown>): void {
  writeFileSync(join(paiDir, "settings-schema.json"), JSON.stringify(schema, null, 2));
}

export interface HookResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runHook(
  hookPath: string,
  paiDir: string,
  opts?: { stdin?: string; env?: Record<string, string> }
): Promise<HookResult> {
  const proc = spawn(["bun", "run", hookPath], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: opts?.stdin ? new Response(opts.stdin).body! : undefined,
    env: { ...process.env, PAI_DIR: paiDir, ...opts?.env },
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}
