import { describe, it, expect, afterEach } from 'bun:test';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import {
  createInstinct,
  reinforceInstinct,
  archiveInstinct,
  decayInstincts,
  surfaceInstincts,
  formatInstinctContext,
  clusterInstincts,
  getInstinctStats,
  extractTags,
  loadInstincts,
  SURFACE_THRESHOLD,
  EVOLVE_THRESHOLD,
  MAX_ACTIVE,
  type Instinct,
} from '../hooks/lib/instinct-store';

const TMP = join('/tmp', 'test-instinct-store-' + Date.now());

function mkPaiDir(): string {
  const dir = join(TMP, Math.random().toString(36).slice(2));
  mkdirSync(join(dir, 'MEMORY', 'LEARNING', 'INSTINCTS'), { recursive: true });
  mkdirSync(join(dir, 'config'), { recursive: true });
  return dir;
}

afterEach(() => {
  try { rmSync(TMP, { recursive: true, force: true }); } catch { }
});

describe('createInstinct', () => {
  it('creates with initial confidence 0.3', () => {
    const paiDir = mkPaiDir();
    const inst = createInstinct(paiDir, 'Use bun test --bail', 'correction', 'test context');
    expect(inst.confidence).toBe(0.3);
    expect(inst.active).toBe(true);
    expect(inst.trigger_count).toBe(1);
  });

  it('reinforces near-duplicate instead of creating new', () => {
    const paiDir = mkPaiDir();
    const text = 'Use bun test --bail for faster feedback and efficiency always';
    createInstinct(paiDir, text, 'correction', 'ctx');
    const second = createInstinct(paiDir, text, 'correction', 'ctx2');
    const instincts = loadInstincts(paiDir);
    expect(instincts.length).toBe(1);
    expect(second.confidence).toBeGreaterThan(0.3);
  });

  it('enforces MAX_ACTIVE cap by archiving lowest-confidence', () => {
    const paiDir = mkPaiDir();
    for (let i = 0; i < MAX_ACTIVE + 1; i++) {
      createInstinct(paiDir, `unique instinct text ${i} for testing purposes`, 'correction', `ctx${i}`);
    }
    const instincts = loadInstincts(paiDir);
    expect(instincts.length).toBeLessThanOrEqual(MAX_ACTIVE);
  });
});

describe('reinforceInstinct', () => {
  it('adds 0.2 confidence per reinforcement', () => {
    const paiDir = mkPaiDir();
    const inst = createInstinct(paiDir, 'Some behavior to reinforce always', 'correction', 'ctx');
    const reinforced = reinforceInstinct(paiDir, inst.id);
    expect(reinforced.confidence).toBeCloseTo(0.5, 5);
    expect(reinforced.trigger_count).toBe(2);
  });

  it('caps confidence at 1.0', () => {
    const paiDir = mkPaiDir();
    let inst = createInstinct(paiDir, 'Max confidence instinct test behavior', 'correction', 'ctx');
    for (let i = 0; i < 10; i++) {
      inst = reinforceInstinct(paiDir, inst.id);
    }
    expect(inst.confidence).toBe(1.0);
  });
});

describe('decayInstincts', () => {
  it('decays confidence by 0.1 per 30-day period', () => {
    const paiDir = mkPaiDir();
    const inst = createInstinct(paiDir, 'Decay test instinct behavior pattern', 'correction', 'ctx');

    // Manually set last_decayed_at to 31 days ago
    const { writeFileSync } = require('fs');
    const old = new Date(Date.now() - 31 * 86_400_000).toISOString();
    const modified = { ...inst, last_decayed_at: old };
    writeFileSync(
      join(paiDir, 'MEMORY', 'LEARNING', 'INSTINCTS', 'instincts.jsonl'),
      JSON.stringify(modified) + '\n'
    );

    decayInstincts(paiDir);
    const instincts = loadInstincts(paiDir);
    expect(instincts[0].confidence).toBeCloseTo(0.2, 5);
  });

  it('archives when confidence reaches 0.0', () => {
    const paiDir = mkPaiDir();
    const inst = createInstinct(paiDir, 'Archive me test instinct behavior', 'correction', 'ctx');

    const { writeFileSync } = require('fs');
    // 3 periods ago → 0.3 - 0.3 = 0.0
    const old = new Date(Date.now() - 91 * 86_400_000).toISOString();
    const modified = { ...inst, last_decayed_at: old };
    writeFileSync(
      join(paiDir, 'MEMORY', 'LEARNING', 'INSTINCTS', 'instincts.jsonl'),
      JSON.stringify(modified) + '\n'
    );

    const archived = decayInstincts(paiDir);
    expect(archived).toBe(1);
    const instincts = loadInstincts(paiDir);
    expect(instincts.length).toBe(0);
  });

  it('does not double-apply decay in same period', () => {
    const paiDir = mkPaiDir();
    const inst = createInstinct(paiDir, 'No double decay instinct test case', 'correction', 'ctx');
    decayInstincts(paiDir);
    decayInstincts(paiDir);
    const instincts = loadInstincts(paiDir);
    expect(instincts[0].confidence).toBe(0.3); // unchanged — not yet 30 days
  });
});

describe('surfaceInstincts', () => {
  it('filters below SURFACE_THRESHOLD', () => {
    const paiDir = mkPaiDir();
    createInstinct(paiDir, 'Low confidence instinct test for surfacing', 'correction', 'ctx'); // 0.3 < 0.5
    const surfaced = surfaceInstincts(paiDir, '/Users/test/Projects/kai/');
    expect(surfaced.length).toBe(0);
  });

  it('surfaces instincts at or above threshold', () => {
    const paiDir = mkPaiDir();
    let inst = createInstinct(paiDir, 'High confidence instinct test surfacing', 'correction', 'ctx');
    reinforceInstinct(paiDir, inst.id); // 0.5
    const surfaced = surfaceInstincts(paiDir, '/Users/test/Projects/kai/');
    expect(surfaced.length).toBe(1);
  });
});

describe('extractTags', () => {
  it('extracts project and directory tags from cwd', () => {
    const tags = extractTags('some text', '/Users/you/Projects/kai/hooks/');
    expect(tags).toContain('kai');
    expect(tags).toContain('hooks');
  });

  it('extracts known tool names from text', () => {
    const tags = extractTags('Use bun test --bail for testing', '/Users/you/Projects/kai/');
    expect(tags).toContain('bun');
    expect(tags).toContain('testing');
  });

  it('caps at 5 tags', () => {
    const tags = extractTags('bun git npm grep curl tsc node', '/Users/you/Projects/my-project/hooks/scripts/');
    expect(tags.length).toBeLessThanOrEqual(5);
  });
});

describe('formatInstinctContext', () => {
  it('returns empty string for no instincts', () => {
    expect(formatInstinctContext([])).toBe('');
  });

  it('includes confidence percentage', () => {
    const inst: Instinct = {
      id: 'inst_test',
      text: 'Use bun test consistently',
      confidence: 0.75,
      tags: ['bun'],
      created: '2026-01-01T00:00:00Z',
      last_triggered: '2026-01-01T00:00:00Z',
      last_decayed_at: '2026-01-01T00:00:00Z',
      trigger_count: 3,
      source: 'correction',
      context: 'test',
      active: true,
    };
    const result = formatInstinctContext([inst]);
    expect(result).toContain('75%');
    expect(result).toContain('Use bun test consistently');
  });
});

describe('clusterInstincts', () => {
  it('clusters instincts with ≥2 shared tags', () => {
    const instincts: Instinct[] = [
      { id: 'a', text: 'a', confidence: 0.9, tags: ['bun', 'testing', 'kai'], created: '', last_triggered: '', last_decayed_at: '', trigger_count: 5, source: 'correction', context: '', active: true },
      { id: 'b', text: 'b', confidence: 0.85, tags: ['bun', 'testing', 'hooks'], created: '', last_triggered: '', last_decayed_at: '', trigger_count: 4, source: 'correction', context: '', active: true },
      { id: 'c', text: 'c', confidence: 0.8, tags: ['git', 'deployment'], created: '', last_triggered: '', last_decayed_at: '', trigger_count: 3, source: 'repetition', context: '', active: true },
    ];
    const clusters = clusterInstincts(instincts);
    expect(clusters.length).toBeGreaterThanOrEqual(1);
    const firstCluster = clusters[0];
    expect(firstCluster.instincts.length).toBe(2);
  });

  it('requires confidence ≥0.8 AND trigger_count ≥3', () => {
    const instincts: Instinct[] = [
      { id: 'low', text: 'low', confidence: 0.5, tags: ['bun', 'testing'], created: '', last_triggered: '', last_decayed_at: '', trigger_count: 5, source: 'correction', context: '', active: true },
      { id: 'fewt', text: 'fewt', confidence: 0.9, tags: ['bun', 'testing'], created: '', last_triggered: '', last_decayed_at: '', trigger_count: 1, source: 'correction', context: '', active: true },
    ];
    const clusters = clusterInstincts(instincts);
    expect(clusters.length).toBe(0);
  });
});

describe('getInstinctStats', () => {
  it('returns zero counts for empty store', () => {
    const paiDir = mkPaiDir();
    const stats = getInstinctStats(paiDir);
    expect(stats.active).toBe(0);
    expect(stats.eligible).toBe(0);
    expect(stats.archived).toBe(0);
  });
});
