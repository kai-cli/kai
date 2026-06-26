/**
 * ShellFalsePositive.test.ts — 7.3.4 #4 (PAI-SR-040).
 *
 * Natural-language sentences starting with a word that is also a PATH binary
 * (test/write/make/…) must NOT classify as shell — the bug auto-injected a
 * "execute directly via Bash" hint for "test the theory" / "write a report".
 */
import { describe, test, expect } from 'bun:test';
import { classifyInput } from '../hooks/lib/input-classifier';
import { getKnownCommands } from '../hooks/lib/command-database';

describe('common-word binaries are not auto-shell (PAI-SR-040)', () => {
  test('"test the theory" → ai, not shell', () => {
    expect(classifyInput('test the theory').classification).toBe('ai');
  });

  test('"write a report" → ai, not shell', () => {
    expect(classifyInput('write a report').classification).toBe('ai');
  });

  test('"make it faster" → ai, not shell', () => {
    expect(classifyInput('make it faster').classification).toBe('ai');
  });

  test('"find the bug in this code" → ai, not shell', () => {
    expect(classifyInput('find the bug in this code').classification).toBe('ai');
  });
});

describe('real commands still classify as shell (no regression)', () => {
  test('"git status" → shell', () => {
    if (!getKnownCommands().has('git')) return;
    expect(classifyInput('git status').classification).toBe('shell');
  });

  test('"npm install express" → shell', () => {
    if (!getKnownCommands().has('npm')) return;
    expect(classifyInput('npm install express').classification).toBe('shell');
  });
});

describe('explicit and hard-signal overrides still work', () => {
  test('"!test -f x" → shell (explicit prefix wins)', () => {
    expect(classifyInput('!test -f x').classification).toBe('shell');
  });

  test('common-word binary WITH metacharacters can still score shell', () => {
    // `find . -name x > out.txt` has redirection — a real shell signal.
    const r = classifyInput('find . -name x > out.txt');
    // not forcing 'shell' (depends on PATH), but p_shell must be elevated by the metachar
    expect(r.p_shell).toBeGreaterThan(0.6);
  });
});
