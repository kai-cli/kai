#!/usr/bin/env bun
/**
 * InstinctCapture.hook.ts — Detect corrections and capture behavioral instincts
 *
 * TRIGGER: UserPromptSubmit
 * PURPOSE: Detect correction patterns in user messages, create instincts.
 *
 * Patterns:
 *   Pattern 1: Explicit imperative + preceding PAI tool call
 *   Pattern 2: Repeated instruction (≥20-char exact substring match)
 *   Pattern 3: Low rating signal (≤3) bridged from ratings.jsonl
 *   Pattern 4: File revert detection (v5.7) — user externally modified a file PAI wrote,
 *              reverting ≥50% of KAI's changes
 */

import { readFileSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { readHookInput, parseTranscriptFromInput } from './lib/hook-io';
import { getPaiDir } from './lib/paths';
import { createInstinct, createInstinctWithDedup } from './lib/instinct-store';
import { loadLedger, type WriteEntry } from './WriteTracker.hook';

// Pattern 1: explicit imperative correction
const CORRECTION_PATTERN = /\b(no[,.]?\s+(don'?t|stop|never|quit|please\s+don'?t)|don'?t\s+\w+|stop\s+\w+ing|never\s+\w+|quit\s+\w+ing|please\s+don'?t)\b/i;

export function detectPattern1(prompt: string, transcriptMessages: Array<{ role: string; hasToolCall: boolean }>): boolean {
  if (!CORRECTION_PATTERN.test(prompt)) return false;

  // Gate: must follow a PAI tool call within last 3 messages before this user turn
  // If no transcript available (empty messages), still capture — the correction itself is signal
  if (transcriptMessages.length === 0) return true;
  const recent = transcriptMessages.slice(-3);
  return recent.some(m => m.role === 'assistant' && m.hasToolCall);
}

export function detectPattern2(prompt: string, priorUserMessages: string[]): string | null {
  for (const prior of priorUserMessages) {
    if (prior.length < 20) continue;
    // Check if current prompt contains a substring of a prior message (≥20 chars)
    const window = prior.substring(0, Math.min(prior.length, 80));
    if (window.length >= 20 && prompt.includes(window)) {
      return prior;
    }
  }
  return null;
}

function extractTranscriptContext(transcriptPath: string): {
  messages: Array<{ role: string; hasToolCall: boolean; text: string }>;
  priorUserMessages: string[];
} {
  const empty = { messages: [], priorUserMessages: [] };
  if (!existsSync(transcriptPath)) return empty;

  try {
    const lines = readFileSync(transcriptPath, 'utf-8').trim().split('\n');
    const messages: Array<{ role: string; hasToolCall: boolean; text: string }> = [];
    const priorUserMessages: string[] = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as any;
        const role = entry.type === 'human' || entry.type === 'user' ? 'user' : 'assistant';
        const content = entry.message?.content;

        let text = '';
        let hasToolCall = false;

        if (typeof content === 'string') {
          text = content;
        } else if (Array.isArray(content)) {
          text = content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join(' ');
          hasToolCall = content.some((b: any) => b?.type === 'tool_use');
        }

        messages.push({ role, hasToolCall, text });
        if (role === 'user' && text.trim().length >= 20) {
          priorUserMessages.push(text.trim());
        }
      } catch { /* skip bad lines */ }
    }

    // Remove the last user message (current prompt) from priorUserMessages
    priorUserMessages.pop();

    return { messages, priorUserMessages };
  } catch {
    return empty;
  }
}

import { createHash } from 'crypto';

const REVERT_THRESHOLD = 0.5;

/**
 * Pattern 4: Detect if user externally reverted KAI's writes.
 * Checks all tracked files — if current content hash differs from KAI's write
 * and the file has been substantially changed back, create a revert instinct.
 */
export function detectReverts(paiDir: string): void {
  const ledger = loadLedger(paiDir);
  if (ledger.length === 0) return;

  for (const entry of ledger) {
    if (!existsSync(entry.path)) continue;

    try {
      const currentContent = readFileSync(entry.path, 'utf-8');
      const currentHash = createHash('sha256').update(currentContent).digest('hex').slice(0, 16);

      // If hash matches, file unchanged since PAI wrote it — no revert
      if (currentHash === entry.contentHash) continue;

      // File was modified externally. Check if it's a revert by comparing snippet presence.
      // If KAI's snippet content is no longer in the file, it's likely reverted.
      if (entry.snippet && entry.snippet.length > 20) {
        const snippetNormalized = entry.snippet.trim().substring(0, 60);
        if (!currentContent.includes(snippetNormalized)) {
          const fileName = basename(entry.path);
          const instinctText = `Reverted: ${entry.snippet.substring(0, 80)} in ${fileName}`;
          // Full revert gets higher initial confidence
          createInstinct(
            paiDir,
            instinctText,
            'revert',
            `PAI wrote to ${entry.path}, user reverted. Snippet: ${entry.snippet}`,
            process.cwd()
          );
          console.error(`[InstinctCapture] Pattern 4 → revert detected in ${fileName}`);
        }
      }
    } catch {
      // Skip unreadable files
    }
  }
}

async function main() {
  const input = await readHookInput();
  if (!input) process.exit(0);

  const prompt = (input.prompt || '').trim();
  if (!prompt || prompt.length < 5) process.exit(0);

  const paiDir = getPaiDir();

  // Diagnostic: log what we receive (temporary — remove once instincts are confirmed working)
  const hasTranscript = !!(input as any).transcript_path;
  const correctionMatch = CORRECTION_PATTERN.test(prompt);
  console.error(`[InstinctCapture] prompt="${prompt.substring(0, 40)}" transcript=${hasTranscript} correction=${correctionMatch}`);

  // Pattern 3: low rating (≤3) → instinct from session context
  const ratingMatch = prompt.match(/^([1-3])$/);
  if (ratingMatch) {
    try {
      const settings = existsSync(join(paiDir, 'config', 'settings.json'))
        ? JSON.parse(readFileSync(join(paiDir, 'config', 'settings.json'), 'utf-8'))
        : {};
      if (settings.instincts?.enabled !== false && settings.instincts?.captureCorrections !== false) {
        const rating = parseInt(ratingMatch[1]);
        const { messages } = extractTranscriptContext(input.transcript_path);
        const lastAssistant = messages.filter(m => m.role === 'assistant').slice(-1)[0];
        const context = lastAssistant?.text?.substring(0, 200) || 'low-rated response';
        const instinct = createInstinct(
          paiDir,
          `Low rating (${rating}/10) — review recent response for improvement`,
          'rating',
          `Rating: ${rating}/10. Last response: ${context}`,
          process.env.CLAUDE_PROJECT_DIR || process.cwd()
        );
        console.error(`[InstinctCapture] Pattern 3 → rating ${rating}/10, instinct: ${instinct.id}`);
      }
    } catch (err) {
      console.error(`[InstinctCapture] Pattern 3 error (non-fatal): ${err}`);
    }
    process.exit(0);
  }

  // Check feature flag
  try {
    const settingsPath = join(paiDir, 'config', 'settings.json');
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      if (settings.instincts?.enabled === false || settings.instincts?.captureCorrections === false) {
        console.error('[InstinctCapture] Disabled by feature flag');
        process.exit(0);
      }
    }
  } catch { /* proceed if settings unreadable */ }

  // Pattern 4: file revert detection (runs before prompt analysis)
  try {
    detectReverts(paiDir);
  } catch (err) {
    console.error(`[InstinctCapture] Pattern 4 error (non-fatal): ${err}`);
  }

  const { messages, priorUserMessages } = extractTranscriptContext(input.transcript_path);

  // Pattern 1: explicit imperative + prior tool call
  if (detectPattern1(prompt, messages)) {
    const instinct = createInstinct(
      paiDir,
      `Avoid behavior that triggered: "${prompt.substring(0, 80)}"`,
      'correction',
      `User said: "${prompt.substring(0, 200)}"`,
      process.env.CLAUDE_PROJECT_DIR || process.cwd()
    );
    console.error(`[InstinctCapture] Pattern 1 → instinct created: ${instinct.id} (${instinct.confidence})`);
  }

  // Pattern 2: repeated instruction
  const repeatedMatch = detectPattern2(prompt, priorUserMessages);
  if (repeatedMatch && !CORRECTION_PATTERN.test(prompt)) {
    const instinct = createInstinct(
      paiDir,
      `Repeated instruction: "${prompt.substring(0, 80)}"`,
      'repetition',
      `User repeated: "${prompt.substring(0, 200)}"`,
      process.env.CLAUDE_PROJECT_DIR || process.cwd()
    );
    console.error(`[InstinctCapture] Pattern 2 → instinct created: ${instinct.id}`);
  }

  process.exit(0);
}

if (import.meta.main) main();
