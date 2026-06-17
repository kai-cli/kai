/**
 * capture-lesson.ts — capture: turn a session learning into a `lesson` atom (spec 005).
 *
 * PURE functions (no I/O, no clock — `nowIso` is passed in) so they're fully unit-testable without the
 * filesystem or the model. The CLI wraps `buildLessonAtom` with a recall-based dup check + the `--apply`
 * human-confirm gate, then `writeAtom`.
 *
 * This is the FORWARD half of the cross-project knowledge cycle (capture); `refine.ts` is the backflow
 * half (B→A). Both honor the same anti-circular-loop guarantee (spec 004/005): a lesson gains
 * `human-confirmed` authority ONLY post-confirm — `buildLessonAtom` stamps it, but is only reached AFTER
 * the CLI `--apply` gate, which the model crosses only on the user's explicit confirm.
 */
import { assertClaimFits, renderClaim, Scope, type Claim, type LessonAtom } from "./schema.js";

export interface LessonDraft {
  when: string;
  do: string;
  because: string;
  /** MATCH-surface keywords; defaults to []. */
  trigger?: string[];
  /** "global" (default) or "project:<name>". */
  scope?: string;
}

/** Thrown when a draft is missing a required claim field (no when / do / because). */
export class EmptyLessonError extends Error {
  constructor(missing: string) {
    super(`lesson draft missing required field(s): ${missing}`);
    this.name = "EmptyLessonError";
  }
}

/** FNV-1a 32-bit — deterministic, dependency-free, pure of input. Used only to disambiguate ids. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0").slice(0, 6);
}

/**
 * Deterministic, collision-resistant lesson id: `lsn_<slug-of-do>_<hash-of-claim>`.
 * Same claim ⇒ same id (idempotent re-capture overwrites rather than duplicates); two different claims
 * that happen to share a `do` slug get different hash suffixes. Matches the existing `lsn_*` style.
 */
export function lessonId(claim: Claim): string {
  const slug = claim.do
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
    .replace(/_+$/g, "");
  const hash = fnv1a(renderClaim(claim));
  return `lsn_${slug || "lesson"}_${hash}`;
}

/**
 * Build a validated `LessonAtom` from a human-authored (optionally transcript-seeded) draft.
 * - Throws EmptyLessonError if when/do/because is missing or blank (FR5: no-op rejected).
 * - provenance ← "human-confirmed" (reached only post-`--apply` — the anti-loop gate, FR3).
 * - scope defaults to "global" (FR1 — the cross-project win); accepts "project:<name>".
 * - id is deterministic (D1); created === updated === nowIso; last_used/use_count/last_refined start empty.
 * - Asserts the rendered claim fits the recall display cap (R3) — fails at build, not at recall.
 * Returns a NEW atom; does not mutate the input draft.
 */
export function buildLessonAtom(draft: LessonDraft, nowIso: string): LessonAtom {
  const when = (draft.when ?? "").trim();
  const action = (draft.do ?? "").trim();
  const because = (draft.because ?? "").trim();
  const missing = [
    !when && "when",
    !action && "do",
    !because && "because",
  ].filter(Boolean).join(", ");
  if (missing) throw new EmptyLessonError(missing);

  const claim: Claim = { when, do: action, because };
  assertClaimFits(claim);

  // Validate scope against the schema regex (user-supplied — fail loud on a malformed scope, never
  // silently coerce). Default "global" is the cross-project win (FR1).
  const scope = Scope.parse(draft.scope?.trim() || "global");
  const trigger = (draft.trigger ?? []).map((t) => t.trim()).filter((t) => t.length > 0);

  return {
    type: "lesson",
    id: lessonId(claim),
    scope,
    provenance: "human-confirmed",
    trigger,
    created: nowIso,
    updated: nowIso,
    claim,
    last_used: null,
    use_count: 0,
    last_refined: null,
  };
}
