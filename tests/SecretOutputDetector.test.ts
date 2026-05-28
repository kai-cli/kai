import { describe, test, expect } from 'bun:test';
import { scanForSecrets, SECRET_PATTERNS } from '../hooks/SecretOutputDetector.hook';

describe('SecretOutputDetector', () => {
  describe('scanForSecrets', () => {
    test('detects AWS access key pattern', () => {
      const output = 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\n';
      const result = scanForSecrets(output);
      expect(result.detected.length).toBeGreaterThan(0);
      expect(result.detected.some(d => d.includes('AWS Access Key'))).toBe(true);
    });

    test('detects Anthropic API key', () => {
      const output = 'export ANTHROPIC_API_KEY=sk-ant-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz567\n';
      const result = scanForSecrets(output);
      expect(result.detected.length).toBeGreaterThan(0);
      expect(result.detected.some(d => d.includes('Anthropic API Key'))).toBe(true);
    });

    test('detects GitHub token ghp_', () => {
      const output = 'GITHUB_TOKEN=ghp_1234567890abcdefghijklmnopqrstuvwxyz123456\n';
      const result = scanForSecrets(output);
      expect(result.detected.length).toBeGreaterThan(0);
      expect(result.detected.some(d => d.includes('GitHub Token'))).toBe(true);
    });

    test('detects GitHub token gho_', () => {
      const output = 'token: gho_abcdefghijklmnopqrstuvwxyz123456789012\n';
      const result = scanForSecrets(output);
      expect(result.detected.length).toBeGreaterThan(0);
      expect(result.detected.some(d => d.includes('GitHub Token'))).toBe(true);
    });

    test('detects private key block', () => {
      const output = `
-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj
-----END PRIVATE KEY-----
`;
      const result = scanForSecrets(output);
      expect(result.detected.length).toBeGreaterThan(0);
      expect(result.detected.some(d => d.includes('Private key block'))).toBe(true);
    });

    test('detects RSA private key block', () => {
      const output = `
-----BEGIN RSA PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj
-----END RSA PRIVATE KEY-----
`;
      const result = scanForSecrets(output);
      expect(result.detected.length).toBeGreaterThan(0);
      expect(result.detected.some(d => d.includes('Private key block'))).toBe(true);
    });

    test('detects generic API key in config format', () => {
      const output = 'api_key: abcd1234efgh5678ijkl9012mnop3456qrst';
      const result = scanForSecrets(output);
      expect(result.detected.length).toBeGreaterThan(0);
      expect(result.detected.some(d => d.includes('API key'))).toBe(true);
    });

    test('detects password in env format', () => {
      const output = 'PASSWORD=SuperSecret123!@#\nUSER=admin';
      const result = scanForSecrets(output);
      expect(result.detected.length).toBeGreaterThan(0);
      expect(result.detected.some(d => d.includes('Password'))).toBe(true);
    });

    test('detects OpenAI API key', () => {
      const output = 'openai_key=sk-abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJKLMNOP';
      const result = scanForSecrets(output);
      expect(result.detected.length).toBeGreaterThan(0);
      expect(result.detected.some(d => d.includes('OpenAI API Key'))).toBe(true);
    });

    test('detects Bearer token', () => {
      const output = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0';
      const result = scanForSecrets(output);
      expect(result.detected.length).toBeGreaterThan(0);
      expect(result.detected.some(d => d.includes('Bearer token'))).toBe(true);
    });

    test('no false positive on short safe output', () => {
      const output = 'Hello world';
      const result = scanForSecrets(output);
      expect(result.detected.length).toBe(0);
    });

    test('no false positive on normal command output', () => {
      const output = `
commit abc123def456
Author: Developer <dev@example.com>
Date:   Mon Jan 1 12:00:00 2024

    feat: add new feature
`;
      const result = scanForSecrets(output);
      expect(result.detected.length).toBe(0);
    });

    test('no false positive on git log output', () => {
      const output = 'abc1234 feat: initial commit\ndef5678 fix: bug fix\n';
      const result = scanForSecrets(output);
      expect(result.detected.length).toBe(0);
    });

    test('no false positive on npm install output', () => {
      const output = `
added 245 packages, and audited 246 packages in 3s
found 0 vulnerabilities
`;
      const result = scanForSecrets(output);
      expect(result.detected.length).toBe(0);
    });

    test('handles empty output without crash', () => {
      const result = scanForSecrets('');
      expect(result.detected.length).toBe(0);
    });

    test('handles null-like output without crash', () => {
      const result = scanForSecrets('   ');
      expect(result.detected.length).toBe(0);
    });

    test('scans only first 8KB of large output', () => {
      // Generate > 8KB of safe content, then add a secret
      const largeOutput = 'a'.repeat(10000) + 'AKIAIOSFODNN7EXAMPLE';
      const result = scanForSecrets(largeOutput);
      // Secret is beyond 8KB, should NOT be detected
      expect(result.detected.length).toBe(0);
    });

    test('detects multiple secret types in one output', () => {
      const output = `
API_KEY=abcd1234efgh5678ijkl9012mnop3456qrst
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
GITHUB_TOKEN=ghp_1234567890abcdefghijklmnopqrstuvwxyz123456
`;
      const result = scanForSecrets(output);
      expect(result.detected.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('SECRET_PATTERNS', () => {
    test('exports patterns array', () => {
      expect(SECRET_PATTERNS).toBeDefined();
      expect(Array.isArray(SECRET_PATTERNS)).toBe(true);
    });

    test('contains at least 8 patterns', () => {
      expect(SECRET_PATTERNS.length).toBeGreaterThanOrEqual(8);
    });

    test('all patterns have name and pattern', () => {
      for (const p of SECRET_PATTERNS) {
        expect(p.name).toBeDefined();
        expect(p.name.length).toBeGreaterThan(0);
        expect(p.pattern).toBeDefined();
        expect(p.pattern instanceof RegExp).toBe(true);
      }
    });

    test('has AWS patterns', () => {
      const hasAWS = SECRET_PATTERNS.some(p => p.name.includes('AWS'));
      expect(hasAWS).toBe(true);
    });

    test('has API key patterns', () => {
      const hasAPIKey = SECRET_PATTERNS.some(p => p.name.includes('API key'));
      expect(hasAPIKey).toBe(true);
    });

    test('has GitHub token pattern', () => {
      const hasGitHub = SECRET_PATTERNS.some(p => p.name.includes('GitHub'));
      expect(hasGitHub).toBe(true);
    });

    test('has private key pattern', () => {
      const hasPrivateKey = SECRET_PATTERNS.some(p => p.name.includes('Private key'));
      expect(hasPrivateKey).toBe(true);
    });
  });
});
