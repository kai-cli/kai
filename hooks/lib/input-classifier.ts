/**
 * input-classifier.ts — Probabilistic input classification
 *
 * Determines whether user input is a shell command, AI query, or PAI skill invocation.
 * Used by ModeClassifier.hook.ts as the first classification stage.
 *
 * Classification layers:
 *   1. Deterministic: /skill prefix → p_skill=1.0, !cmd prefix → p_shell=1.0
 *   2. Heuristic scoring: known binary, metachar density, alpha-word ratio, question words
 *   3. Threshold: p_shell > 0.85 → shell, else → ai (safe default for ambiguous)
 *
 * Single-word known binaries (e.g. "docker") remain ambiguous → ai.
 * User can always force shell with "!" prefix.
 */

import { isKnownCommand } from './command-database';

export interface ClassificationResult {
  p_shell: number;
  p_ai: number;
  p_skill: number;
  classification: 'shell' | 'ai' | 'skill' | 'ambiguous';
}

// Question-word and natural-language request patterns
const QUESTION_WORDS_RE = /\b(what|how|why|when|where|who|which|can you|could you|would you|please|explain|describe|tell me|show me|help me|is there|are there)\b/i;

// Shell metacharacters — each one adds p_shell
const SHELL_META_RE = /[|>&;<$]/g;

// Common English words that ALSO happen to be PATH binaries. When one of these starts
// an unprefixed multi-word input it is almost always natural language ("test the theory",
// "write a report", "make it faster"), not a shell invocation — so it must NOT receive the
// multi-word shell boost. The explicit `!` prefix is the way to force shell for these.
// (PAI-SR-040: bare `test`/`write` + a word was scoring p_shell=0.95 and auto-executing.)
const COMMON_WORD_BINARIES = new Set([
  'test', 'write', 'make', 'find', 'sort', 'time', 'help', 'read', 'type', 'file',
  'look', 'wait', 'date', 'kill', 'clear', 'open', 'print', 'run', 'show', 'tell',
  'use', 'build', 'fix', 'add', 'set', 'get', 'put', 'move', 'copy', 'link', 'view',
]);

export function classifyInput(raw: string): ClassificationResult {
  const input = raw.trim();

  // Layer 1: Deterministic — explicit prefixes always win
  if (input.startsWith('/')) {
    return { p_shell: 0, p_ai: 0, p_skill: 1.0, classification: 'skill' };
  }
  if (input.startsWith('!')) {
    return { p_shell: 1.0, p_ai: 0, p_skill: 0, classification: 'shell' };
  }

  // Empty or trivially short input → default to ai
  if (!input || input.length < 2) {
    return { p_shell: 0, p_ai: 1.0, p_skill: 0, classification: 'ai' };
  }

  let p_shell = 0;
  let p_ai = 0;
  const p_skill = 0;

  const words = input.split(/\s+/);
  const firstToken = words[0].toLowerCase();

  // Check question-word pattern early — used to suppress shell scoring
  const hasQuestionPattern = QUESTION_WORDS_RE.test(input);

  // Shell metacharacter density
  const metaMatches = (input.match(SHELL_META_RE) ?? []).length;
  if (metaMatches > 0) {
    p_shell += Math.min(0.2 * metaMatches, 0.4);
  }

  // --- Shell scoring ---

  // First token is a known binary in PATH, but only when there's no strong AI signal.
  // Words like "what", "which", "where" exist in PATH (/usr/bin/what etc.) but are
  // almost always used as natural-language question words, not as shell invocations.
  const firstTokenIsCommand = !hasQuestionPattern && isKnownCommand(firstToken);
  if (firstTokenIsCommand) {
    p_shell += 0.6;
    // Known binary + at least one argument (≥2 words) = strong shell signal — UNLESS the
    // binary is also a common English word (test/write/make/…). Those stay capped at 0.6
    // (< 0.85 threshold → ai) so natural-language sentences aren't auto-executed (PAI-SR-040).
    // A real shell signal (metacharacter) can still push them over the line below.
    if (words.length >= 2 && !COMMON_WORD_BINARIES.has(firstToken)) {
      p_shell += 0.35;
    }
  }

  // --- AI scoring ---

  // Alpha-word ratio: words consisting entirely of letters (typical English words)
  const pureAlphaCount = words.filter(w => /^[a-zA-Z]+$/.test(w)).length;
  const alphaRatio = pureAlphaCount / words.length;
  if (alphaRatio > 0.6) {
    p_ai += 0.4;
  }

  // Question words or natural-language request patterns
  if (hasQuestionPattern) {
    p_ai += 0.3;
  }

  // First token is NOT a known binary AND ≥4 words AND no metacharacters
  // → looks like a natural-language instruction, not a shell command
  if (!firstTokenIsCommand && words.length >= 4 && metaMatches === 0) {
    p_ai += 0.35;
  }

  // Multi-word natural sentence (≥4 words, no shell flags or pipes)
  if (words.length >= 4 && !input.includes('--') && !input.includes('|') &&
      !input.includes('>') && !input.includes('<') &&
      /^[a-zA-Z]/.test(words[0])) {
    p_ai += 0.2;
  }

  // Normalize to [0, 1]
  p_shell = Math.min(p_shell, 1.0);
  p_ai = Math.min(p_ai, 1.0);

  // Layer 3: Threshold decision
  // Only classify as shell when confident — safe default is always 'ai'
  if (p_shell > 0.85) {
    return { p_shell, p_ai, p_skill, classification: 'shell' };
  }

  // Everything else is AI (including ambiguous inputs)
  return { p_shell, p_ai, p_skill, classification: 'ai' };
}
