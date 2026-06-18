# Spec 004 — Backflow: refine a global lesson from any project

> **Status:** Draft for review · **Owner:** YourName · **Created:** 2026-06-15
> **Why this exists:** the root pain (NEXT-STEPS.md "ROOT PAIN") = bidirectional cross-project knowledge
> cycling. Forward (A→B) works via global-atom recall. **Backflow (B→A) — a lesson improved in project B
> flowing back to project A — has no workflow today.** This spec builds it. It is the true differentiator
> over PAI (whose per-project-copies model is structurally incapable of backflow).

## Clarifications

### Session 2026-06-15
- Q: Backflow trigger surface? → A: **A+B combo, HOOK-DRIVEN** — (A) model proposes a refinement mid-turn in conversation and applies it via the `memcarry refine` CLI on user confirm (NOT MCP — the MCP server is an unregistered stub Claude can't call; CLI+hooks is the proven live path); (B) the End-skill catches recalled-but-unrefined atoms as a safety net.
- Q: How is the refine target (which atom) identified? → A: **Recalled-id primary + topic fallback** — model resolves the atom from the recall context it already has (near-100% accurate, zero user effort); topic fuzzy-match only for atoms not currently recalled, with a confirm of which it resolved to.
- Q: How light should the confirm (anti-loop gate) be? → A: **One-word inline confirm** — model drafts the refined lesson + shows a one-line diff inline; user replies "yes"/edits. Single word, in-flow, still a real human gate.
- Q: Stamp a usage signal on refine? → A: **Yes — `last_refined` timestamp** (free signal for the future value loop).
- Q: Where does the diff show? → A: **Inline `additionalContext`** (same channel as recall/drift; user is already looking there).

## The scenario this enables
> A global atom learned in feed-bbf ("never hand-edit patch files") surfaces in Du-tracking. You discover
> a refinement ("…unless you regenerate the hash after"). **Backflow updates that ONE atom so the
> improvement is true everywhere — including back in feed-bbf.** Today: only possible by hand-editing JSON.

## Non-negotiable: the anti-circular-loop guarantee
The danger of any self-updating memory: the model asserts something → it's saved → recalled later → the
model treats its own past assertion as confirmed → reinforces → bootstraps a hallucination into "high
confidence." **MemCarry's provenance tier is the brake and backflow MUST honor it:**

```
human-confirmed  >  outcome-vindicated  >  model-asserted  >  auto-captured
```

**RULE (hard): a backflow update's authority comes ONLY from human-confirm or a real outcome — NEVER from
model confidence.** The model may DRAFT a refinement; it may never APPROVE one into authority. This makes
the circular loop structurally impossible, not just discouraged.

## Scope — confirm-each (the chosen automation level)
The system does all the WORK; the human does the JUDGMENT (one word). Specifically:
1. Backflow is **recall-anchored**: it targets a global atom recall **already surfaced this session**
   (id-primary — the model resolves it from the `<memcarry-recall>` context it already has, zero user
   effort). For an atom NOT currently recalled, a **topic fuzzy-match fallback** resolves it and shows
   which atom it picked for confirm. (New knowledge with NO matching atom = `capture`, a separate future
   path, NOT backflow.)
2. **Trigger = A+B combo, HOOK-DRIVEN (not MCP):** (A, primary) when the user says in normal conversation
   that a recalled lesson is wrong/incomplete, the model proposes the refinement (inline diff) and, on the
   user's confirm, applies it via the `memcarry refine` CLI (the model runs it, or a hook does) — the same
   proven path recall/resume/drift use. NOT MCP: that server is an unregistered stub Claude can't call.
   (B, safety net) the **End-skill** asks about any global atom recalled-but-not-refined this session.
   Auto-detection of contradiction is DEFERRED (P-series).
3. The model **drafts** the refined atom (updated `do`/`because`, appended dated evidence) and shows a
   **one-line diff inline** (`additionalContext` — same channel as recall/drift). The user gives a
   **one-word confirm** ("yes" / edit / no). On approve → `writeAtom` (same id = update), provenance set
   to `human-confirmed`, `last_refined` stamped.
4. **History accumulates, never overwrites:** `because` gains a dated evidence line
   ("broke build #62 (2026-06-04); refined: ok if hash regenerated (Du-tracking 2026-06-15)"). The lesson's
   value IS its accumulated proof. Lineage preserved.

## Out of scope (deferred, explicitly)
- **Outcome-gated auto-apply** (auto-update when a build/test objectively proves it — still loop-safe
  because reality is the gate). Designed-for, not built; the spec must not preclude it.
- **Auto-detection** of stale/contradicted atoms mid-work (P-series).
- **Confidence-based auto-apply** — NEVER. This is the circular-loop trap; explicitly forbidden.
- **The curated migration** (cross-project PAI lessons → global atoms) — the NEXT spec; feeds this one.
- New-knowledge capture (no matching atom) — separate path.

## Functional requirements
- **FR1:** `memcarry refine <atomId>` (or recall-surfaced selection) loads the atom, accepts a refinement
  (new `do` and/or appended `because`), shows the before/after, and on confirm writes it back by id.
- **FR2:** Update is in-place by id (`writeAtom` overwrites) → every project recalling that global atom sees
  the refinement immediately (backflow achieved).
- **FR3:** Provenance of a refined atom = `human-confirmed` (the human approved). Never auto-elevated.
- **FR4:** `because` is append-with-date, not replace. Prior evidence is retained.
- **FR5:** Refinement is recall-anchored — primary path operates on an atom id recall surfaced. A topic
  fuzzy-match fallback is allowed ONLY for atoms not currently recalled, and MUST show which atom it
  resolved to for confirm before editing (no silent free-text edit of arbitrary atoms).
- **FR6:** Degrades safely — bad id / atom not found / malformed → clear error, no partial write
  (atomic temp+rename already in `store.ts`).
- **FR7 (REVISED 2026-06-15 — hook-driven, NOT MCP):** Trigger A is hook+CLI, the proven live path.
  Rationale: the MemCarry MCP server is an unregistered 44-line stub — Claude CANNOT call it today;
  everything live (recall/resume/drift) runs via CLI + hooks. So backflow mirrors that: the model
  recognizes a refinement in conversation and proposes it (inline diff, FR10); on the user's one-word
  confirm, the change is applied via the `memcarry refine` CLI (a hook or the model's Bash call runs it).
  No MCP server registration needed. (If the MCP server is ever registered for real, a `memcarry_refine`
  tool can be added then — but it is OUT of scope here and not a dependency.)
- **FR8:** Trigger B (safety net) — the End-skill checks for global atoms recalled-but-not-refined this
  session and prompts whether any need refinement. Catches refinements forgotten mid-flow.
- **FR9:** On approved refine, stamp `last_refined` (ISO-8601) on the atom — a usage signal for the future
  value loop. Additive schema field; does not affect recall.
- **FR10 (RELAXED 2026-06-16):** The proposed refinement is shown as a **one-line WAS/NOW diff inline in
  the model's turn** (the `memcarry refine` dry-run output the model relays, plus the steering-rule WAS/NOW
  preview) BEFORE the confirm. **Superseded the original MCP-era assumption** that the diff would ride a
  tagged `<memcarry-refine>` `additionalContext` block with channel-parity to `<memcarry-recall>`/`<memcarry-drift>`:
  `additionalContext` is a HOOK-only output channel, but backflow's Trigger A is **model-driven mid-turn**
  (there is no lifecycle hook event for "the user just established a recalled lesson is stale"), so the
  model cannot emit a real `additionalContext` block for it. A literal `<memcarry-refine>` string wrapper
  around the model's own turn text would be cosmetic only (not the hook channel) — explicitly NOT required.
  This relaxation follows directly from the FR7 revision that dropped MCP; FR10's tag was its orphan.

## Acceptance criteria
- [ ] Refining a global atom in project B, then recalling it in project A, shows the UPDATED claim (backflow proven).
- [ ] The refined atom's `because` contains BOTH the original and the new dated evidence (no history loss).
- [ ] Provenance is `human-confirmed` after refine; a model-drafted refinement cannot write without confirm.
- [ ] Bad atom id → clear error, original atom untouched.
- [ ] No new path auto-applies a refinement on model confidence (grep the code: confirm is required).
- [ ] A refined atom has a `last_refined` timestamp set (FR9).
- [ ] Topic-fallback (atom not currently recalled) shows which atom it resolved to BEFORE editing (FR5).
- [ ] End-skill flags a global atom that was recalled this session but not refined (FR8 safety net).
- [x] The proposed refinement appears as a one-line WAS/NOW diff inline in the model's turn before confirm (FR10, relaxed 2026-06-16 — CLI-relayed diff + steering preview; the `<memcarry-refine>` `additionalContext` tag is NOT required, see FR10).

## Open questions — ALL RESOLVED (2026-06-15, see Clarifications)
1. ~~Trigger surface?~~ → **A+B combo, HOOK-DRIVEN** (model proposes mid-turn + applies via `memcarry refine` CLI on confirm + End-skill safety net). NOT MCP. FR7/FR8.
2. ~~How to point at the atom?~~ → **Recalled-id primary + topic fallback** (confirm which resolved). FR5.
3. ~~Bump a usage signal?~~ → **Yes, `last_refined`**. FR9.
4. ~~Diff presentation?~~ → originally **Inline `additionalContext`** (`<memcarry-refine>`); **RELAXED 2026-06-16** to a one-line WAS/NOW diff inline in the model's turn (CLI-relayed + steering preview) — the tagged `additionalContext` block is hook-only and impossible for a model-triggered flow. See FR10.
5. (added) ~~Confirm weight?~~ → **One-word inline confirm** — the anti-loop gate, kept minimal.

## Build environment
Target: `~/Projects/kai/memcarry` (canonical, vendored). `writeAtom` (overwrite-by-id) + provenance
tiers already exist in `packages/lib/src/{store,schema}.ts`. Tests: hermetic fixtures, injectable embedder
(never load the real model — `reference_bun_transformers_teardown_crash`). Full suite must stay green.
