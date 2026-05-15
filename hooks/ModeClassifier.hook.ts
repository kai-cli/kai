#!/usr/bin/env bun
/**
 * ModeClassifier.hook.ts — Deterministic mode pre-classification
 *
 * TRIGGER: UserPromptSubmit (runs BEFORE RatingCapture)
 *
 * PURPOSE: Prevent LLM from defaulting to NATIVE mode ~91% of the time due to
 * template attractor bias in CLAUDE.md. Uses deterministic regex (<20ms, no API)
 * to classify prompts and inject a mode hint into additionalContext.
 *
 * MODES:
 * - MINIMAL:    greetings, ratings, short acknowledgments
 * - ALGORITHM:  action verbs indicating substantial work
 * - NATIVE:     everything else (no injection — let CLAUDE.md classify)
 */

import { readHookInput } from './lib/hook-io';
import { classify } from './lib/classify';

async function main() {
  const input = await readHookInput();
  if (!input) process.exit(0);

  const prompt = ((input as any).prompt || '').trim();

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
