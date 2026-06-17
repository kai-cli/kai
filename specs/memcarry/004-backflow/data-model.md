# Phase 1 Data Model — Backflow

Additive only. No atom type added; one field added to `LessonAtom`. Existing atoms remain valid
(new field defaults null).

## Schema change: LessonAtom += `last_refined`
| Field | Type | Notes |
|---|---|---|
| `last_refined` | `string \| null` (ISO-8601) | NEW (FR9). Set when a refine is confirmed. Default `null`. Usage signal for the future value loop; does NOT affect recall scoring. |

Zod: `last_refined: z.string().nullable().default(null)` — same shape as the existing `last_used`, so
old atoms parse unchanged.

## The refine operation (pure, in `refine.ts`)
`refineLesson(atom: LessonAtom, change: RefineChange, nowIso: string): LessonAtom`

**RefineChange:**
| Field | Type | Notes |
|---|---|---|
| `do` | `string?` | optional new action (replaces `claim.do`) |
| `becauseAppend` | `string` | dated evidence appended to `claim.because` — NEVER replaces (history accumulates, FR4) |

**Returns** a new atom with:
- `claim.do` ← `change.do` if provided, else unchanged
- `claim.because` ← `${old.because}; ${change.becauseAppend} (${date})` (append, not replace)
- `provenance` ← `human-confirmed` (only reached after confirm — the anti-loop gate, FR3)
- `updated` ← nowIso; `last_refined` ← nowIso (FR9)
- `id`, `scope`, `trigger`, `type` ← unchanged (same id ⇒ `writeAtom` overwrites same path ⇒ backflow)

Pure function: no I/O, no clock (nowIso passed in) → fully unit-testable without the model or filesystem.

## Targeting (FR5)
| Path | How the atom is resolved |
|---|---|
| Primary (recalled) | atom `id` from the `<memcarry-recall>` block already in context — exact, zero search |
| Fallback (not recalled) | topic fuzzy-match over global lessons → resolve to ONE atom → show which, confirm before edit |

## Invariants
- Only `type: lesson`, `scope: global` atoms are refine targets (backflow = cross-project; project atoms
  don't need it). Refining a project/resume-state atom → rejected with clear error.
- `because` length must still fit `CLAIM_DISPLAY_CAP` after append (assert; if over, the append summarizes).
- A refine that sets no `do` and empty `becauseAppend` is a no-op → rejected (nothing to refine).
