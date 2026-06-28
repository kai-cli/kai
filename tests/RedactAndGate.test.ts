/**
 * RedactAndGate.test.ts — 7.3.4 #2 (PAI-SR-031 / PAI-SR-073).
 *
 * Proves: secret redaction masks credentials before injection; the cross-project
 * body-injection gate and knowledge-redaction flag have safe defaults.
 */
import { describe, test, expect } from 'bun:test';
import { redactSecrets, containsSecret } from '../hooks/lib/redact';
import { sanitizeCrossProjectBody } from '../hooks/MemoryRecall.hook';

describe('redactSecrets', () => {
  test('masks an AWS access key with a marker', () => {
    const out = redactSecrets('connect with AKIAIOSFODNN7EXAMPLE now');
    expect(out).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(out).toContain('[REDACTED:');
  });

  test('masks a connection-string password', () => {
    const out = redactSecrets('postgres://admin:supersecretpassword@db.example.com:5432/x');
    expect(out).not.toContain('supersecretpassword');
    expect(out).toContain('[REDACTED:');
  });

  test('leaves ordinary text unchanged', () => {
    const text = 'The firmware build runs on the CI server nightly.';
    expect(redactSecrets(text)).toBe(text);
  });

  test('containsSecret detects vs ignores', () => {
    expect(containsSecret('key AKIAIOSFODNN7EXAMPLE')).toBe(true);
    expect(containsSecret('just a normal sentence')).toBe(false);
  });

  test('masks every occurrence, not just the first', () => {
    const out = redactSecrets('AKIAIOSFODNN7EXAMPLE and AKIAIOSFODNN7EXAMPLE');
    expect(out).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });
});

describe('config gate defaults (deny-by-default)', () => {
  // Import lazily so the module picks up an empty/default config.
  test('crossProjectBodyInjection defaults to false', async () => {
    const { isCrossProjectBodyInjectionEnabled, clearConfigCache } = await import('../hooks/lib/config-loader');
    clearConfigCache();
    // With no explicit config key, the body-injection gate must be closed.
    expect(typeof isCrossProjectBodyInjectionEnabled()).toBe('boolean');
    // Default-closed is the contract: the function returns true only on === true.
    expect(isCrossProjectBodyInjectionEnabled()).toBe(false);
  });

  test('knowledgeRedaction defaults to true', async () => {
    const { isKnowledgeRedactionEnabled, clearConfigCache } = await import('../hooks/lib/config-loader');
    clearConfigCache();
    expect(isKnowledgeRedactionEnabled()).toBe(true);
  });
});

describe('cross-project body redaction', () => {
  test('redacts credential-shaped content before body injection', () => {
    const token = `ghp_${'123456789012345678901234567890123456'}`;
    const out = sanitizeCrossProjectBody(`Use token ${token} in the other project.`);

    expect(out).not.toContain(token);
    expect(out).toContain('[REDACTED:');
  });
});
