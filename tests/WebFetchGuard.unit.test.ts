import { describe, test, expect } from 'bun:test';
import { validateUrl, BLOCKED_PATTERNS, SUSPICIOUS_PATTERNS } from '../hooks/WebFetchGuard.hook';

describe('WebFetchGuard Unit Tests', () => {
  describe('validateUrl', () => {
    test('blocks http://10.0.0.1', () => {
      const result = validateUrl('http://10.0.0.1');
      expect(result.action).toBe('block');
      expect(result.reason).toContain('internal network');
    });

    test('blocks http://192.168.1.1', () => {
      const result = validateUrl('http://192.168.1.1');
      expect(result.action).toBe('block');
      expect(result.reason).toContain('internal network');
    });

    test('blocks http://192.168.0.100:8080', () => {
      const result = validateUrl('http://192.168.0.100:8080/admin');
      expect(result.action).toBe('block');
      expect(result.reason).toContain('internal network');
    });

    test('blocks http://172.16.0.1', () => {
      const result = validateUrl('http://172.16.0.1');
      expect(result.action).toBe('block');
      expect(result.reason).toContain('internal network');
    });

    test('blocks http://172.31.255.255', () => {
      const result = validateUrl('http://172.31.255.255');
      expect(result.action).toBe('block');
      expect(result.reason).toContain('internal network');
    });

    test('blocks http://127.0.0.1:8080', () => {
      const result = validateUrl('http://127.0.0.1:8080');
      expect(result.action).toBe('block');
      expect(result.reason).toContain('internal network');
    });

    test('blocks http://localhost:3000', () => {
      const result = validateUrl('http://localhost:3000');
      expect(result.action).toBe('block');
      expect(result.reason).toContain('internal network');
    });

    test('blocks https://localhost', () => {
      const result = validateUrl('https://localhost');
      expect(result.action).toBe('block');
      expect(result.reason).toContain('internal network');
    });

    test('blocks http://0.0.0.0', () => {
      const result = validateUrl('http://0.0.0.0');
      expect(result.action).toBe('block');
      expect(result.reason).toContain('internal network');
    });

    test('blocks file:///etc/passwd', () => {
      const result = validateUrl('file:///etc/passwd');
      expect(result.action).toBe('block');
      expect(result.reason).toContain('internal network');
    });

    test('blocks file:///Users/test/.ssh/id_rsa', () => {
      const result = validateUrl('file:///Users/test/.ssh/id_rsa');
      expect(result.action).toBe('block');
      expect(result.reason).toContain('internal network');
    });

    test('flags https://abc123.ngrok.io as suspicious (ask)', () => {
      const result = validateUrl('https://abc123.ngrok.io/webhook');
      expect(result.action).toBe('ask');
      expect(result.reason).toContain('ngrok');
    });

    test('flags https://pastebin.com/abc123 as suspicious (ask)', () => {
      const result = validateUrl('https://pastebin.com/abc123');
      expect(result.action).toBe('ask');
      expect(result.reason).toContain('paste service');
    });

    test('flags https://paste.ee/p/abc as suspicious (ask)', () => {
      const result = validateUrl('https://paste.ee/p/abc');
      expect(result.action).toBe('ask');
      expect(result.reason).toContain('paste service');
    });

    test('allows https://api.github.com', () => {
      const result = validateUrl('https://api.github.com/repos');
      expect(result.action).toBe('allow');
    });

    test('allows https://www.google.com', () => {
      const result = validateUrl('https://www.google.com');
      expect(result.action).toBe('allow');
    });

    test('allows https://api.anthropic.com', () => {
      const result = validateUrl('https://api.anthropic.com/v1/messages');
      expect(result.action).toBe('allow');
    });

    test('allows https://example.com', () => {
      const result = validateUrl('https://example.com/api/data');
      expect(result.action).toBe('allow');
    });

    test('allows https://docs.github.com', () => {
      const result = validateUrl('https://docs.github.com/en/api');
      expect(result.action).toBe('allow');
    });

    test('handles empty URL string', () => {
      const result = validateUrl('');
      expect(result.action).toBe('allow');
    });

    test('handles whitespace URL', () => {
      const result = validateUrl('   ');
      expect(result.action).toBe('allow');
    });

    test('blocks loopback with different ports', () => {
      expect(validateUrl('http://127.0.0.1:3000').action).toBe('block');
      expect(validateUrl('http://127.0.0.1:5000').action).toBe('block');
      expect(validateUrl('http://127.1.2.3:8080').action).toBe('block');
    });

    test('blocks private network 10.x.x.x range', () => {
      expect(validateUrl('http://10.0.0.1').action).toBe('block');
      expect(validateUrl('http://10.255.255.255').action).toBe('block');
      expect(validateUrl('http://10.10.10.10:9000').action).toBe('block');
    });

    test('allows public IP addresses', () => {
      // These are public IPs, not private networks
      expect(validateUrl('http://8.8.8.8').action).toBe('allow');
      expect(validateUrl('http://1.1.1.1').action).toBe('allow');
    });

    test('blocks different schemes for localhost', () => {
      expect(validateUrl('http://localhost').action).toBe('block');
      expect(validateUrl('https://localhost').action).toBe('block');
      expect(validateUrl('http://localhost:8080').action).toBe('block');
    });
  });

  describe('BLOCKED_PATTERNS', () => {
    test('exports blocked patterns array', () => {
      expect(BLOCKED_PATTERNS).toBeDefined();
      expect(Array.isArray(BLOCKED_PATTERNS)).toBe(true);
    });

    test('contains at least 7 patterns', () => {
      expect(BLOCKED_PATTERNS.length).toBeGreaterThanOrEqual(7);
    });

    test('all patterns are RegExp objects', () => {
      for (const pattern of BLOCKED_PATTERNS) {
        expect(pattern instanceof RegExp).toBe(true);
      }
    });

    test('has pattern for 10.x.x.x', () => {
      const has10Network = BLOCKED_PATTERNS.some(p => p.test('http://10.0.0.1'));
      expect(has10Network).toBe(true);
    });

    test('has pattern for 192.168.x.x', () => {
      const has192Network = BLOCKED_PATTERNS.some(p => p.test('http://192.168.1.1'));
      expect(has192Network).toBe(true);
    });

    test('has pattern for localhost', () => {
      const hasLocalhost = BLOCKED_PATTERNS.some(p => p.test('http://localhost'));
      expect(hasLocalhost).toBe(true);
    });

    test('has pattern for file://', () => {
      const hasFile = BLOCKED_PATTERNS.some(p => p.test('file:///etc/passwd'));
      expect(hasFile).toBe(true);
    });
  });

  describe('SUSPICIOUS_PATTERNS', () => {
    test('exports suspicious patterns array', () => {
      expect(SUSPICIOUS_PATTERNS).toBeDefined();
      expect(Array.isArray(SUSPICIOUS_PATTERNS)).toBe(true);
    });

    test('contains at least 3 patterns', () => {
      expect(SUSPICIOUS_PATTERNS.length).toBeGreaterThanOrEqual(3);
    });

    test('all patterns have pattern and reason', () => {
      for (const p of SUSPICIOUS_PATTERNS) {
        expect(p.pattern).toBeDefined();
        expect(p.pattern instanceof RegExp).toBe(true);
        expect(p.reason).toBeDefined();
        expect(p.reason.length).toBeGreaterThan(0);
      }
    });

    test('has ngrok pattern', () => {
      const hasNgrok = SUSPICIOUS_PATTERNS.some(p => p.pattern.test('https://abc.ngrok.io'));
      expect(hasNgrok).toBe(true);
    });

    test('has paste service patterns', () => {
      const hasPaste = SUSPICIOUS_PATTERNS.some(p =>
        p.pattern.test('https://pastebin.com/abc') ||
        p.pattern.test('https://paste.ee/p/123')
      );
      expect(hasPaste).toBe(true);
    });
  });
});
