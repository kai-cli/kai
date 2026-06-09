#!/usr/bin/env bun
/**
 * SecretScanner.hook.ts - Detect credentials in user prompts
 *
 * PURPOSE:
 * Scans user prompts for common credential patterns (API keys, tokens,
 * passwords, connection strings) before they enter the conversation.
 * Warns the user that secrets will be stored in transcripts and API logs.
 *
 * TRIGGER: UserPromptSubmit
 *
 * INPUT:
 * - user_prompt: The text the user is about to submit
 * - session_id: Current session identifier
 *
 * OUTPUT:
 * - stdout: JSON with optional warning message injected into context
 * - {"continue": true} → No secrets detected
 * - {"decision": "ask", "message": "..."} → Secret detected, warn user
 *
 * SECURITY MODEL:
 * - Regex-based pattern matching (no network calls, no inference)
 * - Warn-only (never blocks) — user decides whether to proceed
 * - Does NOT log the detected secret (that would defeat the purpose)
 * - Logs only the pattern type that matched
 */

import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { SECRET_PATTERNS } from './lib/secret-patterns';

const PAI_DIR = process.env.PAI_DIR || join(process.env.HOME!, '.claude');

// Secret patterns are single-sourced in hooks/lib/secret-patterns.ts (the UNION shared with
// SecretOutputDetector) so the two detectors can never drift apart. Warn-only; broad by design.

// --- Main ---

async function main(): Promise<void> {
  let input: { user_prompt?: string; session_id?: string };

  try {
    const reader = Bun.stdin.stream().getReader();
    let raw = '';
    const readLoop = (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += new TextDecoder().decode(value, { stream: true });
      }
    })();

    await Promise.race([readLoop, new Promise<void>(r => setTimeout(r, 50))]);

    if (!raw.trim()) {
      console.log(JSON.stringify({ continue: true }));
      return;
    }

    input = JSON.parse(raw);
  } catch {
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  const prompt = input.user_prompt || '';
  if (!prompt) {
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  // Scan for secrets
  const matches: string[] = [];
  for (const { name, pattern } of SECRET_PATTERNS) {
    if (pattern.test(prompt)) {
      matches.push(name);
    }
  }

  if (matches.length === 0) {
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  // Log the detection (pattern names only, never the actual secret)
  try {
    const now = new Date();
    const year = now.getFullYear().toString();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const logDir = join(PAI_DIR, 'MEMORY', 'SECURITY', year, month);
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    const logPath = join(logDir, `security-secret-detected-${timestamp}.jsonl`);
    appendFileSync(logPath, JSON.stringify({
      timestamp: now.toISOString(),
      session_id: input.session_id || 'unknown',
      event_type: 'alert',
      tool: 'UserPromptSubmit',
      category: 'secret_detection',
      patterns_matched: matches,
      action_taken: 'Warned user'
    }) + '\n');
  } catch {
    // Logging failure is non-fatal
  }

  // Warn the user
  const patternList = matches.map(m => `  - ${m}`).join('\n');
  console.log(JSON.stringify({
    decision: 'ask',
    message: `[KAI SECURITY] Potential credentials detected in your prompt:\n${patternList}\n\nSecrets in prompts are stored in session transcripts and sent to the API. Consider using environment variables or file references instead.\n\nProceed anyway?`
  }));
}

main().catch(() => {
  console.log(JSON.stringify({ continue: true }));
});
