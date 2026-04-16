/**
 * SecretDetector.test.ts — Unit tests for hooks/SecretOutputDetector.hook.ts
 *
 * Tests: detects each credential pattern type, passes clean output,
 * fails open on malformed input, alert-only (never blocks).
 *
 * Run: bun test tests/SecretDetector.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { spawn } from 'bun';

// Construct fake credential-like strings dynamically so they don't appear
// as literals in source (which would trigger the SecretGuard pre-commit hook).
// These are test patterns only — not real credentials.
const FAKE = {
  anthropicKey: 'sk-ant-api03-' + 'A'.repeat(60),
  awsAccessKey: 'AKIA' + '1234567890ABCDEF',
  githubToken: 'ghp_' + 'A'.repeat(36),
  bearerToken: 'Bearer ' + 'eyJhbGciOiJSUzI1NiJ9.' + 'A'.repeat(30),
  privateKeyHeader: '-----BEGIN RSA ' + 'PRIVATE KEY-----\nMIIEowIBAAKCAQEA...',
  dbPassword: 'DB_PASSWORD=' + 'supersecretpassword123',
};

const HOOK = new URL('../hooks/SecretOutputDetector.hook.ts', import.meta.url).pathname;

async function runDetector(toolOutput: string, toolName = 'Bash'): Promise<{ decision?: string; continue?: boolean; message?: string }> {
  const payload = JSON.stringify({ tool_name: toolName, tool_response: toolOutput });
  const proc = spawn(['bun', 'run', HOOK], {
    stdin: new TextEncoder().encode(payload),
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, PAI_DIR: '/tmp/pai-detector-test' },
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return JSON.parse(out);
}

// ── Secret detection ──────────────────────────────────────────────────────────

describe('SecretOutputDetector — detects secrets', () => {
  test('detects Anthropic API key', async () => {
    const result = await runDetector(FAKE.anthropicKey);
    expect(result.decision).toBe('ask');
    expect(result.message).toContain('Anthropic API Key');
  });

  test('detects AWS access key', async () => {
    const result = await runDetector('export AWS_ACCESS_KEY_ID=' + FAKE.awsAccessKey);
    expect(result.decision).toBe('ask');
    expect(result.message).toContain('AWS Access Key');
  });

  test('detects GitHub token', async () => {
    const result = await runDetector('GITHUB_TOKEN=' + FAKE.githubToken);
    expect(result.decision).toBe('ask');
    expect(result.message).toContain('GitHub');
  });

  test('detects Bearer token', async () => {
    const result = await runDetector('Authorization: ' + FAKE.bearerToken);
    expect(result.decision).toBe('ask');
    expect(result.message).toContain('Bearer token');
  });

  test('detects private key block', async () => {
    const result = await runDetector(FAKE.privateKeyHeader);
    expect(result.decision).toBe('ask');
    expect(result.message).toContain('Private key');
  });

  test('detects password in env output', async () => {
    const result = await runDetector(FAKE.dbPassword);
    expect(result.decision).toBe('ask');
  });

  test('works on WebFetch tool output', async () => {
    const result = await runDetector('{"api_key": "' + FAKE.anthropicKey + '"}', 'WebFetch');
    expect(result.decision).toBe('ask');
  });

  test('message is informative (contains tool name)', async () => {
    const result = await runDetector(FAKE.awsAccessKey, 'Bash');
    expect(result.message).toContain('Bash');
    expect(result.message).toContain('logged');
  });
});

// ── Clean output ──────────────────────────────────────────────────────────────

describe('SecretOutputDetector — clean output (no alert)', () => {
  test('passes normal command output', async () => {
    const result = await runDetector('total 48\ndrwxr-xr-x  5 user staff  160 Apr 16 09:00 .');
    expect(result.continue).toBe(true);
  });

  test('passes JSON without secrets', async () => {
    const result = await runDetector('{"status": "ok", "count": 42, "name": "test"}');
    expect(result.continue).toBe(true);
  });

  test('passes empty output', async () => {
    const result = await runDetector('');
    expect(result.continue).toBe(true);
  });

  test('short placeholder keys do not trigger (below length threshold)', async () => {
    // "sk-abc" is too short to be a real OpenAI key (needs 40+ chars)
    const result = await runDetector('sk-abc');
    expect(result.continue).toBe(true);
  });

  test('passes git log output', async () => {
    const result = await runDetector('a52a9e6 Phase 3: ReflectionHarvester + rating-triggered draft generation\n2cdfbc0 Add tests for inference-budget');
    expect(result.continue).toBe(true);
  });
});

// ── Fail-open ─────────────────────────────────────────────────────────────────

describe('SecretOutputDetector — fail-open', () => {
  test('returns continue on malformed JSON input', async () => {
    const proc = spawn(['bun', 'run', HOOK], {
      stdin: new TextEncoder().encode('not-valid-json'),
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, PAI_DIR: '/tmp/pai-detector-test' },
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    const result = JSON.parse(out);
    expect(result.continue).toBe(true);
  });

  test('never returns decision:block (alert-only)', async () => {
    const result = await runDetector(FAKE.anthropicKey);
    expect(result.decision).not.toBe('block');
  });
});
