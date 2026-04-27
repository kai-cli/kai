/**
 * rating-parser.ts — Rating parsing utilities for RatingCapture
 *
 * Extracted from RatingCapture.hook.ts for standalone testability.
 * No identity or settings dependencies — pure logic + file reads.
 */

import { existsSync, readFileSync } from 'fs';

// ── Explicit Rating Detection ──

/**
 * Parse explicit rating pattern from prompt.
 * Matches: "7", "8 - great work", "6: needs work", "9 excellent", "10!"
 * Rejects: "3 items", "5 things to fix", "7th thing", "10/10", "3.5"
 */
export function parseExplicitRating(prompt: string): { rating: number; comment?: string } | null {
  const trimmed = prompt.trim();
  // Rating must be: number alone, or number followed by whitespace/dash/colon then comment
  // Reject: "10/10", "3.5", "7th", "5x" — number followed by non-separator chars
  const ratingPattern = /^(10|[1-9])(?:\s*[-:]\s*|\s+)?(.*)$/;
  const match = trimmed.match(ratingPattern);
  if (!match) return null;

  const rating = parseInt(match[1], 10);
  const rest = match[2]?.trim() || undefined;

  if (rating < 1 || rating > 10) return null;

  // Reject if the character immediately after the number is not a separator
  // This catches "10/10", "3.5", "7th", "5x", etc.
  const afterNumber = trimmed.slice(match[1].length);
  if (afterNumber.length > 0 && /^[/.\dA-Za-z]/.test(afterNumber)) return null;

  // Reject if comment starts with words indicating a sentence, not a rating
  if (rest) {
    const sentenceStarters = /^(items?|things?|steps?|files?|lines?|bugs?|issues?|errors?|times?|minutes?|hours?|days?|seconds?|percent|%|th\b|st\b|nd\b|rd\b|of\b|in\b|at\b|to\b|the\b|a\b|an\b)/i;
    if (sentenceStarters.test(rest)) return null;
  }

  return { rating, comment: rest };
}

// ── Correction Detection ──

export const CORRECTION_PATTERNS = [
  /\bno[,.]?\s+(i\s+meant|that'?s?\s+not|don'?t|wait)/i,
  /\bthat'?s?\s+not\s+(what\s+i|right|correct|it)/i,
  /\bi\s+(said|meant|asked\s+for)\s+.{5,50},?\s+not\b/i,
  /\bwrong\b.*\b(direction|approach|file|thing)\b/i,
  /\bstop\b.{0,20}\b(doing|adding|removing|changing)\b/i,
];

/**
 * Scan transcript JSONL for user correction signals (mid-task direction changes).
 * Returns up to 3 matching correction excerpts (first 120 chars each).
 * Returns [] if transcript is missing or unreadable.
 */
export function detectCorrections(transcriptPath: string): string[] {
  try {
    if (!transcriptPath || !existsSync(transcriptPath)) return [];
    const content = readFileSync(transcriptPath, 'utf-8');
    const lines = content.trim().split('\n');
    const corrections: string[] = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type !== 'user') continue;
        const text = typeof entry.message?.content === 'string'
          ? entry.message.content
          : Array.isArray(entry.message?.content)
            ? entry.message.content
                .filter((c: { type: string }) => c.type === 'text')
                .map((c: { text: string }) => c.text)
                .join(' ')
            : '';
        for (const pattern of CORRECTION_PATTERNS) {
          if (pattern.test(text)) {
            corrections.push(text.slice(0, 120));
            break;
          }
        }
      } catch { /* skip malformed lines */ }
    }
    return corrections.slice(0, 3);
  } catch { return []; }
}
