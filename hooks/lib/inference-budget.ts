// inference-budget.ts - SessionEnd inference budget cap
//
// Limits total LLM inference calls across all SessionEnd hooks to prevent
// timeout cascading and excessive latency. KnowledgeSync gets priority.
//
// Usage:
//   import { canCallInference, recordInferenceCall } from './lib/inference-budget';
//   if (!canCallInference()) { /* skip or batch */ }
//   // ... make inference call ...
//   recordInferenceCall('KnowledgeSync', 'firmware');

import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { paiPath } from './paths';
import { atomicWriteJSON } from './atomic';

const getStateDir  = () => paiPath('MEMORY', 'STATE');
const getBudgetFile = () => join(getStateDir(), '.inference-budget.json');

// Max LLM calls per SessionEnd across all hooks
const MAX_SESSION_END_CALLS = 3;

interface BudgetState {
  sessionId: string;
  calls: Array<{
    hook: string;
    domain?: string;
    timestamp: string;
  }>;
  maxCalls: number;
}

function getSessionId(): string {
  return process.env.CLAUDE_SESSION_ID || `unknown-${Date.now()}`;
}

function loadBudget(): BudgetState {
  const budgetFile = getBudgetFile();
  if (!existsSync(budgetFile)) {
    return { sessionId: getSessionId(), calls: [], maxCalls: MAX_SESSION_END_CALLS };
  }
  try {
    const state = JSON.parse(readFileSync(budgetFile, 'utf-8'));
    // Reset if different session
    if (state.sessionId !== getSessionId()) {
      return { sessionId: getSessionId(), calls: [], maxCalls: MAX_SESSION_END_CALLS };
    }
    return state;
  } catch {
    return { sessionId: getSessionId(), calls: [], maxCalls: MAX_SESSION_END_CALLS };
  }
}

function saveBudget(state: BudgetState): void {
  mkdirSync(getStateDir(), { recursive: true });
  atomicWriteJSON(getBudgetFile(), state);
}

/**
 * Check if the inference budget allows another call.
 * Returns the number of remaining calls (0 = no budget left).
 */
export function remainingBudget(): number {
  const state = loadBudget();
  return Math.max(0, state.maxCalls - state.calls.length);
}

/**
 * Check if at least one inference call is available.
 */
export function canCallInference(): boolean {
  return remainingBudget() > 0;
}

/**
 * Record that an inference call was made by a hook.
 * Call this AFTER a successful inference to track budget consumption.
 */
export function recordInferenceCall(hook: string, domain?: string): void {
  const state = loadBudget();
  state.calls.push({
    hook,
    domain,
    timestamp: new Date().toISOString(),
  });
  saveBudget(state);
}

/**
 * Get current budget status for logging.
 */
export function budgetStatus(): string {
  const state = loadBudget();
  return `${state.calls.length}/${state.maxCalls} calls used (${remainingBudget()} remaining)`;
}
