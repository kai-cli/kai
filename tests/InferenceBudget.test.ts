/**
 * InferenceBudget.test.ts — Unit tests for hooks/lib/inference-budget.ts
 *
 * Tests: session isolation, budget counting, reset on new session,
 *        budgetStatus string format, concurrent recording.
 *
 * Run: bun test tests/InferenceBudget.test.ts
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ── Fixture ───────────────────────────────────────────────────────────────────

let tmpDir: string;

function setup() {
  tmpDir = mkdtempSync(join(tmpdir(), 'pai-budget-test-'));
  mkdirSync(join(tmpDir, 'MEMORY', 'STATE'), { recursive: true });
  process.env.PAI_DIR = tmpDir;
  // Clear cached session ID between tests
  delete process.env.CLAUDE_SESSION_ID;
}

function cleanup() {
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.PAI_DIR;
  delete process.env.CLAUDE_SESSION_ID;
}

// Re-import after env is set. Bun caches modules, so we use dynamic import
// keyed on a unique session to force fresh state reads.
async function getBudget() {
  // The module uses lazy path eval so env var changes are respected per-call.
  const mod = await import('../hooks/lib/inference-budget');
  return mod;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('inference-budget', () => {
  beforeEach(() => {
    setup();
    process.env.CLAUDE_SESSION_ID = 'test-session-001';
  });

  test('starts with full budget (3 remaining)', async () => {
    const { remainingBudget } = await getBudget();
    expect(remainingBudget()).toBe(3);
  });

  test('canCallInference returns true on fresh budget', async () => {
    const { canCallInference } = await getBudget();
    expect(canCallInference()).toBe(true);
  });

  test('budget decrements after recordInferenceCall', async () => {
    const { recordInferenceCall, remainingBudget } = await getBudget();
    recordInferenceCall('ReflectionHarvester', 'firmware');
    expect(remainingBudget()).toBe(2);
    recordInferenceCall('ReflectionHarvester', 'products');
    expect(remainingBudget()).toBe(1);
  });

  test('canCallInference returns false when budget exhausted', async () => {
    const { recordInferenceCall, canCallInference } = await getBudget();
    recordInferenceCall('ReflectionHarvester', 'firmware');
    recordInferenceCall('ReflectionHarvester', 'products');
    recordInferenceCall('ReflectionHarvester', 'devops');
    expect(canCallInference()).toBe(false);
    expect(canCallInference()).toBe(false); // stable
  });

  test('remainingBudget never goes below 0', async () => {
    const { recordInferenceCall, remainingBudget } = await getBudget();
    for (let i = 0; i < 10; i++) recordInferenceCall('TestHook');
    expect(remainingBudget()).toBe(0);
  });

  test('budgetStatus returns correct format', async () => {
    const { recordInferenceCall, budgetStatus } = await getBudget();
    expect(budgetStatus()).toMatch(/^0\/3 calls used/);
    recordInferenceCall('ReflectionHarvester', 'firmware');
    expect(budgetStatus()).toMatch(/^1\/3 calls used/);
    expect(budgetStatus()).toContain('2 remaining');
  });

  test('new session resets budget to full', async () => {
    const { recordInferenceCall, remainingBudget } = await getBudget();
    // Exhaust budget under session A
    recordInferenceCall('ReflectionHarvester', 'firmware');
    recordInferenceCall('ReflectionHarvester', 'products');
    recordInferenceCall('ReflectionHarvester', 'devops');
    expect(remainingBudget()).toBe(0);

    // Switch to a new session ID
    process.env.CLAUDE_SESSION_ID = 'test-session-002';
    expect(remainingBudget()).toBe(3);
  });

  test('budget persists across multiple calls in same session', async () => {
    const { recordInferenceCall, remainingBudget } = await getBudget();
    recordInferenceCall('Hook1');
    const { remainingBudget: remaining2 } = await getBudget();
    expect(remaining2()).toBe(2);
  });

  test('records hook name and domain in call log', async () => {
    const { recordInferenceCall } = await getBudget();
    const { readFileSync, existsSync } = await import('fs');
    const { join } = await import('path');

    recordInferenceCall('ReflectionHarvester', 'firmware');

    const budgetFile = join(tmpDir, 'MEMORY', 'STATE', '.inference-budget.json');
    expect(existsSync(budgetFile)).toBe(true);

    const state = JSON.parse(readFileSync(budgetFile, 'utf-8'));
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].hook).toBe('ReflectionHarvester');
    expect(state.calls[0].domain).toBe('firmware');
    expect(state.calls[0].timestamp).toBeTruthy();
  });

  test('cleanup: rmSync', () => { cleanup(); });
});
