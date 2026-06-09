/**
 * AlgorithmState.test.ts — algorithm-state.ts core state machine
 *
 * Covers the read/write round-trip, the corrupt-JSON → null path (the swallow-catch
 * audit 🟡 at readState:151), phase transitions, criteria add + dedup, rework archival,
 * and the stale-active sweep. Module resolves paths from PAI_DIR, so we point it at a
 * fresh tmp dir per run.
 *
 * NOTE: algorithm-state.ts reads BASE_DIR once at import time (module-level const), so we
 * set PAI_DIR BEFORE importing. All tests share one tmp PAI_DIR.
 */
import { test, expect, describe, beforeAll, afterAll, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, utimesSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TMP = mkdtempSync(join(tmpdir(), 'pai-algostate-'));
process.env.PAI_DIR = TMP;
const ALGO_DIR = join(TMP, 'MEMORY', 'STATE', 'algorithms');

// Import AFTER setting PAI_DIR so the module's BASE_DIR const picks it up.
const {
  readState, writeState, phaseTransition, criteriaAdd, criteriaUpdate,
  effortLevelUpdate, agentAdd, algorithmEnd, sweepStaleActive, algorithmAbandon,
} = await import('../hooks/lib/algorithm-state');

function statePath(sid: string) { return join(ALGO_DIR, `${sid}.json`); }

beforeAll(() => { mkdirSync(ALGO_DIR, { recursive: true }); });
afterAll(() => { rmSync(TMP, { recursive: true, force: true }); });

describe('readState', () => {
  test('returns null when no state file exists', () => {
    expect(readState('nonexistent')).toBeNull();
  });

  test('returns null on empty / "{}" file (not yet initialized)', () => {
    writeFileSync(statePath('empty'), '');
    expect(readState('empty')).toBeNull();
    writeFileSync(statePath('braces'), '{}');
    expect(readState('braces')).toBeNull();
  });

  test('returns null on CORRUPT json (swallow-catch audit 151 — degrade, do not throw)', () => {
    writeFileSync(statePath('corrupt'), '{ this is not valid json ');
    // The documented behavior: corruption is masked as "no state" (resets on next write).
    // This test PINS that contract so a future change to throw/log is a conscious one.
    expect(() => readState('corrupt')).not.toThrow();
    expect(readState('corrupt')).toBeNull();
  });
});

describe('write/read round-trip', () => {
  test('writeState persists and effortLevel mirrors sla', () => {
    phaseTransition('rt', 'OBSERVE');
    const s = readState('rt')!;
    expect(s).not.toBeNull();
    expect(s.sessionId).toBe('rt');
    expect(s.currentPhase).toBe('OBSERVE');
    expect(s.effortLevel).toBe(s.sla); // writeState keeps them in sync
    expect(existsSync(statePath('rt'))).toBe(true);
  });
});

describe('phaseTransition', () => {
  test('creates state on first transition, then advances + closes prior phase', () => {
    phaseTransition('pt', 'OBSERVE');
    phaseTransition('pt', 'THINK');
    const s = readState('pt')!;
    expect(s.currentPhase).toBe('THINK');
    expect(s.phaseHistory.length).toBe(2);
    expect(s.phaseHistory[0].phase).toBe('OBSERVE');
    expect(s.phaseHistory[0].completedAt).toBeGreaterThan(0); // prior phase closed
  });

  test('LEARN sets completedAt but keeps state active until algorithmEnd', () => {
    phaseTransition('learn', 'OBSERVE');
    phaseTransition('learn', 'LEARN');
    const s = readState('learn')!;
    expect(s.currentPhase).toBe('LEARN');
    expect(s.completedAt).toBeGreaterThan(0);
    expect(s.active).toBe(true);
  });

  test('OBSERVE after a completed run archives the prior cycle (rework detection)', () => {
    phaseTransition('rw', 'OBSERVE');
    criteriaAdd('rw', { id: 'ISC-1', description: 'x', type: 'criterion', status: 'pending', createdInPhase: 'OBSERVE' });
    phaseTransition('rw', 'LEARN');     // first cycle has work
    phaseTransition('rw', 'OBSERVE');   // new run → should archive
    const s = readState('rw')!;
    expect(s.reworkCount).toBe(1);
    expect(s.isRework).toBe(true);
    expect(s.reworkHistory?.length).toBe(1);
    expect(s.reworkHistory![0].criteria.some(c => c.id === 'ISC-1')).toBe(true);
    expect(s.criteria.length).toBe(0); // fresh cycle starts empty
  });
});

describe('criteria', () => {
  test('criteriaAdd creates state if missing + dedups by id', () => {
    criteriaAdd('crit', { id: 'ISC-1', description: 'first', type: 'criterion', status: 'pending', createdInPhase: 'OBSERVE' });
    criteriaAdd('crit', { id: 'ISC-1', description: 'dup', type: 'criterion', status: 'pending', createdInPhase: 'OBSERVE' });
    criteriaAdd('crit', { id: 'ISC-2', description: 'second', type: 'criterion', status: 'pending', createdInPhase: 'OBSERVE' });
    const s = readState('crit')!;
    expect(s.criteria.length).toBe(2);
    expect(s.criteria[0].description).toBe('first'); // dup ignored, original kept
  });

  test('criteriaUpdate flips status by taskId', () => {
    criteriaAdd('cu', { id: 'ISC-1', description: 'x', type: 'criterion', status: 'pending', createdInPhase: 'OBSERVE', taskId: 't-1' });
    criteriaUpdate('cu', 't-1', 'completed');
    expect(readState('cu')!.criteria.find(c => c.taskId === 't-1')!.status).toBe('completed');
  });

  test('criteriaUpdate is a no-op when session/task is unknown (no throw)', () => {
    expect(() => criteriaUpdate('ghost', 't-x', 'completed')).not.toThrow();
  });
});

describe('effortLevel + agents', () => {
  test('effortLevelUpdate sets sla (and effortLevel mirror on write)', () => {
    phaseTransition('eff', 'OBSERVE');
    effortLevelUpdate('eff', 'Extended');
    const s = readState('eff')!;
    expect(s.sla).toBe('Extended');
    expect(s.effortLevel).toBe('Extended');
  });

  test('agentAdd appends an active agent and dedups by name', () => {
    phaseTransition('ag', 'OBSERVE');
    agentAdd('ag', { name: 'Worker1', agentType: 'Engineer', task: 'do' });
    agentAdd('ag', { name: 'Worker1', agentType: 'Engineer' }); // dup name
    const s = readState('ag')!;
    expect(s.agents.length).toBe(1);
    expect(s.agents[0].status).toBe('active');
  });
});

describe('algorithmEnd', () => {
  test('non-algorithm response deactivates an optimistically-activated session', () => {
    phaseTransition('opt', 'OBSERVE'); // active, 1 phase, 0 criteria
    algorithmEnd('opt', { isAlgorithmResponse: false });
    const s = readState('opt')!;
    expect(s.active).toBe(false);
    expect(s.currentPhase).toBe('COMPLETE');
  });

  test('terminal LEARN/COMPLETE enrichment marks state complete + inactive', () => {
    phaseTransition('end', 'OBSERVE');
    phaseTransition('end', 'LEARN');
    algorithmEnd('end', { isAlgorithmResponse: true, summary: 'done', criteria: [
      { id: 'ISC-9', description: 'new', type: 'criterion', status: 'completed', createdInPhase: 'LEARN' },
    ]});
    const s = readState('end')!;
    expect(s.active).toBe(false);
    expect(s.currentPhase).toBe('COMPLETE');
    expect(s.summary).toBe('done');
    expect(s.criteria.some(c => c.id === 'ISC-9')).toBe(true); // merged from transcript
  });
});

describe('algorithmAbandon', () => {
  test('marks abandoned + inactive; false when session missing', () => {
    phaseTransition('ab', 'OBSERVE');
    expect(algorithmAbandon('ab')).toBe(true);
    const s = readState('ab')!;
    expect(s.abandoned).toBe(true);
    expect(s.active).toBe(false);
    expect(algorithmAbandon('missing')).toBe(false);
  });
});

describe('sweepStaleActive', () => {
  test('deactivates an active session whose file is older than its phase threshold', () => {
    phaseTransition('stale', 'OBSERVE'); // OBSERVE → 15min default threshold
    // Backdate the file mtime by 20 minutes so it's stale.
    const twentyMinAgo = (Date.now() - 20 * 60 * 1000) / 1000;
    utimesSync(statePath('stale'), twentyMinAgo, twentyMinAgo);
    sweepStaleActive('some-other-current-session');
    const s = readState('stale')!;
    expect(s.active).toBe(false);
    expect(s.currentPhase).toBe('COMPLETE');
  });

  test('does NOT deactivate the current session (handled by algorithmEnd)', () => {
    phaseTransition('current', 'OBSERVE');
    const twentyMinAgo = (Date.now() - 20 * 60 * 1000) / 1000;
    utimesSync(statePath('current'), twentyMinAgo, twentyMinAgo);
    sweepStaleActive('current'); // current session is skipped
    expect(readState('current')!.active).toBe(true);
  });

  test('does not throw when the algorithms dir is empty of valid sessions', () => {
    expect(() => sweepStaleActive('whatever')).not.toThrow();
  });
});
