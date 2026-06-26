/**
 * WebFetchGuard.test.ts — Unit tests for hooks/WebFetchGuard.hook.ts
 *
 * Tests URL validation: blocked internal ranges, localhost, file://,
 * suspicious patterns (ask), clean external URLs (allow).
 *
 * Run: bun test tests/WebFetchGuard.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { spawn } from 'bun';

const HOOK = new URL('../hooks/WebFetchGuard.hook.ts', import.meta.url).pathname;

interface HookSpecificOutput {
  hookEventName?: string;
  permissionDecision?: string;
  permissionDecisionReason?: string;
}
async function runGuard(url: string, toolName = 'WebFetch'): Promise<{ decision?: string; continue?: boolean; reason?: string; message?: string; hookSpecificOutput?: HookSpecificOutput }> {
  const payload = JSON.stringify({ tool_name: toolName, tool_input: { url } });
  const proc = spawn(['bun', 'run', HOOK], {
    stdin: new TextEncoder().encode(payload),
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, PAI_DIR: '/tmp/pai-guard-test' },
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return JSON.parse(out);
}

// ── Blocked: internal network ranges ─────────────────────────────────────────

describe('WebFetchGuard — blocked (internal network)', () => {
  test('blocks 10.x.x.x range', async () => {
    const result = await runGuard('http://10.0.0.1/api');
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('internal network');
  });

  test('blocks 192.168.x.x range', async () => {
    const result = await runGuard('http://192.168.1.100/admin');
    expect(result.decision).toBe('block');
  });

  test('blocks 172.16-31.x.x range', async () => {
    const result = await runGuard('http://172.16.0.1/');
    expect(result.decision).toBe('block');
  });

  test('blocks 127.x.x.x loopback', async () => {
    const result = await runGuard('http://127.0.0.1:8080/secret');
    expect(result.decision).toBe('block');
  });

  test('blocks localhost', async () => {
    const result = await runGuard('http://localhost:3000/api');
    expect(result.decision).toBe('block');
  });

  test('blocks file:// protocol', async () => {
    const result = await runGuard('file:///etc/passwd');
    expect(result.decision).toBe('block');
  });

  test('blocks 0.0.0.0', async () => {
    const result = await runGuard('http://0.0.0.0/');
    expect(result.decision).toBe('block');
  });
});

// ── Suspicious: ask before fetching ──────────────────────────────────────────

describe('WebFetchGuard — suspicious (ask)', () => {
  test('asks on ngrok tunnel URLs', async () => {
    const result = await runGuard('https://abc123.ngrok.io/webhook');
    // 2.1.185 PreToolUse ask contract — no top-level decision:"ask"
    expect(result.decision).toBeUndefined();
    expect(result.hookSpecificOutput?.hookEventName).toBe('PreToolUse');
    expect(result.hookSpecificOutput?.permissionDecision).toBe('ask');
    expect(result.hookSpecificOutput?.permissionDecisionReason).toContain('ngrok');
  });

  test('asks on pastebin URLs', async () => {
    const result = await runGuard('https://pastebin.com/raw/abc123');
    expect(result.hookSpecificOutput?.permissionDecision).toBe('ask');
  });
});

// ── Allowed: external URLs ────────────────────────────────────────────────────

describe('WebFetchGuard — allowed (external)', () => {
  test('allows https://example.com', async () => {
    const result = await runGuard('https://example.com');
    expect(result.continue).toBe(true);
  });

  test('allows github.com', async () => {
    const result = await runGuard('https://github.com/anthropics/claude-code');
    expect(result.continue).toBe(true);
  });

  test('allows docs.anthropic.com', async () => {
    const result = await runGuard('https://docs.anthropic.com/api');
    expect(result.continue).toBe(true);
  });

  test('allows WebSearch tool (no URL, just query)', async () => {
    const proc = spawn(['bun', 'run', HOOK], {
      stdin: new TextEncoder().encode(JSON.stringify({ tool_name: 'WebSearch', tool_input: { query: 'openWRT firmware' } })),
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, PAI_DIR: '/tmp/pai-guard-test' },
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    const result = JSON.parse(out);
    expect(result.continue).toBe(true);
  });

  test('allows empty input (fail-open)', async () => {
    const proc = spawn(['bun', 'run', HOOK], {
      stdin: new TextEncoder().encode(JSON.stringify({ tool_name: 'WebFetch', tool_input: {} })),
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, PAI_DIR: '/tmp/pai-guard-test' },
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    expect(JSON.parse(out).continue).toBe(true);
  });
});
