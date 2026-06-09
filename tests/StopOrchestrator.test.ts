/**
 * StopOrchestrator deadline tests — regression guard for "Stop hook hangs forever".
 *
 * The handler fan-out (Promise.allSettled) had no overall deadline; a hung handler
 * (e.g. DocCrossRefIntegrity's 15s inference) could wedge the Stop event indefinitely.
 * runHandlersWithDeadline() races the fan-out against HANDLER_DEADLINE_MS and reports
 * which handlers didn't finish. These tests pin that behavior.
 */
import { test, expect, describe } from 'bun:test';
import { runHandlersWithDeadline, HANDLER_DEADLINE_MS } from '../hooks/StopOrchestrator.hook';

const settle = (ms: number, fail = false) =>
  new Promise<void>((resolve, reject) => setTimeout(() => (fail ? reject(new Error('boom')) : resolve()), ms));

describe('runHandlersWithDeadline', () => {
  test('happy path: all handlers finish before deadline → no timeout', async () => {
    const r = await runHandlersWithDeadline([settle(5), settle(10)], ['A', 'B'], 1000);
    expect(r.timedOut).toBe(false);
    expect(r.unfinished).toEqual([]);
    expect(r.rejected).toEqual([]);
  });

  test('deadline wins: hung handler is reported as unfinished, fast one is not', async () => {
    const r = await runHandlersWithDeadline([settle(5), settle(10000)], ['Fast', 'Hung'], 50);
    expect(r.timedOut).toBe(true);
    expect(r.unfinished).toEqual(['Hung']);
  });

  test('rejected handler is isolated + recorded, not thrown', async () => {
    const r = await runHandlersWithDeadline([settle(5, true), settle(10)], ['Bad', 'Good'], 1000);
    expect(r.timedOut).toBe(false);
    expect(r.rejected).toEqual(['Bad']);
    expect(r.unfinished).toEqual([]);
  });

  test('empty handler list resolves immediately without timeout', async () => {
    const r = await runHandlersWithDeadline([], [], 1000);
    expect(r.timedOut).toBe(false);
    expect(r.unfinished).toEqual([]);
  });

  test('deadline default exceeds DocCrossRef 15s inference timeout', () => {
    expect(HANDLER_DEADLINE_MS).toBeGreaterThan(15000);
  });
});
