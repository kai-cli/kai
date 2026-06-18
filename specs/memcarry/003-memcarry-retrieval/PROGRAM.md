# Program Scope — Memcarry + PAI Convergence

> **Status:** Scope-capture for review (pre-speckit) · **Owner:** Deven · **Created:** 2026-06-12
> **Reads from:** `~/Projects/NewTool/{ARCHITECTURE.md, PLAN.md, ROADMAP.md, SATURATION-CANDIDATES.json}`
> **Purpose:** Capture the FULL scope before firing speckit, so the plan covers all three threads:
> (1) finish Memcarry's retrieval, (2) compaction recovery, (3) the PAI cleanup/rewrite decision.

## ✅ Decisions locked (2026-06-12)

1. **C15 fork → FORK 1 (shared engine in Memcarry).** Memcarry core owns the single
   `embeddings.ts` / `similarity.ts` / transcript engine; PAI imports FROM Memcarry (inverts today's
   dependency). Memcarry stays portable ("beside any AI"); PAI thins out. This makes Memcarry the
   foundation and PAI a client of it — the right direction given the long-term rebuild intent below.
2. **Cleanup intent → CONSOLIDATE PAI now; north star = TYPED-CORE STRANGLER (not a compiled rewrite).**
   Thread C near-term = fix the 23 findings + extract shared engines + streamline for persona, keeping
   PAI. Long-term north star: **grow PAI's capabilities into Memcarry's typed core one at a time
   (strangler-fig), add a build/type-check gate + contract tests, run on bun.** This delivers ~80% of
   the hardening Deven wants (refactor-safety, killed duplication, enforced cross-module contracts) at
   low risk. **Compilation to a sealed binary is explicitly NOT the goal** — it mainly buys
   distribution/sealing (low value for single-user/single-machine) and cannot dissolve the Claude Code
   hook boundary anyway (ARCHITECTURE.md §11 #1: hooks are detached subprocesses). Best achievable shape
   = compiled/typed core + thin hook shims, which Memcarry's CLI already IS. NO big-bang rewrite —
   violates "surgical fixes only" + the run-alongside-for-a-month rule.
3. **Persona scoping → TWO-TIER.** Tier 1: Deven defines the four-hats capability set up front
   (initial input). Tier 2: audit real usage (which of 49 skills/hooks actually fire) and refine the
   cut as we go. Not a one-shot decision — an initial cut + ongoing evidence-based refinement.

---

## 0. The one-paragraph situation

Memcarry (codename Ferrymem/Cairnix) is **built through Phase 1** — 35 tests passing (live canonical), name locked, MVP
adapter hooks written, warm-resume + verify-at-load + cross-project lessons all live-proven. What's
left is not "design a system" — it's **(A) make retrieval actually surface memory** (the #1 lived
pain), **(B) close the compaction gap**, and **(C) decide what happens to PAI** now that a leaner,
better-architected memory core exists. The PAI teardown (`SATURATION-CANDIDATES.json`, 23 verified
findings) already mapped the cleanup surface. The pivotal finding (C15) ties it all together:
**Memcarry currently re-implements 7 of its 10 roadmap items instead of reusing PAI's libs** — so the
retrieval work and the cleanup work are the *same decision* about where shared engines live.

---

## 1. The three threads (this program)

### Thread A — Retrieval (spec.md, ready now)
Make memory surface without being asked. `specs/003-memcarry-retrieval/spec.md` covers:
- **B2** — hybrid semantic+keyword recall (reuse PAI jina embeddings)
- **A2** — dual-recall on every UserPromptSubmit (not just first prompt)
- **B1** — resume-state reads the active PRD's next-action

This is the highest-leverage thread and attacks "absent until prompted" head-on.

### Thread B — Compaction recovery (H2) — ADD to this program
**Gap:** Memcarry's resume + recall context is injected at SessionStart / UserPromptSubmit, but when
the window **compacts mid-session**, that context is lost. PAI already solves this for its own context
via `PostCompactRecovery` (and `PreCompact`). Memcarry has no compaction hook.

**What:** A `PreCompact`/`PostCompact` adapter hook that re-injects the active resume-state cursor +
the top recalled lessons after compaction, so a long session doesn't go cold halfway through.

**Reuse:** PAI's `PostCompactRecovery.hook.ts` + `PreCompact.hook.ts` as the pattern; Memcarry's
existing `memcarry resume` / `memcarry recall` CLI as the payload source.

**Acceptance:**
- [ ] After a forced compaction in a long session, the resume cursor + relevant lessons reappear in
      context without the user re-prompting.
- [ ] No double-injection if a normal UserPromptSubmit recall already covered it (dedup, as in A2).
- [ ] Degrades silently if no active resume-state / CLI unavailable.

> Decision needed: ship H2 **inside the retrieval spec** (it shares the dedup-at-injection machinery
> from A2) or as its own thin spec. Recommendation: **fold into spec.md as Item 4** — same hook surface,
> same dedup logic, cheap, closes a real gap. (This was open-question #5 in spec.md.)

### Thread C — PAI cleanup / rewrite decision — NEW spec needed
The big question you actually want answered: **"once Memcarry owns memory, what in PAI is extraneous,
and do we clean it up or rewrite around Memcarry?"** The analysis is done; the *decision* and the
*execution plan* are not. This thread becomes its own spec (draft outline in §3 below).

---

## 2. The pivotal architectural fork (C15) — decide BEFORE speccing cleanup

`SATURATION-CANDIDATES.json` C15, verified: **Memcarry imports zero PAI libs.** It re-implements
transcript parsing, dedup, and recall that PAI already has. The roadmap's own `reuse-verdicts.md` maps:

| Memcarry item | PAI lib it SHOULD reuse | Currently |
|---|---|---|
| A1 ingestion | `SessionHarvester` | re-implemented |
| A2 recall | `MemoryRecall` | re-implemented (keyword-only) |
| A3 dedup | `CrossProjectIndex` | re-implemented (Jaccard) |
| B2 semantic | `semantic-fallback` / `embeddings.ts` | **not built yet** ← Thread A fixes this |
| B3 reinforce | `memory-scorer` | deferred |
| B6 capture | `MemCapture` | shared gate, partially |
| H3 archival | `MemoryCurate` | not built |
| **verify-at-load + resume-cursor** | *(genuinely new)* | Memcarry-only |

**Only verify-at-load + the resume cursor are genuinely new.** Everything else is duplicated effort.
This forces a fork that governs the entire cleanup spec:

- **Fork 1 — Shared engine (recommended).** Extract PAI's proven engines (C1: one `similarity.ts` +
  `embeddings.ts`; transcript cache C6; inference arbiter C5) into a **shared library** that BOTH PAI
  hooks and Memcarry consume via a provider seam. Memcarry becomes a thin layer over shared engines +
  its novel verify/resume. Kills duplication once, benefits both. This is the "rewrite PAI *around*
  Memcarry" path — evolutionary, low-risk, and it's what C1/C3/C5/C6/C15 collectively point to.
- **Fork 2 — Clean cut.** Memcarry stays fully standalone (portable, "beside any AI"), PAI keeps its
  own engines, and over time PAI's memory subsystem is retired wholesale in favor of Memcarry +
  thin adapters. More duplication short-term; maximum portability; bigger eventual teardown.

> **DECIDED → FORK 1 (see top of doc).** Shared engine lives in Memcarry core; PAI imports FROM it.
> Memcarry becomes the foundation, PAI a client — aligned with the long-term rebuild-around-Memcarry
> intent. Cleanup = consolidate into the shared engine.

---

## 3. Thread C cleanup spec — outline (the 23 findings, grouped for execution)

The saturation analysis says: **stop scanning, start executing.** Findings cluster into workstreams:

**W1 — Shared engine (do first; unblocks everything).** C1 (3 cosine defs → one `similarity.ts` +
`embeddings.ts`) + C6 (14 hooks re-parse transcript → `transcript-cache.ts`) + C5 (4-5 hooks call
inference on same transcript → `inference-arbiter.ts` single batched call) + C3/C4 (wire
`SessionEndComposite` to impose ordering). **All four are one workstream** — the shared-engine seam.
This is also where Thread A's B2 plugs in (reuse the extracted `embeddings.ts`).

**W2 — Dead/zombie code resolution.** C2 (orphaned `memory-scorer` → wire as re-ranker or delete-by-
deadline) · C7 (5 unwired hooks: rename `WriteTracker`→lib, audit DeviceAuthReminder/WeeklyMaintenance/
WorktreeSetup) · C8 (write-only `security-events.jsonl` → route to learning or drop) · C16 (empty
embeddings index → build it, which Thread A needs) · C17 (dormant Discord/Twilio channels → implement
or remove).

**W3 — Coherence races.** C13 (tab/name setters race on UserPromptSubmit) · C14 (two Read-trackers
re-parse same event) · C18 (BuildSettings choke point → add validation/rollback).

**W4 — Capability-cluster consolidation (verify empirically FIRST — these are hypotheses).** C22:
3 harvesters → one pipeline; 3 Wisdom tools → WisdomPipeline; agent-dispatch decision tree; mega-skill
routers (Utilities ~400 files, Security ~46, Thinking ~51) flatten/rename. **Meta-observation warns
these are SUSPECTED, not verified — require read/write audits before action.**

**W5 — Wiki-accuracy correction pass.** C9-C12, C19 (hook count 52+5; skills 49 vs 89; libs=40/tools=49;
UpdateCounts not orphaned). Low-risk doc fixes; batch them.

**Persona scoping (net-new, the only real design work).** The TPM/PM/QA/Engineer lens — which of the
49 skills / capabilities actually serve those four hats, and what gets cut as out-of-persona. This is
where "streamline PAI for the specific user I am" becomes concrete. **Deserves its own discussion;**
it's the subjective filter that W4 consolidation should be run through.

---

## 4. Recommended sequence

```
1. Thread A (spec.md): retrieval B2+A2+B1   ── highest leverage, attacks #1 pain, READY
   └─ +Item 4: H2 compaction recovery        ── fold in (shares A2 dedup machinery)
2. Decide the C15 fork (§2)                   ── shared-engine vs clean-cut — DISCUSSION
3. Thread C spec, W1 first (shared engine)    ── B2 from Thread A plugs into W1's embeddings.ts
4. Thread C: W2/W3 (dead code, races)         ── mechanical cleanup
5. Persona scoping discussion → W4            ── subjective; run cluster-consolidation through it
6. W5 wiki fixes                              ── batch, low-risk
```

**Why this order:** Thread A is independently valuable and proves retrieval before any teardown. W1
(shared engine) is the linchpin both threads need — and B2 builds the very `embeddings.ts` reuse W1
formalizes, so doing Thread A first de-risks W1. The persona filter (the actual "make it mine" goal)
comes after the mechanical wins so it's applied to a clean base, not a tangled one.

**Unbreakable rule (from ARCHITECTURE.md §11):** Memcarry runs ALONGSIDE PAI v8.0 in its own repo for
a real month. **No migration of the 269 files, no retiring PAI memory, until warm-resume + retrieval
prove themselves in daily use.** Thread C execution (beyond the shared-engine extraction) waits on that
proof. Cleanup ≠ teardown.

---

## 5. What speckit should produce

- **Now:** plan + tasks for `spec.md` (Thread A + H2 Item 4).
- **After the C15 fork decision:** a second spec for Thread C, W1-first, with W4/persona gated on
  empirical audits + the parallel-running proof period.

## 6. Open decisions to resolve before/within speckit
1. **C15 fork** (§2): shared-engine-in-Memcarry-core (hybrid) vs clean-cut standalone. *Governs Thread C.*
2. **H2 placement:** fold into spec.md as Item 4 (recommended) vs own spec.
3. **Persona definition:** explicit list of which capabilities serve TPM/PM/QA/Engineer — needed to
   scope W4. *Net-new; needs your input, not analysis.*
4. **Cleanup vs rewrite framing:** is Thread C "consolidate PAI" or "replace PAI memory with Memcarry"?
   The fork in #1 largely answers this, but confirm the intent.
