#!/usr/bin/env bun
/**
 * PlanDetection.ts — Stop handler that detects plan presentations
 *
 * Called by StopOrchestrator after each assistant response.
 * Writes MEMORY/STATE/plan-pending.json when a plan is detected.
 * PlanApprovalGuard (UserPromptSubmit) reads this state.
 */

import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type { ParsedTranscript } from '../../PAI/Tools/TranscriptParser';
import { getPaiDir } from '../lib/paths';

const PLAN_STATE_PATH = join(getPaiDir(), 'MEMORY', 'STATE', 'plan-pending.json');

export interface PlanSignals {
  hasPhaseHeader: boolean;
  hasCompletionGate: boolean;
  hasTimeEstimate: boolean;
  hasExecutionOrder: boolean;
  signalCount: number;
}

export function detectPlanSignals(text: string): PlanSignals {
  const hasPhaseHeader = /^#{1,3}\s*Phase\s+\w/m.test(text) || /^#{1,3}\s*Execution Order/m.test(text);
  const hasCompletionGate = /^-\s*\[\s*[x ]\s*\].*\b(gate|pass|ship|complete|test|verify)/mi.test(text);
  const hasTimeEstimate = /~?\d+[-–]\d+\s*(hours?|h\b|days?|sessions?)/i.test(text);
  const hasExecutionOrder = /execution\s+order|execution\s+plan/i.test(text);

  const signalCount = [hasPhaseHeader, hasCompletionGate, hasTimeEstimate, hasExecutionOrder]
    .filter(Boolean).length;

  return { hasPhaseHeader, hasCompletionGate, hasTimeEstimate, hasExecutionOrder, signalCount };
}

export function isPlanPresentation(text: string): boolean {
  const signals = detectPlanSignals(text);
  return signals.signalCount >= 2;
}

export async function handlePlanDetection(parsed: ParsedTranscript, sessionId: string): Promise<void> {
  const text = parsed.plainCompletion || parsed.lastMessage || '';
  if (!text) return;

  if (isPlanPresentation(text)) {
    const stateDir = dirname(PLAN_STATE_PATH);
    if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });

    writeFileSync(PLAN_STATE_PATH, JSON.stringify({
      sessionId,
      detectedAt: new Date().toISOString(),
      signals: detectPlanSignals(text),
    }, null, 2));
    console.error('[PlanDetection] Plan detected — state written');
  }
}
