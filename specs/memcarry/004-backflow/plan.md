# Implementation Plan: Backflow — refine a global lesson

**Branch**: `004-backflow` (SpecKit workspace doc; no git branch) | **Date**: 2026-06-15
**Spec**: `specs/memcarry/004-backflow/spec.md`

> **Target codebase:** `~/Projects/pai-config/memcarry` (canonical, vendored). NOT this SpecKit clone.

## Summary
Build the backflow workflow: refine a global lesson atom from any project so the improvement propagates
everywhere (B→A). Confirm-each automation, recall-anchored, one-word inline confirm, human-confirm as the
anti-circular-loop gate. The mechanical write already exists (`writeAtom` overwrites by id); the work is a
**refine flow** that mirrors the existing `confirm` pattern: a pure lib function + a CLI command + a
hook/End-skill surface. **No MCP** — that server is an unregistered stub Claude can't call; backflow uses
the proven CLI+hooks path (like recall/resume/drift).

## Technical Context (grounded in the real code, 2026-06-15)
- **Lang/runtime:** TypeScript / Bun, `@memcarry/lib` + CLI + MCP monorepo. No build step.
- **Write primitive — ALREADY EXISTS:** `store.ts writeAtom()` path = `atoms/<scope>/<type>/<id>.md`,
  atomic temp+rename. **Same id ⇒ same path ⇒ overwrite.** Backflow's core write is free.
- **Pattern to mirror — ALREADY EXISTS:** CLI `confirm()` does read-atom → spread-mutate → `writeAtom`,
  setting `provenance: human-confirmed` + `updated`. `refine` is the same shape with different fields.
- **Schema:** `LessonAtom` has `claim{when,do,because}`, `last_used`, `use_count`. **`last_refined` is a
  new additive field** (FR9).
- **Gap 1:** no `readAtomById` helper — only `readAllAtoms` + filter, or `readAtom(path)`. Add a small helper.
- **MCP — DROPPED from scope (2026-06-15):** the MemCarry MCP server is an unregistered 44-line stub —
  Claude CANNOT call it in live sessions (verified: not in `.mcp.json`/`settings.json`). Backflow does NOT
  use it. Trigger A is hook+CLI (the proven live path). If the MCP server is ever registered, a refine
  tool can be added then — not a dependency here.

### Validation log (2026-06-15 — claims checked against LIVE code/data, not assumed)
- ✅ **writeAtom overwrites by id** — proven empirically (wrote same id twice → 1 atom, path stable, `do` updated).
- ✅ **6 live atoms re-parse clean**; `last_refined` (default null, mirrors `last_used`) is safe-additive — old atoms lack it, default applies, no break.
- ⚠️ **MCP path is UNPLUGGED** — server runs in tests but is NOT registered with Claude; can't be called mid-turn. → backflow goes hook+CLI, MCP dropped from scope.
- ✅ **Gap-1 real** — CLI has `findResume()` but NO global-lesson-by-id reader; `refine` needs a small `findLessonById` (mirrors findResume). Confirmed.

## Constitution Check (`.specify/memory/constitution.md` v1.0.0)
| Principle | Compliance |
|-----------|-----------|
| I. Verification before assertion | ✅ acceptance = runnable scenarios (backflow proven by recall-in-other-project showing the update) |
| II. Inconclusive ≠ confirmation | ✅ bad id / not-found → clear error, no partial write (atomic) |
| III. First principles / surgical | ✅ mirrors existing `confirm`; reuses `writeAtom`; adds one helper + one field — no rearchitecting |
| IV. Prove new before retiring old | ✅ additive; existing atoms/commands untouched; `last_refined` optional |
| V. Provenance & earned authority | ✅ refine sets `human-confirmed` ONLY via confirm; model-drafted cannot write without it — the anti-loop gate |
| VI. No false precision / defer | ✅ outcome-gated auto + auto-detection explicitly deferred; confidence-auto forbidden |

**Result: PASS.** Note: Principle V is the spec's central guarantee — the plan must keep the confirm step
non-bypassable. Complexity Tracking empty.

## Project Structure (in `~/Projects/pai-config/memcarry`)
```
packages/lib/src/
├── schema.ts        # MODIFY: add `last_refined: z.string().nullable().default(null)` to LessonAtom (FR9)
├── store.ts         # MODIFY: add readAtomById(storeRoot, id) helper (Gap 1)
├── refine.ts        # NEW: pure refineLesson(atom, {do?, becauseAppend}) → updated atom (testable unit)
└── (recall/capture/verify/probes/project — unchanged)

packages/cli/src/index.ts   # MODIFY: add `refine` command, mirrors `confirm` (read→draft→confirm→write)
# packages/mcp — NOT TOUCHED. MCP dropped from scope (unregistered stub; Claude can't call it).

(host adapter — pai-config)
~/.claude/hooks/  → End-skill step (FR8 safety net): flag global atoms recalled-but-not-refined this session
                    (inline <memcarry-refine> diff via additionalContext — FR10). Trigger A applies via
                    the `memcarry refine` CLI on user confirm — the proven hook+CLI path.
```

**Structure Decision:** Core logic = a pure `refineLesson()` in lib (testable, no I/O), wrapped by the CLI
`refine` command (mirrors `confirm`). The End-skill + the model's mid-turn proposal are thin surfaces that
both apply via that CLI — NO MCP. Ship in dependency order so each layer is independently verifiable.

## Build order (dependency-layered)
1. **Lib core (testable, no model):** `schema.ts` +`last_refined`; `store.ts` +`readAtomById`;
   `refine.ts` pure `refineLesson()` (append-dated-because, set provenance human-confirmed, stamp
   last_refined). Unit tests here — hermetic, no embedder.
2. **CLI `refine`:** mirror `confirm` — show draft+diff (no `--apply`), then `--apply`/`--confirm` writes.
3. **Inline diff surfacing (FR10):** model proposes mid-turn → `<memcarry-refine>` additionalContext → on
   user confirm, applies via the `memcarry refine` CLI (the proven hook+CLI path — NO MCP).
4. **Host End-skill safety net (FR8):** flag recalled-but-unrefined global atoms at session end.

MVP = steps 1-2 (lib + CLI) — backflow is *operable* (you can refine via CLI). Steps 3-4 make it *ergonomic*
(mid-turn proposal + safety net). Each step independently shippable + green. (MCP tool dropped — would
require registering the server with Claude, which isn't done; not a dependency.)

## Complexity Tracking
> No violations — empty.

## Phase status
- [x] Phase 0 research (decisions resolved in spec Clarifications + grounded code findings here)
- [x] Phase 1 design (data-model + contracts + quickstart — below)
- [ ] Phase 2 tasks — `/speckit-tasks`
