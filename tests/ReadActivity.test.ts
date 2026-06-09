/**
 * ReadActivity.test.ts — coverage for the W5a merged hook (ReadTracker + MemoryAccessTracker).
 *
 * The hook dispatches one Read payload to two PATH-DISJOINT branches:
 *   - routing-signal  (isRoutingRead → read-log.jsonl)  for PAI-internal NON-memory reads
 *   - memory-eviction (isMemoryRead  → memory-meta.jsonl reference_count) for MEMORY/*.md reads
 * The two predicates are the SINGLE SOURCE for both the live branches and these tests (the branches
 * call them), so testing the predicates tests the real gate. The memory branch's effect is verified
 * end-to-end via a temp paiDir + loadMeta (recordDetailRead writes paiDir-relative).
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { isRoutingRead, isMemoryRead, trackMemoryRead } from '../hooks/ReadActivity.hook';
import { loadMeta } from '../hooks/lib/memory-disclosure';

const TMP = join('/tmp', 'test-read-activity-' + Date.now());
const PAI = '/Users/test/.claude';

function mkPaiDir(): string {
  const dir = join(TMP, Math.random().toString(36).slice(2));
  mkdirSync(join(dir, 'MEMORY', 'STATE'), { recursive: true });
  return dir;
}

afterEach(() => {
  try { rmSync(TMP, { recursive: true, force: true }); } catch { }
});

describe('ReadActivity dispatch — isRoutingRead (routing-signal branch)', () => {
  it('tracks a PAI-internal non-memory read', () => {
    expect(isRoutingRead(`${PAI}/skills/Browser/SKILL.md`, PAI)).toBe(true);
    expect(isRoutingRead(`${PAI}/hooks/lib/embeddings.ts`, PAI)).toBe(true);
  });

  it('SKIPS MEMORY/ reads (those go to the eviction branch, not routing)', () => {
    expect(isRoutingRead(`${PAI}/MEMORY/KNOWLEDGE/firmware.md`, PAI)).toBe(false);
  });

  it('SKIPS sessions/ and projects/ reads', () => {
    expect(isRoutingRead(`${PAI}/sessions/abc.jsonl`, PAI)).toBe(false);
    expect(isRoutingRead(`${PAI}/projects/x/transcript.jsonl`, PAI)).toBe(false);
  });

  it('SKIPS reads outside paiDir', () => {
    expect(isRoutingRead('/tmp/somefile.ts', PAI)).toBe(false);
    expect(isRoutingRead('/Users/test/other/file.md', PAI)).toBe(false);
  });
});

describe('ReadActivity dispatch — isMemoryRead (eviction branch)', () => {
  it('tracks MEMORY/*.md reads', () => {
    expect(isMemoryRead(`${PAI}/MEMORY/KNOWLEDGE/firmware.md`)).toBe(true);
    expect(isMemoryRead(`${PAI}/projects/x/memory/note.md`)).toBe(true);
  });

  it('ignores non-.md files even under MEMORY/', () => {
    expect(isMemoryRead(`${PAI}/MEMORY/STATE/read-log.jsonl`)).toBe(false);
  });

  it('ignores .md files outside any memory dir', () => {
    expect(isMemoryRead(`${PAI}/skills/Browser/SKILL.md`)).toBe(false);
  });
});

describe('ReadActivity branches are path-disjoint', () => {
  it('a routing path is NOT a memory path and vice-versa', () => {
    const routing = `${PAI}/skills/Browser/SKILL.md`;
    const memory = `${PAI}/MEMORY/KNOWLEDGE/firmware.md`;
    expect(isRoutingRead(routing, PAI) && isMemoryRead(routing)).toBe(false);
    expect(isRoutingRead(memory, PAI) && isMemoryRead(memory)).toBe(false);
  });
});

describe('ReadActivity — trackMemoryRead end-to-end (real meta write)', () => {
  it('records a reference_count for a MEMORY/*.md read', () => {
    const paiDir = mkPaiDir();
    const memFile = join(paiDir, 'MEMORY', 'KNOWLEDGE', 'firmware.md');
    trackMemoryRead(memFile, paiDir);
    const meta = loadMeta(paiDir);
    const entry = meta.find(m => m.file.includes('firmware.md'));
    expect(entry).toBeDefined();
    expect(entry!.reference_count).toBeGreaterThanOrEqual(1);
  });

  it('does NOT record for a non-memory read (no-op)', () => {
    const paiDir = mkPaiDir();
    trackMemoryRead(join(paiDir, 'skills', 'Browser', 'SKILL.md'), paiDir);
    expect(loadMeta(paiDir).length).toBe(0);
  });
});
