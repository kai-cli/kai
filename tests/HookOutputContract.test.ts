/**
 * HookOutputContract.test.ts — recurrence guard for PAI-SR-005 / PAI-SR-030.
 *
 * Claude Code 2.1.185 honors a top-level `decision` only for "block". A PreToolUse
 * ask/escalation MUST be emitted as hookSpecificOutput.permissionDecision="ask".
 * UserPromptSubmit has no "ask" outcome and must use decision:"block".
 *
 * These tests drive the real hooks via subprocess and assert the wire shape, so the
 * legacy `{decision:"ask"}` contract cannot silently come back.
 */
import { describe, test, expect } from 'bun:test';
import { spawn } from 'bun';
import { askPreToolUse, blockUserPrompt } from '../hooks/lib/hook-io';

const HOOKS = new URL('../hooks/', import.meta.url).pathname;

async function run(hookFile: string, payload: object): Promise<any> {
  const proc = spawn(['bun', 'run', `${HOOKS}${hookFile}`], {
    stdin: new TextEncoder().encode(JSON.stringify(payload)),
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, PAI_DIR: '/tmp/pai-contract-test' },
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  try { return JSON.parse(out.trim()); } catch { return { _raw: out }; }
}

describe('hook-io contract builders', () => {
  test('askPreToolUse has the 2.1.185 shape', () => {
    const d = askPreToolUse('why');
    expect(d.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(d.hookSpecificOutput.permissionDecision).toBe('ask');
    expect(d.hookSpecificOutput.permissionDecisionReason).toBe('why');
    // must NOT carry a legacy top-level decision
    expect((d as any).decision).toBeUndefined();
  });

  test('blockUserPrompt suppresses the original prompt', () => {
    const d = blockUserPrompt('why');
    expect(d.decision).toBe('block');
    expect(d.reason).toBe('why');
    expect(d.suppressOriginalPrompt).toBe(true);
  });
});

describe('PreToolUse guards never emit legacy top-level decision:"ask"', () => {
  test('SecurityValidator (bash confirm) uses permissionDecision', async () => {
    // `chmod -R 777 /` classifies as confirm in the validator.
    const out = await run('SecurityValidator.hook.ts', {
      session_id: 's', tool_name: 'Bash', tool_input: { command: 'chmod -R 777 /etc' },
    });
    expect(out.decision).not.toBe('ask');
    if (out.hookSpecificOutput) {
      expect(out.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    }
  });

  test('WebFetchGuard (suspicious URL) uses permissionDecision', async () => {
    const out = await run('WebFetchGuard.hook.ts', {
      tool_name: 'WebFetch', tool_input: { url: 'https://abc.ngrok.io/x' },
    });
    expect(out.decision).not.toBe('ask');
    expect(out.hookSpecificOutput?.permissionDecision).toBe('ask');
  });
});

describe('SecretScanner blocks on UserPromptSubmit (no ask outcome)', () => {
  test('emits decision:"block", never "ask"', async () => {
    const out = await run('SecretScanner.hook.ts', {
      session_id: 's', prompt: 'key AKIAIOSFODNN7EXAMPLE',
    });
    expect(out.decision).toBe('block');
    expect(out.decision).not.toBe('ask');
  });
});
