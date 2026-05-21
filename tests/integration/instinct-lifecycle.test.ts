/**
 * Integration test: full instinct lifecycle
 * capture → accumulate → surface → evolve → archive
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import {
  createInstinct,
  reinforceInstinct,
  archiveInstinct,
  decayInstincts,
  surfaceInstincts,
  clusterInstincts,
  loadInstincts,
  getInstinctStats,
  SURFACE_THRESHOLD,
  EVOLVE_THRESHOLD,
} from '../../hooks/lib/instinct-store';

const TMP = join('/tmp', 'test-instinct-lifecycle-' + Date.now());

function mkPaiDir(): string {
  const dir = join(TMP, Math.random().toString(36).slice(2));
  mkdirSync(join(dir, 'MEMORY', 'LEARNING', 'INSTINCTS'), { recursive: true });
  return dir;
}

afterEach(() => {
  try { rmSync(TMP, { recursive: true, force: true }); } catch { }
});

describe('Instinct lifecycle: capture → surface', () => {
  it('new instinct starts below surface threshold', () => {
    const paiDir = mkPaiDir();
    const inst = createInstinct(paiDir, 'Test instinct for lifecycle check', 'correction', 'ctx');
    expect(inst.confidence).toBeLessThan(SURFACE_THRESHOLD);
  });

  it('reaches surface threshold after reinforcement', () => {
    const paiDir = mkPaiDir();
    let inst = createInstinct(paiDir, 'Test instinct reaching surface threshold', 'correction', 'ctx');
    inst = reinforceInstinct(paiDir, inst.id); // 0.5 = SURFACE_THRESHOLD
    expect(inst.confidence).toBeGreaterThanOrEqual(SURFACE_THRESHOLD);
    const surfaced = surfaceInstincts(paiDir);
    expect(surfaced.some(i => i.id === inst.id)).toBe(true);
  });

  it('reaches evolution threshold after multiple reinforcements', () => {
    const paiDir = mkPaiDir();
    let inst = createInstinct(paiDir, 'Test instinct reaching evolution threshold', 'correction', 'ctx');
    for (let i = 0; i < 4; i++) {
      inst = reinforceInstinct(paiDir, inst.id);
    }
    // 0.3 + (4 × 0.2) = 1.1 → capped at 1.0
    expect(inst.confidence).toBe(1.0);
    expect(inst.confidence).toBeGreaterThanOrEqual(EVOLVE_THRESHOLD);
  });
});

describe('Instinct lifecycle: decay → archive', () => {
  it('decayed-to-zero instinct gets archived', () => {
    const paiDir = mkPaiDir();
    const inst = createInstinct(paiDir, 'Instinct that will be archived by decay', 'correction', 'ctx');

    // Manually age it 91+ days (3 periods × -0.1 = -0.3, 0.3 - 0.3 = 0.0)
    const old = new Date(Date.now() - 91 * 86_400_000).toISOString();
    const modified = { ...inst, last_decayed_at: old };
    writeFileSync(
      join(paiDir, 'MEMORY', 'LEARNING', 'INSTINCTS', 'instincts.jsonl'),
      JSON.stringify(modified) + '\n'
    );

    const archived = decayInstincts(paiDir);
    expect(archived).toBe(1);

    const active = loadInstincts(paiDir);
    expect(active.find(i => i.id === inst.id)).toBeUndefined();
  });

  it('manually archived instinct disappears from active', () => {
    const paiDir = mkPaiDir();
    const inst = createInstinct(paiDir, 'Manually archived instinct test case', 'correction', 'ctx');
    archiveInstinct(paiDir, inst.id);
    const active = loadInstincts(paiDir);
    expect(active.find(i => i.id === inst.id)).toBeUndefined();
  });
});

describe('Instinct lifecycle: cluster detection', () => {
  it('clusters instincts with shared tags and high confidence', () => {
    const paiDir = mkPaiDir();
    const cwd = '/Users/user/Projects/kai/hooks/';

    // Create two instincts with same project/directory tags
    let a = createInstinct(paiDir, 'Use bun test --bail for faster testing feedback', 'correction', 'ctx', cwd);
    let b = createInstinct(paiDir, 'Always run bun test before declaring done', 'correction', 'ctx', cwd);

    // Reinforce to evolution threshold
    for (let i = 0; i < 4; i++) {
      a = reinforceInstinct(paiDir, a.id);
      b = reinforceInstinct(paiDir, b.id);
    }

    const all = loadInstincts(paiDir);
    const clusters = clusterInstincts(all);

    // Should have at least one cluster (both share kai, hooks tags)
    expect(clusters.length).toBeGreaterThanOrEqual(1);
  });
});

describe('getInstinctStats', () => {
  it('tracks lifecycle metrics accurately', () => {
    const paiDir = mkPaiDir();
    const cwd = '/Users/user/Projects/kai/';

    let inst = createInstinct(paiDir, 'Stats test instinct lifecycle tracking', 'correction', 'ctx', cwd);
    reinforceInstinct(paiDir, inst.id);
    archiveInstinct(paiDir, inst.id);

    createInstinct(paiDir, 'Another active instinct for stats testing', 'repetition', 'ctx', cwd);

    const stats = getInstinctStats(paiDir);
    expect(stats.active).toBe(1);
    expect(stats.archived).toBe(1);
  });
});
