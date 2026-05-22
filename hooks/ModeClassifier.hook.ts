#!/usr/bin/env bun
/**
 * ModeClassifier.hook.ts — Input classification + mode pre-classification
 *
 * TRIGGER: UserPromptSubmit (runs BEFORE RatingCapture)
 *
 * STAGE 1: Input classification (v6.0)
 *   Determines if input is a shell command, skill invocation, or AI query.
 *   Shell commands (p_shell > 0.85) get an execution hint. Skill invocations
 *   (starts with /) get a skill hint. Everything else proceeds to Stage 2.
 *   The ! prefix bypasses all classification — handled by Claude Code natively.
 *
 * STAGE 2: Mode classification (existing)
 *   For AI-classified input: MINIMAL/ALGORITHM/NATIVE using deterministic regex.
 *   Injects mode hint into additionalContext.
 */

import { readHookInput } from './lib/hook-io';
import { classify } from './lib/classify';
import { classifyInput } from './lib/input-classifier';

async function main() {
  const input = await readHookInput();
  if (!input) process.exit(0);

  const prompt = ((input as any).prompt || '').trim();

  // Stage 1: Input classification
  const inputClass = classifyInput(prompt);

  if (inputClass.classification === 'skill') {
    // Already handled by Claude Code — no additionalContext injection needed
    console.error(`[ModeClassifier] Skill invocation detected (p_skill=1.0)`);
    process.exit(0);
  }

  if (inputClass.classification === 'shell') {
    console.log(JSON.stringify({
      additionalContext: `<input_classification>shell</input_classification>\nThis input looks like a shell command (p_shell=${inputClass.p_shell.toFixed(2)}). If you agree, execute it directly using the Bash tool without asking for clarification. If the command fails or produces unexpected output, offer to interpret the result.`
    }));
    console.error(`[ModeClassifier] Shell hint injected (p_shell=${inputClass.p_shell.toFixed(2)})`);
    process.exit(0);
  }

  // Stage 2: AI-classified input — run existing mode classifier
  const mode = classify(prompt);

  // Only inject for MINIMAL and ALGORITHM — NATIVE is the default, no hint needed
  if (mode === 'ALGORITHM') {
    console.log(JSON.stringify({
      additionalContext: `<mode_hint>ALGORITHM</mode_hint>\nThis request is ALGORITHM mode. Your MANDATORY FIRST ACTION is to Read PAI/Algorithm/v3.13.0.md. Do NOT use NATIVE format. Do NOT skip the Algorithm.`
    }));
    console.error(`[ModeClassifier] Injected mode hint: ALGORITHM`);
  } else if (mode === 'MINIMAL') {
    console.log(JSON.stringify({
      additionalContext: `<mode_hint>MINIMAL</mode_hint>\nPre-classified as MINIMAL mode. Use the MINIMAL response format.`
    }));
    console.error(`[ModeClassifier] Injected mode hint: MINIMAL`);
  } else {
    console.error(`[ModeClassifier] NATIVE (no hint injected)`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('[ModeClassifier] Error:', err);
  process.exit(0);
});
