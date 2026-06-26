/**
 * PromptInferenceLatency.test.ts — UserPromptSubmit hot-path inference guard
 *
 * RatingCapture and UpdateTabTitle used to run LLM inference on every prompt.
 * In live Claude Code, UserPromptSubmit waits on these hook processes despite
 * async=true, so 10–12s inference timeouts stall every prompt. These tests pin
 * the fast default: deterministic behavior stays on; per-prompt inference is
 * opt-in via env vars.
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'bun';

const RATING_HOOK = join(import.meta.dir, '../hooks/RatingCapture.hook.ts');
const TAB_HOOK = join(import.meta.dir, '../hooks/UpdateTabTitle.hook.ts');

function createFixture(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pai-prompt-inference-'));
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({
    daidentity: { name: 'TestDA', displayName: 'TestDA', color: '#3B82F6' },
    principal: { name: 'TestUser', timezone: 'UTC' },
    env: { PAI_DIR: dir },
  }, null, 2));
  mkdirSync(join(dir, 'MEMORY', 'STATE'), { recursive: true });
  mkdirSync(join(dir, 'MEMORY', 'LEARNING', 'SIGNALS'), { recursive: true });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

async function runHook(
  hookPath: string,
  payload: Record<string, unknown>,
  env: Record<string, string>,
): Promise<{ exitCode: number; stderr: string; durationMs: number }> {
  const start = Date.now();
  const proc = spawn({
    cmd: ['bun', hookPath],
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      TERM: '',
      TERM_PROGRAM: '',
      KITTY_LISTEN_ON: '',
      KITTY_WINDOW_ID: '',
      ...env,
      PAI_ENABLE_IMPLICIT_RATING_INFERENCE: env.PAI_ENABLE_IMPLICIT_RATING_INFERENCE ?? '',
      PAI_ENABLE_TAB_TITLE_INFERENCE: env.PAI_ENABLE_TAB_TITLE_INFERENCE ?? '',
    },
  });

  proc.stdin.write(JSON.stringify(payload));
  proc.stdin.end();

  const [stderr, exitCode] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { exitCode, stderr, durationMs: Date.now() - start };
}

describe('UserPromptSubmit inference latency guard', () => {
  test('RatingCapture skips implicit LLM sentiment inference by default', async () => {
    const fixture = createFixture();
    try {
      const result = await runHook(RATING_HOOK, {
        hook_event_name: 'UserPromptSubmit',
        session_id: 'latency-rating',
        prompt: 'ok merged',
        transcript_path: join(fixture.dir, 'missing-transcript.jsonl'),
      }, { PAI_DIR: fixture.dir });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('Implicit sentiment inference disabled');
      expect(result.stderr).not.toContain('Running implicit sentiment analysis');
      expect(result.durationMs).toBeLessThan(2000);
    } finally {
      fixture.cleanup();
    }
  });

  test('UpdateTabTitle uses deterministic title path by default', async () => {
    const fixture = createFixture();
    try {
      const result = await runHook(TAB_HOOK, {
        hook_event_name: 'UserPromptSubmit',
        session_id: 'latency-tab',
        prompt: 'review PR15',
        transcript_path: join(fixture.dir, 'missing-transcript.jsonl'),
      }, { PAI_DIR: fixture.dir });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('Inference disabled');
      expect(result.stderr).toContain('[UpdateTabTitle] "Reviewing PR15."');
      expect(result.durationMs).toBeLessThan(2000);
    } finally {
      fixture.cleanup();
    }
  });
});
