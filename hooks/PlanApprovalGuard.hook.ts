#!/usr/bin/env bun
/**
 * PlanApprovalGuard.hook.ts — Remind when a plan is awaiting approval
 *
 * TRIGGER: UserPromptSubmit (sync — outputs additionalContext)
 *
 * PURPOSE: After StopOrchestrator/PlanDetection writes plan-pending.json,
 * this hook injects a soft reminder on the next user prompt if the user
 * hasn't explicitly approved. Clears state on approval detection.
 *
 * PERFORMANCE: <5ms — reads one small JSON file, runs regex on user prompt
 */

import { readHookInput } from './lib/hook-io';
import { paiPath } from './lib/paths';
import { readFileSync, existsSync, unlinkSync } from 'fs';

const PLAN_STATE_PATH = paiPath('MEMORY', 'STATE', 'plan-pending.json');

const APPROVAL_PATTERNS = [
  /\b(go\s+ahead|do\s+it|start|execute|approved|proceed|ship\s+it|build\s+it|yes)\b/i,
  /\blet'?s\s+(go|do\s+it|start|build)\b/i,
  /\b(lgtm|looks\s+good|sounds\s+good|perfect|great|ok\s+(do|go|start|build))\b/i,
];

const NEW_TASK_PATTERN = /^(can you|please|i need|let'?s|how do|what|why|where|show me|fix|add|remove|update|create|delete|refactor|implement)\b/i;

export function isApproval(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (trimmed.length > 80) return false;
  if (trimmed.includes('?')) return false;

  // Check approval patterns first (takes priority over new-task detection)
  for (const pattern of APPROVAL_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }

  return false;
}

export function isNewTask(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (trimmed.length > 200 && NEW_TASK_PATTERN.test(trimmed)) return true;
  if (trimmed.includes('\n') && NEW_TASK_PATTERN.test(trimmed)) return true;
  return false;
}

async function main() {
  const input = await readHookInput();
  if (!input) process.exit(0);

  if (!existsSync(PLAN_STATE_PATH)) {
    process.exit(0);
  }

  const userPrompt = input.user_prompt || input.prompt || '';

  if (isApproval(userPrompt)) {
    try { unlinkSync(PLAN_STATE_PATH); } catch {}
    console.error('[PlanApprovalGuard] Approval detected — state cleared');
    process.exit(0);
  }

  if (isNewTask(userPrompt)) {
    try { unlinkSync(PLAN_STATE_PATH); } catch {}
    console.error('[PlanApprovalGuard] New task detected — plan superseded, state cleared');
    process.exit(0);
  }

  let stateAge = 0;
  try {
    const state = JSON.parse(readFileSync(PLAN_STATE_PATH, 'utf-8'));
    stateAge = Date.now() - new Date(state.detectedAt).getTime();
  } catch {}

  // Don't nag if the plan is more than 1 hour old (session likely moved on)
  if (stateAge > 3600000) {
    try { unlinkSync(PLAN_STATE_PATH); } catch {}
    console.error('[PlanApprovalGuard] Plan state expired (>1h) — cleared');
    process.exit(0);
  }

  console.log(JSON.stringify({
    additionalContext: `<plan_approval_reminder>A plan was presented in the previous response. Waiting for your go-ahead before executing. If the user's message is giving approval, proceed with the plan. If they're asking something else, the plan may be superseded.</plan_approval_reminder>`
  }));
  console.error('[PlanApprovalGuard] Plan pending — reminder injected');
  process.exit(0);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error('[PlanApprovalGuard] Error:', err);
    process.exit(0);
  });
}
