# Quickstart — Validating Backflow

Proves the B→A cycle: refine a global lesson in one project, see the update everywhere.
Run from `~/Projects/pai-config/memcarry`. See `contracts/refine.md` + `data-model.md` for detail.

## Prerequisites
```bash
cd ~/Projects/pai-config/memcarry && bun install
export MEMCARRY_STORE="$HOME/.claude/MEMORY/memcarry/store"
bun test    # baseline green before changes
```

## Scenario 1 — Backflow proven (the whole point)
1. Pick a global lesson (e.g. `lsn_never_hand_edit_patches`). Note its current claim.
2. Refine it: `memcarry refine lsn_never_hand_edit_patches --do "ok to hand-edit IF you regen the hash" --because "confirmed in Du-tracking" --apply`
3. **Expect:** the atom file now shows the new `do`, the `because` contains BOTH the original AND the new
   dated evidence, `provenance: human-confirmed`, `last_refined` set.
4. `memcarry recall "editing a patch" --project some-OTHER-project` → **Expect** the UPDATED claim surfaces.
   (Backflow: refined once, true everywhere.)

## Scenario 2 — History accumulates, never overwrites (FR4)
1. Refine the same atom twice with different `--because`.
2. **Expect:** `because` contains all three (original + both refinements), each dated. No evidence lost.

## Scenario 3 — Confirm gate holds (anti-loop, FR3)
1. `memcarry refine <id>` with NO `--apply` → **Expect:** prints the diff, writes NOTHING.
2. Grep the code path: no branch writes a refine without `--apply` / explicit confirm. The model cannot
   self-approve (the model only runs `--apply` after the user confirms in conversation, per C2).

## Scenario 4 — Guards (FR6)
- `memcarry refine bogus_id --apply` → clear error, exit non-zero, no file written.
- `memcarry refine <a-project-scoped-atom> --apply` → rejected (backflow is global-only).
- `memcarry refine <id> --apply` with no `--do` and no `--because` → rejected (nothing to refine).

## Scenario 5 — last_refined stamped (FR9)
After an applied refine, the atom's `last_refined` is a fresh ISO timestamp; `updated` matches.

## Scenario 6 — pure refineLesson unit (no I/O, no model)
`refineLesson(atom, {do, becauseAppend}, nowIso)` returns the updated atom with append-not-replace
`because`, `provenance: human-confirmed`, `last_refined: nowIso` — tested directly, hermetic.

## Regression gate
```bash
bun test   # all existing + new green; confirm/recall/resume/capture unchanged; old atoms still parse
```

## Definition of Done (MVP = lib + CLI, steps 1-2 of plan)
Scenarios 1-6 pass via the CLI. Inline diff (C4) + End-skill (C3) follow as steps 3-4. No MCP.
