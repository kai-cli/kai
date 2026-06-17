/**
 * refine.ts — backflow: refine a global lesson atom (spec 004).
 *
 * PURE function (no I/O, no clock — `nowIso` is passed in) so it's fully unit-testable without the
 * filesystem or the model. The CLI/hook wraps this with read → confirm → writeAtom.
 *
 * Backflow = a lesson improved in project B flows back to A: because it's ONE global atom (same id ⇒
 * same path ⇒ writeAtom overwrites), updating it is visible in every project that recalls it.
 *
 * Anti-circular-loop guarantee (spec 004): provenance is set to `human-confirmed` here, but this
 * function is only ever reached AFTER a human confirm in the CLI/hook — the model can DRAFT a
 * RefineChange, never apply one. History accumulates: `because` is APPENDED, never overwritten (FR4).
 */
import { assertClaimFits, type Claim, type LessonAtom } from "./schema.js";

export interface RefineChange {
  /** Optional new action — replaces claim.do when present. */
  do?: string;
  /** Dated evidence appended to claim.because (never replaces). The caller supplies the date or we stamp it. */
  becauseAppend?: string;
}

/** Thrown when a refine has nothing to change (no `do`, no `becauseAppend`). */
export class EmptyRefineError extends Error {
  constructor() {
    super("refine has no change: provide `do` and/or `becauseAppend`");
    this.name = "EmptyRefineError";
  }
}

/** YYYY-MM-DD from an ISO-8601 timestamp (for the dated evidence line). */
function dateOf(nowIso: string): string {
  return nowIso.slice(0, 10);
}

/**
 * Apply a refinement to a global lesson atom. Returns a NEW atom (does not mutate the input).
 * - `claim.do` ← change.do if provided, else unchanged.
 * - `claim.because` ← `${old.because}; ${becauseAppend} (${date})` — APPEND, never replace (FR4).
 * - `provenance` ← "human-confirmed" (reached only post-confirm — the anti-loop gate, FR3).
 * - `updated` + `last_refined` ← nowIso (FR9).
 * Throws EmptyRefineError if neither `do` nor `becauseAppend` is given (FR: no-op rejected).
 * Asserts the rendered claim still fits the display cap after append.
 */
export function refineLesson(atom: LessonAtom, change: RefineChange, nowIso: string): LessonAtom {
  const hasDo = typeof change.do === "string" && change.do.trim().length > 0;
  const hasBecause = typeof change.becauseAppend === "string" && change.becauseAppend.trim().length > 0;
  if (!hasDo && !hasBecause) throw new EmptyRefineError();

  const nextClaim: Claim = {
    when: atom.claim.when,
    do: hasDo ? change.do!.trim() : atom.claim.do,
    because: hasBecause
      ? `${atom.claim.because}; ${change.becauseAppend!.trim()} (${dateOf(nowIso)})`
      : atom.claim.because,
  };
  // Guard the recall display budget BEFORE returning (write-time invariant from schema).
  assertClaimFits(nextClaim);

  return {
    ...atom,
    claim: nextClaim,
    provenance: "human-confirmed",
    updated: nowIso,
    last_refined: nowIso,
  };
}
