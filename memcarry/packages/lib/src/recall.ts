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
  score: number; // fused RRF score (used for sort); higher = more relevant
  keywordRank: number | null; // 1-based rank in the keyword ranking (always set for gated-in lessons)
  semanticRank: number | null; // 1-based rank in the semantic ranking; null if no/!provider score
  expand_when?: string;
}

/** RRF constant — standard k=60; parameter-free fusion, robust at tiny store sizes (B2). */
const RRF_K = 60;

/**
 * W6 provider seam ("integrated core, portable engine"): the engine stays PAI-free, but a host can
 * INJECT a semantic relevance scorer. Given a lesson and the prompt, return a raw similarity (higher =
 * more relevant — e.g. cosine 0..1), or null to abstain (that lesson then has no semantic rank). PAI's
 * adapter backs this with jina embeddings; KAI/others pass nothing → pure keyword ranking.
 *
 * B2 fusion: the provider stays PER-LESSON and returns a raw score, NOT a rank — it cannot see the whole
 * candidate set. `recall()` collects all provider scores, derives the semantic RANKING, and fuses it with
 * the keyword ranking via RRF. The provider's absolute scale is irrelevant; only the induced order is
 * used, so an exact-identifier keyword hit is never drowned by a high cosine. Pure injection — the engine
 * never imports the provider's implementation.
 */
export type ScoreProvider = (lesson: LessonAtom, prompt: string) => number | null;

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
  k = 5,
  scoreProvider?: ScoreProvider
): RecallHit[] {
  const tokens = new Set(tokenize(prompt));

  // Pass 1: GATE + per-lesson scores. The keyword score also acts as the precondition gate
  // (null = doesn't apply here → excluded, never consumes budget, §11 #12). The provider is only
  // consulted for gated-in lessons, so it can never resurrect a gated-out one.
  interface Cand {
    atom: LessonAtom;
    keywordScore: number; // > 0 for all candidates
    semanticScore: number | null; // raw provider similarity, or null (abstain / no provider)
  }
  const cands: Cand[] = [];
  for (const a of atoms) {
    if (a.type !== "lesson") continue;
    const eligible = a.scope === "global" || (project && a.scope === `project:${project}`);
    if (!eligible) continue;
    const keywordScore = scoreLesson(a, tokens);
    if (keywordScore === null) continue; // gated out
    const semanticScore = scoreProvider ? scoreProvider(a, prompt) : null;
    cands.push({ atom: a, keywordScore, semanticScore });
  }

  // Pass 2: derive the two RANKINGS, then fuse via RRF (B2). Rank = 1-based position after sorting
  // by the respective score desc. A lesson absent from a ranking contributes 0 to that RRF term.
  const keywordRankOf = rankMap(cands, (c) => c.keywordScore);
  const semanticCands = cands.filter((c) => c.semanticScore !== null);
  const semanticRankOf = rankMap(semanticCands, (c) => c.semanticScore as number);

  const hits: RecallHit[] = cands.map((c) => {
    const kRank = keywordRankOf.get(c.atom.id) ?? null;
    const sRank = semanticRankOf.get(c.atom.id) ?? null;
    const score =
      (kRank !== null ? 1 / (RRF_K + kRank) : 0) + (sRank !== null ? 1 / (RRF_K + sRank) : 0);
    return {
      id: c.atom.id,
      scope: c.atom.scope,
      claim: renderClaim(c.atom.claim),
      score,
      keywordRank: kRank,
      semanticRank: sRank,
      expand_when: c.atom.expand_when,
    };
  });

  // Sort by fused score desc; stable tiebreak by id so output is deterministic.
  return hits
    .sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
    .slice(0, k);
}

/**
 * Build id→rank (1-based) by sorting candidates by `scoreOf` desc. Deterministic tiebreak by atom id so
 * equal scores get stable ranks (matters for RRF reproducibility at tiny store sizes).
 */
function rankMap<T extends { atom: LessonAtom }>(
  items: T[],
  scoreOf: (c: T) => number
): Map<string, number> {
  const sorted = [...items].sort((a, b) => {
    const d = scoreOf(b) - scoreOf(a);
    return d !== 0 ? d : a.atom.id < b.atom.id ? -1 : a.atom.id > b.atom.id ? 1 : 0;
  });
  const m = new Map<string, number>();
  sorted.forEach((c, i) => m.set(c.atom.id, i + 1));
  return m;
}
