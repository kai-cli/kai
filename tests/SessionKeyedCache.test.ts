/**
 * SessionKeyedCache.test.ts — 7.3.4 #5 (PAI-SR-041).
 *
 * The last-response cache must be keyed by session_id so concurrent sessions cannot
 * read/overwrite each other's cached response.
 */
import { describe, test, expect } from 'bun:test';
import { writeFileSync, mkdirSync, existsSync, rmSync, readFileSync } from 'fs';
import { dirname } from 'path';
import { lastResponseCachePath } from '../hooks/lib/paths';

describe('lastResponseCachePath (PAI-SR-041)', () => {
  test('different session ids → different paths', () => {
    expect(lastResponseCachePath('sess-A')).not.toBe(lastResponseCachePath('sess-B'));
  });

  test('path includes the session id and no separators leak', () => {
    const p = lastResponseCachePath('abc/../../etc');
    expect(p).toContain('last-response-');
    // sanitized: no path traversal survives in the filename segment
    const file = p.split('/').pop()!;
    expect(file).not.toContain('..');
    expect(file.startsWith('last-response-')).toBe(true);
  });

  test('empty session id falls back to a stable filename', () => {
    expect(lastResponseCachePath('')).toContain('last-response-unknown');
  });

  test('session B cannot read session A response; within-session read works', () => {
    const a = lastResponseCachePath('itest-A');
    const b = lastResponseCachePath('itest-B');
    try {
      mkdirSync(dirname(a), { recursive: true });
      writeFileSync(a, 'RESPONSE FROM A', 'utf-8');
      // bridge intact within A
      expect(readFileSync(a, 'utf-8')).toBe('RESPONSE FROM A');
      // B's path is distinct and absent → no cross-session bleed
      expect(b).not.toBe(a);
      expect(existsSync(b)).toBe(false);
    } finally {
      if (existsSync(a)) rmSync(a);
    }
  });
});
