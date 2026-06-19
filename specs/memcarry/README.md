# Memcarry — Design Record (specs)

Version-controlled design history for the **memcarry** memory/retrieval system. Lives here in
kai (private; excluded from the public kai sync per `scripts/sync-to-kai.sh` line ~109) so the
spec sits beside the implementation (`../../memcarry/` + `../../hooks/Mem*.hook.ts`).

> Authored in the SpecKit design studio (`~/Projects/SpecKit`, a clone of the PUBLIC github/spec-kit)
> then moved here — committing private design docs into the public spec-kit clone was the wrong home.

## Contents
- **`005-capture/`** — capture: turn a session learning into a `lesson` atom (the forward half of the
  cross-project cycle; feeds the store backflow keeps current). `spec.md` = Approved (clarifications
  resolved 2026-06-16); SHIPPED 2026-06-16 (`capture-lesson` CLI + lib core + steering rule + End net).
  The named root unblock from `NEXT-STEPS.md §0`: store was starved because nothing turned "I learned X"
  → a lesson.
- **`004-backflow/`** — backflow: refine a global `lesson` atom from any project (B→A). `spec.md`,
  `plan.md`, `data-model.md`, `quickstart.md`, `contracts/`. SHIPPED (MVP steps 1-4); FR10 relaxed 2026-06-16.
- **`003-memcarry-retrieval/`** — the retrieval sprint (B2 hybrid recall, A2 ambient recall, B1 PRD
  resume, H2 compaction recovery). `PROGRAM.md` = full program scope + locked decisions; `spec.md`,
  `plan.md`, `tasks.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`.
- **`002-claude-harness-superseded/`** — the original "Sentinel" brief, an independent re-derivation of
  the already-built Ferrymem/Memcarry design. Retained as history; **do not build from it.**
- **`.governance/constitution.md`** — the universal spec principles used during this work.

## Implementation status (as of 2026-06-12)
All four sprint items shipped + committed in kai (full suite 1828 green):
- B2 hybrid RRF recall — `recall.ts` + host jina `ScoreProvider`/cache
- A2 every-prompt recall — `hooks/MemRecall.hook.ts`
- B1 PRD-aware resume — already in `hooks/MemResume.hook.ts`
- H2 compaction recovery — `hooks/PostCompactRecovery.hook.ts` (+ shared `recallLessons` helper)
- T017 cross-system dedup — deferred (decision C+; see `tasks.md`).

Canonical build target + topology notes: see the NewTool project memory
(`reference_canonical_build_target.md`).
