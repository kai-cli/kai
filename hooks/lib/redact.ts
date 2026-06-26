// redact.ts — mask credential-shaped substrings before they enter model context.
//
// Reuses the canonical SECRET_PATTERNS (same source SecretScanner uses) so detection
// stays single-sourced. Used by knowledge-readback to scrub auto-injected KNOWLEDGE
// bodies (PAI-SR-073): a domain file that happens to contain a credential must not be
// injected verbatim. Redaction is in-memory only — it never modifies the source file.

import { SECRET_PATTERNS } from './secret-patterns';

/**
 * Replace every SECRET_PATTERNS match in `text` with a `[REDACTED:<name>]` marker.
 * Non-matching text is returned unchanged. Safe to call on arbitrary markdown.
 */
export function redactSecrets(text: string): string {
  if (!text) return text;
  let out = text;
  for (const { name, pattern } of SECRET_PATTERNS) {
    // SECRET_PATTERNS are authored without the global flag; add it locally so
    // replace() masks every occurrence rather than only the first.
    const g = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
    out = out.replace(g, `[REDACTED:${name}]`);
  }
  return out;
}

/**
 * True if `text` contains at least one credential-shaped match.
 */
export function containsSecret(text: string): boolean {
  return SECRET_PATTERNS.some(({ pattern }) => pattern.test(text));
}
