/**
 * RunHookTiming.test.ts — wrapper-level hook timing diagnostics
 *
 * run-hook.sh is the only place that sees every hook process, so it must log
 * start/end/duration/exit status for latency incident reconstruction.
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'bun';

const RUN_HOOK = join(import.meta.dir, '../hooks/lib/run-hook.sh');
const LOG_FILE = '/tmp/pai-hooks/TestTiming.log';

describe('run-hook.sh timing diagnostics', () => {
  test('logs START and END with status and duration', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pai-run-hook-timing-'));
    try {
      mkdirSync(join(dir, 'hooks'), { recursive: true });
      writeFileSync(join(dir, 'hooks', 'TestTiming.hook.ts'), [
        '#!/usr/bin/env bun',
        'console.error("[TestTiming] stderr is captured");',
        'console.log(JSON.stringify({ continue: true }));',
      ].join('\n'));
      writeFileSync(LOG_FILE, '');

      const proc = spawn({
        cmd: ['bash', RUN_HOOK, 'TestTiming.hook.ts'],
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, PAI_DIR: dir },
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe(JSON.stringify({ continue: true }));
      expect(stderr).toBe('');

      const log = readFileSync(LOG_FILE, 'utf-8');
      expect(log).toContain('run-hook.sh START: TestTiming');
      expect(log).toContain('run-hook.sh END: TestTiming status=0');
      expect(log).toContain('timeout=false');
      expect(log).toMatch(/duration_ms=\d+/);
      expect(log).toContain('[TestTiming] stderr is captured');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
