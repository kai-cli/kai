/**
 * hook-harness.ts - End-to-end test harness for hooks
 *
 * PURPOSE:
 * Provides utilities to spawn hooks as subprocesses and capture their output.
 * Used for integration/e2e testing to verify hooks behave correctly in isolation.
 *
 * USAGE:
 * import { runHook } from './e2e/hook-harness';
 *
 * const result = await runHook('/path/to/hook.ts', {
 *   session_id: 'test-session',
 *   tool_name: 'Bash',
 *   tool_input: { command: 'ls -la' }
 * });
 *
 * expect(result.exitCode).toBe(0);
 * expect(result.stdout).toContain('continue');
 */

import { spawn } from 'bun';

export interface HookResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run a hook with JSON input via stdin and capture output.
 *
 * @param hookPath - Absolute path to the hook file
 * @param stdin - Object to serialize as JSON and pipe to stdin
 * @param env - Optional environment variables to set
 * @returns Promise resolving to stdout, stderr, and exit code
 */
export async function runHook(
  hookPath: string,
  stdin: object,
  env?: Record<string, string>
): Promise<HookResult> {
  const stdinData = JSON.stringify(stdin);

  // Spawn the hook process
  const proc = spawn({
    cmd: ['bun', 'run', hookPath],
    env: {
      ...process.env,
      ...env,
    },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  // Write stdin data
  proc.stdin.write(stdinData);
  proc.stdin.end();

  // Capture stdout and stderr using Promise.all to avoid race conditions
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  // Wait for process to exit
  const exitCode = await proc.exited;

  return {
    stdout,
    stderr,
    exitCode,
  };
}
