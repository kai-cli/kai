/**
 * Recall — keyword/trigger matching over lesson atoms (ARCHITECTURE.md §1 physics, §11 #10,#12,#13).
 *
 * MVP recall is keyword-based (the embedding layer is reused from the live hook later). Key rules:
 *  - PRECONDITION-MATCH GATES injection: a lesson whose `when` clearly doesn't apply is NOT injected
 *    and does NOT count against the top-K budget (§11 #12). MVP heuristic: trigger-token overlap.
 *  - Recall reads atoms DIRECTLY from disk so it survives the MCP server being down (§11 #2).
 *  - Returns the recall-safe rendered claim (DISPLAY surface), never the DETAIL body.
 *  - Cross-project: global-scope lessons are eligible everywhere (the transfer win).
 */
import { renderClaim, type Atom, type LessonAtom } from "./schema.js";

export interface RecallHit {
  id: string;
  scope: string;
  claim: string; // rendered WHEN→DO→BECAUSE
  score: number;
  expand_when?: string;
}

const STOP = new Set([
  "the", "a", "an", "to", "of", "and", "or", "in", "on", "for", "is", "it", "this", "that",
  "with", "fix", "run", "get", "set", "do", "how", "i", "we", "my", "me", "you",
]);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9._-]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w));
}

/**
 * Score a lesson against prompt tokens. Trigger overlap is the MATCH surface; the `when`
 * precondition is the GATE. Returns null if the precondition clearly doesn't apply.
 */
function scoreLesson(lesson: LessonAtom, promptTokens: Set<string>): number | null {
  const triggerTokens = lesson.trigger.flatMap((t) => tokenize(t));
  const triggerHits = triggerTokens.filter((t) => promptTokens.has(t)).length;
  const whenTokens = tokenize(lesson.claim.when);
  const whenHits = whenTokens.filter((t) => promptTokens.has(t)).length;

  // Precondition gate: if the lesson has triggers but NONE match and the `when` doesn't match
  // either, it doesn't apply here — don't inject, don't consume budget.
  if (lesson.trigger.length > 0 && triggerHits === 0 && whenHits === 0) return null;

  // weight trigger hits higher than incidental when-overlap
  const score = triggerHits * 2 + whenHits;
  return score > 0 ? score : null;
}

/**
 * Recall top-K lesson HEADs for a prompt, from a given project scope + global.
 * `project` is the active project name; global lessons are always eligible (cross-project transfer).
 */
export function recall(
  atoms: Atom[],
  prompt: string,
  project: string | null,
  k = 5
): RecallHit[] {
  const tokens = new Set(tokenize(prompt));
  const hits: RecallHit[] = [];

  for (const a of atoms) {
    if (a.type !== "lesson") continue;
    const eligible = a.scope === "global" || (project && a.scope === `project:${project}`);
    if (!eligible) continue;
    const score = scoreLesson(a, tokens);
    if (score === null) continue;
    hits.push({
      id: a.id,
      scope: a.scope,
      claim: renderClaim(a.claim),
      score,
      expand_when: a.expand_when,
    });
  }

  return hits.sort((x, y) => y.score - x.score).slice(0, k);
}
