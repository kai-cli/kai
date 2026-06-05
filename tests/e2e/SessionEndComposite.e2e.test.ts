/**
 * SessionEndComposite.e2e.test.ts — Integration test for the W4 SessionEnd chain (SF-7)
 *
 * STRATEGY (deliberate): the composite spawns REAL sub-hooks. On substantial/feedback
 * sessions those include inference hooks (KnowledgeSync etc.) that cost tokens + many
 * seconds — unsuitable for a test runner. So we split coverage:
 *
 *  1. Deterministic unit assertions on the PURE selection logic (selectSessionEndHooks +
 *     isTrivialSession + the always/inference sets) — free, instant, and the real guard
 *     against the "dropped MemCapture" class of regression.
 *  2. ONE real subprocess smoke: a TRIVIAL session (always-run set only — all fast/no-LLM)
 *     to prove the composite wires up, gates, and exits 0 end-to-end via the harness.
 *
 * This is the SF-7 integration safety net for the W4 composite adoption.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'path';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { runHook } from './hook-harness';
import {
  selectSessionEndHooks,
  isTrivialSession,
  analyzeTranscript,
  ALWAYS_RUN_HOOKS,
  INFERENCE_HOOKS,
} from '../../hooks/SessionEndComposite.hook';

const HOOK_PATH = join(import.meta.dir, '../../hooks/SessionEndComposite.hook.ts');
const REPO_ROOT = join(import.meta.dir, '../..');

let TMP: string;

function jsonl(...entries: object[]): string {
  return entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

function makeTranscript(name: string, turns: number, extra = ''): string {
  const entries: object[] = [];
  for (let i = 0; i < turns; i++) {
    entries.push({ type: 'user', message: { content: `message ${i} ${extra}` } });
    entries.push({ type: 'assistant', message: { content: `reply ${i} with enough text to add some tokens here and there` } });
  }
  const p = join(TMP, name);
  writeFileSync(p, jsonl(...entries));
  return p;
}

describe('SessionEndComposite — hook selection (pure, deterministic)', () => {
  test('always-run set includes MemCapture (regression guard for the W4 omission)', () => {
    expect(ALWAYS_RUN_HOOKS).toContain('MemCapture');
  });

  test('always-run set is the 5 fast/no-LLM hooks', () => {
    expect([...ALWAYS_RUN_HOOKS].sort()).toEqual(
      ['IntegrityCheck', 'MemCapture', 'MemoryTimeline', 'SessionCleanup', 'UpdateCounts'].sort()
    );
  });

  test('trivial session selects only the 5 always-run hooks', () => {
    const hooks = selectSessionEndHooks(true);
    expect(hooks).toHaveLength(5);
    expect(hooks).toContain('MemCapture');
    for (const inf of INFERENCE_HOOKS) expect(hooks).not.toContain(inf);
  });

  test('substantial session selects all 10 hooks', () => {
    const hooks = selectSessionEndHooks(false);
    expect(hooks).toHaveLength(10);
    for (const inf of INFERENCE_HOOKS) expect(hooks).toContain(inf);
    expect(hooks).toContain('MemCapture');
  });

  test('every live SessionEnd hook is covered by the composite (no silent drop)', () => {
    // The 10 hooks the pre-W4 hooks.jsonc wired.
    const liveHooks = [
      'WorkCompletionLearning', 'MemCapture', 'MemoryTimeline', 'SessionCleanup',
      'SessionSummary', 'RelationshipMemory', 'UpdateCounts', 'IntegrityCheck',
      'InsightExtractor', 'KnowledgeSync',
    ];
    const covered = selectSessionEndHooks(false);
    for (const h of liveHooks) expect(covered).toContain(h);
  });
});

describe('SessionEndComposite — trivial gate (analyzeTranscript + isTrivialSession)', () => {
  beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), 'w4-sec-')); });
  afterAll(() => { rmSync(TMP, { recursive: true, force: true }); });

  test('tiny transcript is trivial', () => {
    const p = makeTranscript('tiny.jsonl', 1);
    expect(isTrivialSession(analyzeTranscript(p))).toBe(true);
  });

  test('large transcript is not trivial', () => {
    const p = makeTranscript('big.jsonl', 40);
    expect(isTrivialSession(analyzeTranscript(p))).toBe(false);
  });

  test('/feedback bypasses the gate even when tiny', () => {
    const p = makeTranscript('fb.jsonl', 1, '/feedback loved it');
    const m = analyzeTranscript(p);
    expect(m.hasFeedback).toBe(true);
    expect(isTrivialSession(m)).toBe(false);
  });
});

describe('SessionEndComposite — real subprocess smoke (trivial only, no inference)', () => {
  let SMOKE_TMP: string;
  beforeAll(() => { SMOKE_TMP = mkdtempSync(join(tmpdir(), 'w4-smoke-')); });
  afterAll(() => { rmSync(SMOKE_TMP, { recursive: true, force: true }); });

  test('trivial session runs the always-run set and exits 0', async () => {
    const entries = [
      { type: 'user', message: { content: 'hi' } },
      { type: 'assistant', message: { content: 'short reply' } },
    ];
    const transcript = join(SMOKE_TMP, 'smoke.jsonl');
    writeFileSync(transcript, jsonl(...entries));
    const r = await runHook(
      HOOK_PATH,
      { session_id: 'w4-smoke', transcript_path: transcript, hook_event_name: 'SessionEnd' },
      { PAI_DIR: REPO_ROOT }
    );
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toContain('Trivial session detected');
    expect(r.stderr).toContain('Running 5 hooks');
  }, 30000);
});
