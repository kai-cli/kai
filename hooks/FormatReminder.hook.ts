#!/usr/bin/env bun
/**
 * FormatReminder.hook.ts — Detect format violations and inject correction hint
 *
 * TRIGGER: UserPromptSubmit
 *
 * PURPOSE: Reads the cached last response (from LastResponseCache Stop hook)
 * and checks if it followed the mandatory PAI output format (ALGORITHM, NATIVE,
 * or MINIMAL mode headers). If the format was violated, injects additionalContext
 * reminding the model to use the correct format on this turn.
 *
 * PERFORMANCE: <5ms — reads a small cached file, runs regex checks
 */

import { readHookInput } from './lib/hook-io';
import { paiPath } from './lib/paths';
import { readFileSync, existsSync } from 'fs';

// Format markers that indicate a properly formatted response
const FORMAT_MARKERS = [
  /═+\s*PAI\s*\|\s*NATIVE\s*MODE\s*═+/,        // NATIVE mode header
  /═+\s*PAI\s*\|\s*ALGORITHM\s*═+/,             // ALGORITHM mode header
  /═+\s*PAI\s*═+/,                               // MINIMAL mode header
  /PHASE\s+\d/i,                                  // Algorithm phase markers
  /🗒️\s*TASK:/,                                   // NATIVE task line
  /🗣️\s*William the AI:/,                         // Summary line
];

// Responses that are exempt from format checking
const EXEMPT_PATTERNS = [
  /^$/,                                           // Empty response
  /^\s*<tool_use>/,                               // Pure tool calls
  /^\s*\{/,                                       // JSON output
];

function isFormatCompliant(text: string): boolean {
  // Check exemptions first
  for (const exempt of EXEMPT_PATTERNS) {
    if (exempt.test(text.trim())) return true;
  }

  // Check if any format marker is present
  for (const marker of FORMAT_MARKERS) {
    if (marker.test(text)) return true;
  }

  return false;
}

async function main() {
  const input = await readHookInput();
  if (!input) process.exit(0);

  const cachePath = paiPath('MEMORY', 'STATE', 'last-response.txt');
  if (!existsSync(cachePath)) {
    console.error('[FormatReminder] No cached response — skipping');
    process.exit(0);
  }

  let lastResponse: string;
  try {
    lastResponse = readFileSync(cachePath, 'utf-8');
  } catch {
    console.error('[FormatReminder] Failed to read cache — skipping');
    process.exit(0);
  }

  if (!lastResponse.trim()) {
    process.exit(0);
  }

  if (isFormatCompliant(lastResponse)) {
    console.error('[FormatReminder] Last response was format-compliant');
    process.exit(0);
  }

  // Format violation detected — inject reminder
  console.log(JSON.stringify({
    additionalContext: `<format_reminder>Your previous response did NOT use the mandatory PAI output format. Every response MUST use exactly one of: ALGORITHM, NATIVE, or MINIMAL mode. Start this response with the correct mode header. Review CLAUDE.md format rules.</format_reminder>`
  }));
  console.error('[FormatReminder] Format violation detected — reminder injected');

  process.exit(0);
}

main().catch((err) => {
  console.error('[FormatReminder] Error:', err);
  process.exit(0);
});
