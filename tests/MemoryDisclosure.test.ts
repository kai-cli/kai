import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import {
  loadMeta,
  saveMeta,
  evictionScore,
  applyAging,
  pruneIndex,
  appendTimeline,
  initializeMeta,
  loadPromotedInsights,
  recordDetailRead,
  MAX_TIMELINE_ENTRIES,
  type MemoryMetaEntry,
} from '../hooks/lib/memory-disclosure';

const TMP = join('/tmp', 'test-memory-disclosure-' + Date.now());

function mkPaiDir(): string {
  const dir = join(TMP, Math.random().toString(36).slice(2));
  mkdirSync(join(dir, 'MEMORY', 'STATE'), { recursive: true });
  mkdirSync(join(dir, 'MEMORY', 'LEARNING', 'INSTINCTS'), { recursive: true });
  return dir;
}

afterEach(() => {
  try { rmSync(TMP, { recursive: true, force: true }); } catch { }
});

describe('evictionScore', () => {
  it('high reference_count raises score', () => {
    const a: MemoryMetaEntry = { file: 'a.md', last_accessed: new Date().toISOString().split('T')[0], reference_count: 10, priority: 'P3' };
    const b: MemoryMetaEntry = { file: 'b.md', last_accessed: new Date().toISOString().split('T')[0], reference_count: 0, priority: 'P3' };
    expect(evictionScore(a)).toBeGreaterThan(evictionScore(b));
  });

  it('older entries score lower', () => {
    const old: MemoryMetaEntry = { file: 'a.md', last_accessed: '2020-01-01', reference_count: 0, priority: 'P3' };
    const recent: MemoryMetaEntry = { file: 'b.md', last_accessed: new Date().toISOString().split('T')[0], reference_count: 0, priority: 'P3' };
    expect(evictionScore(old)).toBeLessThan(evictionScore(recent));
  });
});

describe('applyAging', () => {
  it('P2 entries >30 days old with reference_count=0 become P3', () => {
    const entries: MemoryMetaEntry[] = [
      { file: 'old.md', last_accessed: '2020-01-01', reference_count: 0, priority: 'P2' },
    ];
    const result = applyAging(entries);
    expect(result[0].priority).toBe('P3');
  });

  it('P2 entries with reference_count>0 stay P2 even if old', () => {
    const entries: MemoryMetaEntry[] = [
      { file: 'active.md', last_accessed: '2020-01-01', reference_count: 3, priority: 'P2' },
    ];
    const result = applyAging(entries);
    expect(result[0].priority).toBe('P2');
  });

  it('P0 and P1 entries never change priority', () => {
    const entries: MemoryMetaEntry[] = [
      { file: 'p0.md', last_accessed: '2020-01-01', reference_count: 0, priority: 'P0' },
      { file: 'p1.md', last_accessed: '2020-01-01', reference_count: 0, priority: 'P1' },
    ];
    const result = applyAging(entries);
    expect(result[0].priority).toBe('P0');
    expect(result[1].priority).toBe('P1');
  });

  it('recent P2 entries (<30 days) stay P2', () => {
    const today = new Date().toISOString().split('T')[0];
    const entries: MemoryMetaEntry[] = [
      { file: 'recent.md', last_accessed: today, reference_count: 0, priority: 'P2' },
    ];
    const result = applyAging(entries);
    expect(result[0].priority).toBe('P2');
  });
});

describe('pruneIndex', () => {
  it('returns entries unchanged if under 50', () => {
    const entries: MemoryMetaEntry[] = Array.from({ length: 30 }, (_, i) => ({
      file: `f${i}.md`, last_accessed: '2024-01-01', reference_count: 0, priority: 'P2',
    }));
    const { pruned, evicted } = pruneIndex(entries);
    expect(pruned.length).toBe(30);
    expect(evicted.length).toBe(0);
  });

  it('evicts lowest-scoring P3 entries when over 50', () => {
    const entries: MemoryMetaEntry[] = Array.from({ length: 55 }, (_, i) => ({
      file: `f${i}.md`,
      last_accessed: '2020-01-01',
      reference_count: 0,
      priority: 'P3' as const,
    }));
    const { pruned, evicted } = pruneIndex(entries);
    expect(pruned.length).toBe(50);
    expect(evicted.length).toBe(5);
  });

  it('does not evict P0 or P1 entries', () => {
    const protected_: MemoryMetaEntry[] = Array.from({ length: 10 }, (_, i) => ({
      file: `p${i}.md`, last_accessed: '2020-01-01', reference_count: 0,
      priority: i % 2 === 0 ? 'P0' as const : 'P1' as const,
    }));
    const overflow: MemoryMetaEntry[] = Array.from({ length: 45 }, (_, i) => ({
      file: `f${i}.md`, last_accessed: '2020-01-01', reference_count: 0, priority: 'P3' as const,
    }));
    const { pruned } = pruneIndex([...protected_, ...overflow]);
    const protectedInPruned = pruned.filter(e => e.priority === 'P0' || e.priority === 'P1');
    expect(protectedInPruned.length).toBe(10);
  });
});

describe('appendTimeline', () => {
  it('appends entries to timeline.jsonl', () => {
    const paiDir = mkPaiDir();
    appendTimeline(paiDir, { event: 'test', timestamp: '2026-01-01T00:00:00Z' });
    appendTimeline(paiDir, { event: 'test2', timestamp: '2026-01-01T01:00:00Z' });

    const { readFileSync } = require('fs');
    const lines = readFileSync(join(paiDir, 'MEMORY', 'STATE', 'timeline.jsonl'), 'utf-8').trim().split('\n');
    expect(lines.length).toBe(2);
  });

  it('trims to MAX_TIMELINE_ENTRIES when over limit', () => {
    const paiDir = mkPaiDir();
    for (let i = 0; i < MAX_TIMELINE_ENTRIES + 10; i++) {
      appendTimeline(paiDir, { event: 'e', i });
    }

    const { readFileSync } = require('fs');
    const lines = readFileSync(join(paiDir, 'MEMORY', 'STATE', 'timeline.jsonl'), 'utf-8').trim().split('\n');
    expect(lines.length).toBe(MAX_TIMELINE_ENTRIES);
  });
});

describe('initializeMeta', () => {
  it('parses section headers for priority classification', () => {
    const paiDir = mkPaiDir();
    const memoryMd = `
## Active References
- [ProjectA](project_a.md) — active project

## Feedback
- [Rule1](feedback_rule1.md) — a rule

## Other
- [Note1](note1.md) — a note
`;
    initializeMeta(paiDir, memoryMd);
    const entries = loadMeta(paiDir);

    expect(entries.find(e => e.file === 'project_a.md')?.priority).toBe('P0');
    expect(entries.find(e => e.file === 'feedback_rule1.md')?.priority).toBe('P1');
    expect(entries.find(e => e.file === 'note1.md')?.priority).toBe('P2');
  });
});

describe('recordDetailRead', () => {
  it('increments reference_count on read', () => {
    const paiDir = mkPaiDir();
    const entries: MemoryMetaEntry[] = [
      { file: 'topic.md', last_accessed: '2026-01-01', reference_count: 0, priority: 'P2' },
    ];
    saveMeta(paiDir, entries);

    recordDetailRead(paiDir, join(paiDir, 'topic.md'));
    const updated = loadMeta(paiDir);
    expect(updated[0].reference_count).toBe(1);
  });

  it('creates new entry if file not in meta', () => {
    const paiDir = mkPaiDir();
    recordDetailRead(paiDir, '/some/path/memory/new-topic.md');
    const entries = loadMeta(paiDir);
    expect(entries.length).toBe(1);
    expect(entries[0].reference_count).toBe(1);
  });
});

describe('loadPromotedInsights', () => {
  it('surfaces latest promoted insight sections for current project', () => {
    const paiDir = mkPaiDir();
    const projectDir = '/Users/test/Projects/kai';
    const encoded = projectDir.replace(/[^a-zA-Z0-9]/g, '-');
    const memoryDir = join(paiDir, 'projects', encoded, 'memory');
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(join(memoryDir, 'insights_promoted.md'), `---
type: project
---

# Promoted Insights

## Old
old body

## Middle
middle body

## New
new body
`);

    const prev = process.env.CLAUDE_PROJECT_DIR;
    process.env.CLAUDE_PROJECT_DIR = projectDir;
    try {
      const result = loadPromotedInsights(paiDir, 2);
      expect(result).toContain('## Promoted Insights (recent)');
      expect(result).not.toContain('## Old');
      expect(result).toContain('## Middle');
      expect(result).toContain('## New');
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_PROJECT_DIR;
      else process.env.CLAUDE_PROJECT_DIR = prev;
    }
  });
});
