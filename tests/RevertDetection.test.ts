import { describe, it, expect, afterEach } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { detectReverts } from '../hooks/InstinctCapture.hook';
import { loadInstincts } from '../hooks/lib/instinct-store';
import type { WriteEntry } from '../hooks/WriteTracker.hook';

const TMP = join('/tmp', 'test-revert-detection-' + Date.now());

function mkPaiDir(): string {
  const dir = join(TMP, Math.random().toString(36).slice(2));
  mkdirSync(join(dir, 'MEMORY', 'STATE'), { recursive: true });
  mkdirSync(join(dir, 'MEMORY', 'LEARNING', 'INSTINCTS'), { recursive: true });
  return dir;
}

function writeLedger(paiDir: string, entries: WriteEntry[]): void {
  writeFileSync(
    join(paiDir, 'MEMORY', 'STATE', 'session-writes.jsonl'),
    entries.map(e => JSON.stringify(e)).join('\n') + '\n'
  );
}

afterEach(() => {
  try { rmSync(TMP, { recursive: true, force: true }); } catch { }
});

describe('detectReverts', () => {
  it('does nothing when ledger is empty', () => {
    const paiDir = mkPaiDir();
    expect(() => detectReverts(paiDir)).not.toThrow();
    expect(loadInstincts(paiDir)).toHaveLength(0);
  });

  it('does nothing when file content matches PAI write (no revert)', () => {
    const paiDir = mkPaiDir();
    const filePath = join(TMP, 'unchanged.ts');
    const content = 'export function hello() { return "world"; }';
    writeFileSync(filePath, content);

    const { createHash } = require('crypto');
    const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);

    writeLedger(paiDir, [{
      path: filePath,
      timestamp: '2026-05-20T00:00:00Z',
      contentHash: hash,
      snippet: 'export function hello() { return "world"; }',
    }]);

    detectReverts(paiDir);
    expect(loadInstincts(paiDir)).toHaveLength(0);
  });

  it('creates instinct when file is reverted (snippet removed)', () => {
    const paiDir = mkPaiDir();
    const filePath = join(TMP, 'reverted.ts');

    // PAI wrote this content
    const paiContent = 'export function hello() { return "world"; }\nexport function added() { return true; }';
    const { createHash } = require('crypto');
    const hash = createHash('sha256').update(paiContent).digest('hex').slice(0, 16);

    // User reverted — the snippet PAI added is gone
    writeFileSync(filePath, 'export function hello() { return "world"; }');

    writeLedger(paiDir, [{
      path: filePath,
      timestamp: '2026-05-20T00:00:00Z',
      contentHash: hash,
      snippet: 'export function added() { return true; }',
    }]);

    detectReverts(paiDir);
    const instincts = loadInstincts(paiDir);
    expect(instincts).toHaveLength(1);
    expect(instincts[0].source).toBe('revert');
    expect(instincts[0].text).toContain('Reverted:');
    expect(instincts[0].text).toContain('reverted.ts');
  });

  it('does not create instinct when snippet is still present', () => {
    const paiDir = mkPaiDir();
    const filePath = join(TMP, 'extended.ts');

    const paiContent = 'export function hello() { return "world"; }';
    const { createHash } = require('crypto');
    const hash = createHash('sha256').update(paiContent).digest('hex').slice(0, 16);

    // User extended the file — PAI's snippet is still there
    writeFileSync(filePath, 'export function hello() { return "world"; }\n// user added this');

    writeLedger(paiDir, [{
      path: filePath,
      timestamp: '2026-05-20T00:00:00Z',
      contentHash: hash,
      snippet: 'export function hello() { return "world"; }',
    }]);

    detectReverts(paiDir);
    expect(loadInstincts(paiDir)).toHaveLength(0);
  });

  it('skips files that no longer exist', () => {
    const paiDir = mkPaiDir();
    writeLedger(paiDir, [{
      path: '/tmp/nonexistent-file-xyz.ts',
      timestamp: '2026-05-20T00:00:00Z',
      contentHash: 'abc123',
      snippet: 'some content that was written',
    }]);

    expect(() => detectReverts(paiDir)).not.toThrow();
    expect(loadInstincts(paiDir)).toHaveLength(0);
  });

  it('skips entries with short snippets (<= 20 chars)', () => {
    const paiDir = mkPaiDir();
    const filePath = join(TMP, 'short.ts');
    writeFileSync(filePath, 'different content now');

    writeLedger(paiDir, [{
      path: filePath,
      timestamp: '2026-05-20T00:00:00Z',
      contentHash: 'wronghash1234567',
      snippet: 'short',
    }]);

    detectReverts(paiDir);
    expect(loadInstincts(paiDir)).toHaveLength(0);
  });
});
