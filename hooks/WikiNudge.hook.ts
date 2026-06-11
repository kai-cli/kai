#!/usr/bin/env bun
/**
 * WikiNudge.hook.ts — surface a pending wiki-currency nudge on the next user prompt.
 *
 * TRIGGER: UserPromptSubmit
 *
 * PURPOSE: WikiCurrency.ts (Stop handler) writes MEMORY/STATE/pending-wiki-nudge.json when a
 * session made substantive code changes in a wiki-bearing project WITHOUT touching its wiki.
 * A Stop hook can't inject into the turn that just ended, so this hook surfaces the flag as
 * additionalContext on the NEXT turn — a soft nudge to update the wiki inline, never a gate.
 * Same two-part pattern as LastResponseCache (Stop) → FormatReminder (UserPromptSubmit).
 *
 * PERFORMANCE: <5ms — reads one small JSON flag, clears it after surfacing (fires once).
 */
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { paiPath } from './lib/paths';
import { readHookInput } from './lib/hook-io';

const NUDGE_PATH = paiPath('MEMORY', 'STATE', 'pending-wiki-nudge.json');

interface NudgeEntry { name: string; codeLines: number; sampleFiles: string[]; }
interface NudgeFlag { pending: NudgeEntry[]; sessionId?: string; }

async function main() {
  const input = await readHookInput();
  if (!input) process.exit(0);

  if (!existsSync(NUDGE_PATH)) process.exit(0);

  let flag: NudgeFlag;
  try {
    flag = JSON.parse(readFileSync(NUDGE_PATH, 'utf-8')) as NudgeFlag;
  } catch {
    process.exit(0); // unreadable/corrupt — skip silently
  }

  if (!flag.pending || flag.pending.length === 0) process.exit(0);

  // Clear the flag immediately so the nudge fires exactly once (not every subsequent prompt).
  try { writeFileSync(NUDGE_PATH, JSON.stringify({ pending: [], sessionId: flag.sessionId }, null, 2)); } catch { /* non-fatal */ }

  const lines = flag.pending.map(p =>
    `  • ${p.name}: ~${p.codeLines} lines of code changed, wiki untouched (e.g. ${p.sampleFiles.slice(0, 3).join(', ')})`
  ).join('\n');

  console.log(JSON.stringify({
    additionalContext: `<wiki_currency_nudge>\nLast turn made substantive code changes in a wiki-bearing project but did NOT update its wiki:\n${lines}\n\nKeep the wiki current INLINE (not deferred): if these changes affect documented behavior/architecture, update the corresponding wiki page in THIS turn, or briefly state why no wiki change is warranted. [[feedback_keep_wiki_current_inline]]\n</wiki_currency_nudge>`
  }));
  console.error(`[WikiNudge] Surfaced wiki-currency nudge for: ${flag.pending.map(p => p.name).join(', ')}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[WikiNudge] Error:', err);
  process.exit(0);
});
