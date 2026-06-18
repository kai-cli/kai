# Spec 005 — Capture: turn a session learning into a lesson atom

> **Status:** Shipped (2026-06-16) · **Owner:** YourName · **Created:** 2026-06-16
> **Why this exists:** Backflow (spec 004) made a global lesson *refinable* — but the store is **starved**.
> Measured 2026-06-15: 11 days live, 137 resumes fired, 312 ratings on disk, yet only **6 atoms / 8
> captures**, almost all Phase-0 fixtures. Retrieval is healthy and exercised; it just has almost nothing
> transferable to retrieve. **Root cause (NEXT-STEPS §0): there is NO path from "I learned something" → a
> lesson atom.** Auto-capture writes only *resume-state cursors* (overwritten per project, don't
> accumulate). This is a **missing mechanism, not immaturity.** Spec 005 builds that mechanism.

## Clarifications

### Session 2026-06-16
- Q: What scope does a captured lesson get? → A: **Ask at capture** — `--scope`, **default `global`** for a
  rule confirmed cross-project; `project:<name>` otherwise. One atom everywhere = the backflow win, chosen
  per-lesson. (Not always-global: avoids polluting the global namespace with project-specific rules. Not
  project-first-then-promote: that delays the cross-project win and adds a step.)
- Q: What surface triggers in-conversation capture (Trigger A)? → A: **Steering rule + End-skill net** —
  mirror backflow (004) exactly. AISTEERINGRULES rule fires when YourName establishes a durable lesson; the
  End-skill is the safety net. **No new `/remember` slash command** for the MVP (add only if in-flow
  ergonomics later demand it).
- Q: Does the MVP draft from the transcript or stay human-dictated? → A: **Transcript-assisted in the MVP** —
  reuse `parseTranscript` from `capture.ts` to suggest candidate lessons; the human still authors/confirms
  the final claim. (Chose the more ergonomic path; the human-confirm gate keeps it loop-safe.)
- Q: How deep is dup detection? → A: **Reuse the already-shipped semantic recall as the dup check + an
  exact-id collision guard.** Before write, run `recall` on the draft's claim/triggers; a strong hit →
  "you already have `[lsn_x]` — refine instead?" routes to the 004 `refine` flow (no fragmentation); no
  strong hit → exact-id collision guard, then write new. The ONLY genuinely new code is the id guard —
  the fuzzy check is the recall engine (003) + refine flow (004) already in the tree. Similarity threshold
  is tuned during build (start conservative), not guessed now.

## The gap, grounded in live code (2026-06-16)

- `packages/lib/src/capture.ts` `captureResumeState()` produces **only `resume-state` atoms** — a work
  cursor (next/summary/facts), overwritten each session. It NEVER produces a `lesson`.
- The ONLY way a `lesson` atom enters the store today is `memcarry write <atom.json>` — **raw hand-authored
  JSON**. No drafting, no confirm flow, no ergonomic surface. That's why lessons haven't grown from real work.
- The schema already has everything a lesson needs: `LessonAtom` = `claim{when,do,because}` + `scope` +
  `provenance` + `trigger` + `last_used`/`use_count`/`last_refined`. **No schema change is required for the MVP.**
- The CLI already has the exact pattern to mirror: `confirm`/`refine` = read → draft → show diff →
  `--apply` (the human-confirm gate) → `writeAtom`. Capture is the **create** sibling of that **update** flow.

## The scenario this enables

> Mid-session in Du-tracking you discover: "GitHub issue bodies render `\n` literally — use real newlines."
> That's a durable, cross-project rule. Today it dies in the transcript (or becomes a per-project PAI
> `feedback_*` file that never reaches other projects). **Capture turns it into a lesson atom — confirmed
> by you — so MemRecall surfaces it everywhere it's relevant.** Combined with backflow (004), it can later
> be refined in place. This is the forward half of the cross-project knowledge cycle.

## Non-negotiable: the same anti-circular-loop guarantee as backflow (inherited from spec 004)

```
human-confirmed  >  outcome-vindicated  >  model-asserted  >  auto-captured
```

**RULE (hard): a captured lesson gains `human-confirmed` authority ONLY from an explicit human confirm —
NEVER from model confidence.** The model may DRAFT a lesson; it may never APPROVE one into authority. A
lesson the model drafts without confirm is at most `model-asserted` (and the MVP simply does not write it
without confirm — same `--apply` gate as `refine`). This makes the capture path structurally loop-safe,
identical to backflow's guarantee.

**YourName's guardrail (honored, from NEXT-STEPS §0):** do NOT artificially pump the store. Grow it with
lessons genuinely worth keeping, at human-confirmed trust. Quality over volume. No bulk-import.

## Scope — assisted, human-confirmed capture (the chosen automation level for the MVP)

The system does the WORK (drafts the WHEN→DO→BECAUSE lesson from the session); the human does the JUDGMENT
(confirm). Specifically:
1. **Trigger = A+B combo, mirroring backflow** — (A, primary) a fast in-conversation flow ("/remember"-style)
   when YourName says "remember this" / "that's a lesson" / establishes a durable rule; the model drafts the
   lesson + shows it; on confirm, it writes via the `memcarry capture-lesson` CLI. (B, safety net) the
   **End-skill** asks whether anything learned this session is a durable lesson worth keeping.
2. **The model DRAFTS** a `LessonAtom`, **transcript-assisted**: it reuses `parseTranscript` (the same parser
   `capture.ts` already uses for resume-states) to suggest candidate lessons from the session, then fills
   `claim.when` (precondition that gates recall), `claim.do` (the rule), `claim.because` (consequence + dated
   evidence), plus `trigger` keywords. The human still authors/confirms the final claim. Shows it as a preview.
3. **Scope chosen at capture** — `--scope`, **default `global`** for a rule confirmed cross-project,
   `project:<name>` otherwise.
4. **Dup check before write (reuses shipped recall):** run `recall` on the draft's claim/triggers. A strong
   hit → surface it ("you already have `[lsn_x]` — refine instead?") and route to the 004 `refine` flow
   (prevents fragmentation). No strong hit → exact-id collision guard, then proceed.
5. **One-word confirm** (the anti-loop gate, same weight as 004's refine). On approve → `writeAtom`,
   `provenance: human-confirmed`. The `--apply` flag IS the gate; no `--apply` ⇒ dry-run preview only.
6. **Same store, same retrieval.** The lesson is written to the existing atom store and recalled by the
   **existing MemRecall hook** — NO new file, NO new location, NO new injection channel. (This is the
   explicit lesson of the synthesis-atom fragmentation bug: a second location is what caused "stored but
   not surfaced." Capture must not repeat it.)

## Out of scope (deferred, explicitly)

- **A1 auto-ingestion** — detect a cross-project recall that was *used + preceded a good outcome* → auto-draft
  a lesson (provenance `auto-captured`, low trust until vindicated). The adversarial review deferred this for
  pollution risk; only safe once there's signal to judge quality. **Staged AFTER assisted capture proves out.**
  The MVP must not preclude it (leave the `auto-captured` provenance tier and a draft-without-confirm path open).
- **Bulk-import of the 255 PAI memory files** — re-introduces the noise MemCarry exists to avoid. NOT this spec.
- **Curated migration** of genuinely cross-project PAI `feedback_*` lessons → global atoms — a *separate*
  spec that FEEDS capture's store; uses the same `capture-lesson` write primitive but is a one-time human-curated
  pass, not the live mechanism. Noted so it isn't conflated with the live capture path.
- **B3 reinforcement** (join `ratings.jsonl` → bump `use_count`/vindicate) — gated on having atoms to
  reinforce, which is exactly what this spec produces. The NEXT sprint, not this one.
- **Confidence-based auto-write** — NEVER. The circular-loop trap; explicitly forbidden (same as 004).

## Functional requirements

- **FR1:** `memcarry capture-lesson` accepts a drafted lesson (`--when`, `--do`, `--because`, optional
  `--trigger`, `--scope` defaulting to `global`), shows the rendered WHEN→DO→BECAUSE preview, and on
  `--apply` writes it via `writeAtom`.
- **FR2:** Without `--apply`, the command is a DRY RUN — it renders the preview and writes nothing (mirrors
  `refine`/`confirm`). The `--apply` flag is the non-bypassable human-confirm gate (FR: anti-loop).
- **FR3:** A captured lesson's `provenance` = `human-confirmed` (written only via the confirm/`--apply` path).
  Never auto-elevated; a draft the model produces without confirm is never written by this MVP.
- **FR4:** The lesson is written to the **existing atom store** (`atoms/<scope>/lesson/<id>.md` via the
  existing `writeAtom`) and is recalled by the **existing MemRecall hook** — no new location or channel.
- **FR5:** Degrades safely — a malformed/empty draft (missing `when`/`do`/`because`) → clear error, no write
  (atomic temp+rename already in `store.ts`). Mirrors `EmptyRefineError`.
- **FR6 (dup detection — reuse shipped recall + id guard):** before writing, run the existing `recall` on
  the draft's claim/triggers. A hit above the similarity threshold → surface it and offer the 004 `refine`
  flow instead of writing a new atom (no fragmentation). Below threshold → an **exact-id collision guard**
  (id generated deterministically from the claim — slug of `do` or content hash) prevents a silent
  overwrite; on collision, surface the colliding atom. The only NEW code is the id guard; the fuzzy check is
  recall (003) + refine (004). Threshold starts conservative and is tuned during build against real atoms.
- **FR7:** Trigger A (in-conversation) — an AISTEERINGRULES rule + a `/remember`-style surface: when YourName
  establishes a durable rule, the model drafts the lesson and applies it via the `memcarry capture-lesson`
  CLI on confirm (the proven hook+CLI path; **NOT MCP** — same rationale as backflow FR7).
- **FR8:** Trigger B (safety net) — the **End-skill** asks whether anything learned this session is a durable
  lesson worth capturing (sibling to the existing 004 step 1b backflow net). Confirm-gated, no speculative write.
- **FR9 (IN MVP — transcript-assisted draft):** the draft step reuses `parseTranscript` from `capture.ts`
  to suggest candidate lessons from the session; the human authors/confirms the final claim. The
  human-confirm gate (FR2/FR3) keeps it loop-safe regardless of how the draft was sourced.

## Acceptance criteria

- [ ] `memcarry capture-lesson --when … --do … --because …` (no `--apply`) renders the WHEN→DO→BECAUSE preview and writes nothing.
- [ ] The same command with `--apply` writes a `lesson` atom under the correct `atoms/<scope>/lesson/` path.
- [ ] A captured lesson's `provenance` is `human-confirmed`; no path writes a lesson on model confidence alone (grep: `--apply` required).
- [ ] After capture, `memcarry recall` in a relevant project surfaces the new lesson (proves same-store/same-retrieval, FR4).
- [ ] A draft missing `when`/`do`/`because` → clear error, no atom written (FR5).
- [ ] `--scope` selects the atom's scope; default is `global` when omitted (FR1).
- [ ] Capturing a draft semantically close to an existing lesson surfaces it and offers `refine` instead of writing a dupe (FR6).
- [ ] An exact-id collision surfaces the colliding atom rather than silently overwriting (FR6).
- [ ] The draft is seeded from the session transcript via `parseTranscript`, then human-confirmed (FR9).
- [ ] End-skill prompts whether a session learning is a durable lesson worth capturing (FR8 safety net).
- [ ] No new injection location or channel is introduced (grep: capture writes only via existing `writeAtom`; recall path unchanged).
- [ ] The store grows by exactly the confirmed lessons — no bulk-import, no auto-write (anti-pump guardrail).

## Resolved decisions (2026-06-16 — see Clarifications)

1. ~~Scope default?~~ → **Ask at capture (`--scope`, default `global`).** FR1/step-3.
2. ~~Trigger A surface?~~ → **Steering rule + End-skill net (mirror backflow); no new `/remember` command.** FR7/FR8.
3. ~~Transcript-assisted draft in MVP?~~ → **Yes, in the MVP** (reuse `parseTranscript`; human confirms). FR9.
4. ~~Dup-detection depth?~~ → **Reuse shipped semantic recall as the dup check + exact-id collision guard;**
   strong hit routes to the 004 refine flow. Threshold tuned during build. FR6.

## Constraints that govern this spec (inherited from 003/004 + the project rules)

1. **Atoms are the sole source of truth.** No new store, no new index location.
2. **Same store + same MemRecall retrieval** — capture must not create the fragmentation that caused the
   synthesis "stored-but-not-surfaced" bug.
3. **Anti-circular-loop provenance gate is non-bypassable** — `human-confirmed` only via explicit confirm.
4. **No bulk-pump** — grow the store only with genuinely-worth-keeping, human-confirmed lessons.
5. **Hook+CLI, NOT MCP** — the MCP server is an unregistered stub Claude can't call; mirror recall/resume/
   drift/refine (the proven live path).
6. **Mirror the existing `confirm`/`refine` CLI shape** — read/draft → preview → `--apply` writes. Reuse
   `writeAtom`; add one pure lib function (`draftLesson` / validate) + one CLI command. No rearchitecting.

## Build environment

Target: `~/Projects/kai/memcarry` (canonical, vendored — the live copy; `~/.claude` → `kai`
symlink; live hooks invoke `${PAI}/memcarry/packages/cli/...`). `kai/memcarry` syncs FROM kai.
`writeAtom` (atomic temp+rename) + `LessonAtom` schema + the `confirm`/`refine` patterns already exist in
`packages/lib/src/{store,schema}.ts` + `packages/cli/src/index.ts`. Tests: hermetic fixtures, injectable
embedder (never load the real model — `reference_bun_transformers_teardown_crash`). Full suite must stay green.

## Relationship to the other memcarry specs

- **004 (backflow)** made a global lesson *refinable* (B→A). 005 (capture) makes a session learning
  *become* a lesson in the first place. Together they close the cross-project knowledge **cycle**: capture
  (forward) + refine (backflow). Capture feeds the store that backflow then keeps current.
- **Curated migration** (separate, next) is a one-time human-curated bulk feed using 005's write primitive —
  distinct from the live per-learning capture this spec builds.
