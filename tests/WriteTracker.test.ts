import { describe, it, expect, afterEach } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { loadLedger, clearLedger, type WriteEntry } from '../hooks/WriteTracker.hook';

const TMP = join('/tmp', 'test-write-tracker-' + Date.now());

function mkPaiDir(): string {
  const dir = join(TMP, Math.random().toString(36).slice(2));
  mkdirSync(join(dir, 'MEMORY', 'STATE'), { recursive: true });
  return dir;
}

function writeLedger(paiDir: string, entries: WriteEntry[]): void {
  const path = join(paiDir, 'MEMORY', 'STATE', 'session-writes.jsonl');
  writeFileSync(path, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
}

afterEach(() => {
  try { rmSync(TMP, { recursive: true, force: true }); } catch { }
});

describe('WriteTracker', () => {
  describe('loadLedger', () => {
    it('returns empty array when no ledger file', () => {
      const paiDir = mkPaiDir();
      expect(loadLedger(paiDir)).toEqual([]);
    });

    it('loads entries from ledger file', () => {
      const paiDir = mkPaiDir();
      const entries: WriteEntry[] = [
        { path: '/tmp/foo.ts', timestamp: '2026-05-20T00:00:00Z', contentHash: 'abc123', snippet: 'added foo' },
        { path: '/tmp/bar.ts', timestamp: '2026-05-20T00:01:00Z', contentHash: 'def456', snippet: 'added bar' },
      ];
      writeLedger(paiDir, entries);
      const loaded = loadLedger(paiDir);
      expect(loaded).toHaveLength(2);
      expect(loaded[0].path).toBe('/tmp/foo.ts');
      expect(loaded[1].contentHash).toBe('def456');
    });

    it('handles malformed lines gracefully', () => {
      const paiDir = mkPaiDir();
      const path = join(paiDir, 'MEMORY', 'STATE', 'session-writes.jsonl');
      writeFileSync(path, '{"path":"/tmp/a.ts","timestamp":"x","contentHash":"h","snippet":"s"}\nnot json\n');
      // Should not throw — returns what it can parse
      expect(() => loadLedger(paiDir)).not.toThrow();
    });
  });

  describe('clearLedger', () => {
    it('empties the ledger file', () => {
      const paiDir = mkPaiDir();
      const entries: WriteEntry[] = [
        { path: '/tmp/foo.ts', timestamp: '2026-05-20T00:00:00Z', contentHash: 'abc', snippet: 'x' },
      ];
      writeLedger(paiDir, entries);
      clearLedger(paiDir);
      expect(loadLedger(paiDir)).toEqual([]);
    });

    it('does not throw when no ledger exists', () => {
      const paiDir = mkPaiDir();
      expect(() => clearLedger(paiDir)).not.toThrow();
    });
  });
});
