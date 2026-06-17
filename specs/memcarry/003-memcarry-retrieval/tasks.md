---
description: "Task list for MemCarry Retrieval Sprint implementation"
---

# Tasks: MemCarry Retrieval Sprint

**Input**: Design documents from `specs/003-memcarry-retrieval/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/cli-and-hooks.md, quickstart.md
**Constitution**: `.specify/memory/constitution.md` v1.0.0 — Principle I mandates runnable checks ⇒ **tests included**.

> **Target repo:** `~/Projects/kai/memcarry` (LIVE canonical `@memcarry/*` monorepo) — NOT this SpecKit repo, NOT the tombstoned NewTool/core.
> Paths: `packages/lib/src/*`, `packages/cli/src/index.ts` (in kai/memcarry); host hooks at `~/.claude/hooks/Mem*.hook.ts`.
> Run with `MEMCARRY_STORE="$HOME/.claude/MEMORY/memcarry/store"`. Sync to kai via `sync-to-kai.sh`; never edit kai or NewTool/core.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: parallelizable (different file, no incomplete dependency)
- **[US#]**: maps to the spec's four Items (US1=B2 hybrid recall, US2=A2 ambient, US3=B1 PRD resume, US4=H2 compaction)

## Story → Item → Priority map
| Story | Item | Priority | Why this order |
|-------|------|----------|----------------|
| **US1** | Item 1 / B2 — hybrid recall | **P1 (MVP)** | Foundation: US2 & US4 depend on the hybrid `recall()` it produces |
| **US2** | Item 2 / A2 — ambient every-turn recall | P2 | Surfaces US1's recall on every prompt; needs US1 + dedup |
| **US3** | Item 3 / B1 — PRD-aware warm resume | P2 | Independent of US1; pure structured read |
| **US4** | Item 4 / H2 — compaction recovery | P3 | Reuses US2's dedup + US1's recall |

---

## Phase 1: Setup

> **TARGET = `~/Projects/kai/memcarry`** (the LIVE copy; `~/.claude`→kai symlink). NOT
> `NewTool/core` (stale). All `core/...` paths below are under `~/Projects/kai/memcarry/`.

- [ ] T001 Baseline green: from `~/Projects/kai/memcarry` run `bun install && bun test` — record the existing **35** tests pass (`lib`+`phase1`+`w6` test files) before any change (Constitution IV regression baseline).
- [ ] T002 Confirm `index/` is gitignored; verify `MEMCARRY_STORE=~/.claude/MEMORY/memcarry/store` via `bun run packages/cli/src/index.ts health` (expect ~6 atoms).
- [ ] T002b Reconcile the stale `~/Projects/NewTool/core`: diff vs live (`recall.ts`, `project.ts`, `transcript.ts`, `phase1.test.ts`, missing `w6.test.ts`); decide retire-or-resync so work doesn't fork. Record decision. (Addresses the 4-copy divergence; do NOT build in NewTool/core.)

## Phase 2: Foundational (host-side embedding provider — blocks US1, US2, US4)

> **REVISED:** the live `recall.ts` already has the portable `ScoreProvider` seam (W6). The embedding
> model lives **host-side** (PAI adapter), NOT in `@memcarry/lib` — stronger portability than "build in
> core." Core gains only RRF (pure arithmetic). So "foundational" = the host provider + its cache.

- [x] T003 [P] ✅ `hooks/lib/memcarry-semantic.ts` — `buildSemanticProvider()` reuses PAI `embed()`+`cosineSimilarity()`; embeds rendered claim+triggers (R4); async→sync bridge (precompute then sync closure); null when prompt unembeddable (logged, not silent). Commit `1661b38`.
- [x] T004 [P] ✅ `VectorCache` in same module — atomId+content-hash keyed, write-through on miss, header pins model/dim, discards on mismatch, rebuildable/gitignored.
- [x] T005 [P] ✅ `tests/MemcarrySemantic.test.ts` — 5 tests (cosine correctness, null-prompt degrade, per-lesson abstain, cache reuse no-re-embed, model-mismatch discard) via injectable stub embedder. All pass.

**Checkpoint:** host provider returns cosine (or null), cache rebuildable, core untouched. `bun test` green.

---

## Phase 3: US1 — Hybrid recall (Item 1 / B2) 🎯 MVP · Priority P1

**Goal:** `recall()` fuses keyword + semantic via RRF (in `recall()`, provider stays per-lesson cosine), precondition-gated, degrades to keyword-only.
**Independent test:** Scenarios 1-4 in quickstart.md pass.
**Note:** the `ScoreProvider` seam + precondition gate already EXIST in live `recall.ts`. The change is replacing `provided ?? keywordScore` (replace) with RRF fusion.

- [x] T007 [US1] ✅ In `recall.ts`, two-pass: gate+score all eligible lessons, then `rankMap()` derives keyword + semantic rankings. Provider stays per-lesson raw score (commit-ready in kai/memcarry).
- [x] T008 [US1] ✅ Replaced `provided ?? keywordScore` with **RRF fusion** `1/(60+kRank)+1/(60+sRank)` (absent ranking → 0 term); `RecallHit` extended with `keywordRank`/`semanticRank`; deterministic id-tiebreak.
- [x] T009 [US1] ✅ Gate runs before fusion; "provider cannot resurrect gated-out lesson" test passes; added exact-identifier-not-drowned test. (w6.test.ts updated from replace→RRF semantics.)
- [ ] T010 [US1] Degraded mode: provider returns null for all (embedder down) ⇒ semantic term 0 everywhere ⇒ pure keyword ranking; never throw; recall reads atoms from disk (survives MCP down). Per Constitution rule 3 (REVISED): on a swallowed degrade that drops recall, emit a `console.error`/heartbeat line — don't vanish silently. Depends on T008.
- [ ] T011 [US1] Wire `memcarry recall` CLI to pass the host provider through to `recall()`; output matches contract C1 (hits with rank fields); on internal error print `{"hits":[]}` + stderr note, exit 0. Depends on T008-T010.
- [ ] T012 [P] [US1] Tests in `recall.test.ts` (extend `w6.test.ts` patterns): semantic-only match found via a stub provider (Scenario 1); provider-null still returns keyword hits (Scenario 2); new atom found without manual reindex (Scenario 3); gate beats semantic score (Scenario 4). Depends on T007-T011.

**Checkpoint:** US1 independently shippable — hybrid recall via seam+RRF, degrades cleanly. This is the MVP.

---

## Phase 4: US3 — PRD-aware warm resume (Item 3 / B1) ✅ ALREADY BUILT · verify-only

**Goal:** confirm the live B1 implementation meets the acceptance criteria; add a regression test.
**Independent test:** Scenario 7 passes against the LIVE hook.
**Note:** `~/.claude/hooks/MemResume.hook.ts:96` already calls `activePrdNextAction()` and emits `NEXT (PRD …)`. No implementation needed — verify + lock with a test.

- [ ] T013 [US3] Read the live `activePrdNextAction()` impl in `MemResume.hook.ts` (+ wherever it's defined); confirm it resolves the active PRD via `STATE/work.json`→`WORK/*/PRD.md`, extracts STATUS next-action / first unchecked ISC, and uses the shared project-dir encoder (Constitution rule 6).
- [ ] T014 [US3] Verify acceptance: active-PRD session shows real next-action; no-PRD session unchanged; NO new SessionStart LLM call; async-detach unchanged. Record evidence (Scenario 7).
- [ ] T015 [P] [US3] If no regression test exists for `activePrdNextAction()`, add one (active-PRD → real next; no-PRD → fallback; no inference). If one exists, note it.

**Checkpoint:** US3 verified done — warm cold-start from PRD confirmed working, regression-locked.

---

## Phase 5: US2 — Ambient every-turn recall (Item 2 / A2) · Priority P2

**Goal:** new `MemRecall` hook injects hybrid recall on every prompt; dedup vs PAI MemoryRecall.
**Independent test:** Scenarios 5-6 pass. Depends on US1 (hybrid recall).

- [~] T017 [US2] ⏸️ DEFERRED BY DECISION (2026-06-12, "C+"). Cross-system dedup NOT built — investigation showed: (1) hooks are separate processes (only fs coordination), (2) MemoryRecall fires FIRST so MemRecall could only suppress ITSELF (hide the better distilled claim, keep the weaker pointer — wrong direction), (3) collisions are near-zero today (different stores; overlap only for lessons promoted from a MEMORY.md file — currently 1 atom) and low-harm always (≤2 redundant lines; memcarry's claim is strictly more useful than MemoryRecall's pointer). Coupling two hooks isn't worth it yet. **Future enabler (not built):** add an optional `source` field to the lesson schema when promoting from a file (useful for provenance/Constitution V + A3 auto-promotion dedup); only then is clean source-path dedup possible. Revisit if double-surfacing actually annoys in real use.
- [x] T018 [US2] ✅ `~/.claude/hooks/MemRecall.hook.ts` (commit `7a2caa2`): every `UserPromptSubmit`, IN-PROCESS hybrid recall (not CLI — needs the async host provider), emits `<memcarry-recall>`. Registered in `config/hooks.jsonc` after MemDrift; settings.json regenerated. Live-verified with real model.
- [x] T019 [US2] ✅ K=5 cap; `CLAIM_DISPLAY_CAP` enforced by core; `MemDrift` unchanged (separation of concerns). NOTE: cross-system ≤5 budget coordination with MemoryRecall is part of the deferred T017 dedup.
- [x] T020 [P] [US2] ✅ `tests/MemRecallDegraded.test.ts` — hermetic keyword-only-fallback test (injectable EmbedFn, no mock.module leak). Full suite 1824 pass / 0 fail. (Dedup-specific tests await T017.)

**Checkpoint:** US2 LIVE — semantic recall fires every prompt. Dedup-vs-MemoryRecall (T017) deferred by decision C+ (near-zero collisions, low-harm, wrong suppression direction). US2 considered DONE for this sprint.

---

## Phase 6: US4 — Compaction recovery (Item 4 / H2) · Priority P3

**Goal:** re-inject cached cursor + recall after compaction; no probes.
**Independent test:** live compaction event re-injects resume + (cursor-relevant) lessons.
**REVISED:** No new `MemCompact.hook.ts` — `PostCompactRecovery.hook.ts` already existed and already
re-injected the resume CURSOR (H2 half-built). Extended it with lesson recall rather than duplicating a
hook. No CLI shell-out for recall (needs the async host provider) — uses the shared in-process helper.

- [x] T021 [US4] ✅ Extended `~/.claude/hooks/PostCompactRecovery.hook.ts` (commit `faca299`): on `source:'compact'`, re-injects `<memcarry-resume reinjected-after-compaction>` (cursor) + `<memcarry-recall reinjected-after-compaction>` (lessons recalled against the cursor's next+summary — the compaction event has no prompt). Cached cursor, no blocking probes. Degrades to nothing per block. Dedup-vs-MemRecall N/A (deferred C+).
- [x] T022 [P] [US4] ✅ `tests/MemcarryRecallShared.test.ts` — 4 hermetic tests of the shared `recallLessons` helper (keyword leg, semantic leg via stub, empty-query guard, bogus-store degrade). Injectable embedder = no model load, no crash. Live-verified: real compaction event exits 0, re-injects resume (+lessons when cursor-relevant). Full suite 1828 pass.
- [x] T-refactor ✅ Extracted `recallLessons()` shared helper (`memcarry-semantic.ts`) used by BOTH MemRecall + PostCompactRecovery — single source, can't drift (Constitution III).

**Checkpoint:** US4 DONE — long sessions don't go cold; resume cursor + relevant lessons survive compaction.

---

## Phase 7: Polish & Cross-Cutting

- [ ] T023 [P] Optional: upgrade `duplicates.ts` report from Jaccard to cosine using the host provider's cosine (spec Item 1 fast-follow); read-only, no auto-merge. Depends on T003.
- [ ] T024 [P] Resolve R7 open detail: define how MemCarry reads "what MemoryRecall injected this turn" (per-session scratch marker); document in `dedup-inject.ts`; confirm no-dedup fallback is safe. Depends on T017.
- [ ] T025 Run full quickstart.md (all 8 scenarios) end-to-end against the live store; record results. Regression gate: `bun test` (35 existing + new) green; `resume/drift/capture/duplicates/write/confirm/health` signatures unchanged; no writes to the 269-file PAI store (Constitution IV).
- [ ] T026 [P] Confirm latency: `MemRecall` hook on `UserPromptSubmit` returns in **< 150ms p95** (disk + cache only; query-embed on cached model; no network). Record timing against the resume ~48ms baseline; fail the gate if over budget.

---

## Dependencies & Execution Order

```
Setup (T001-T002)
   ↓
Foundational / host provider + cache (T003-T005)   ← blocks US1, US2, US4
   ↓
US1 hybrid recall (T007-T012) ── MVP ──┐
US3 PRD resume (T013-T016)  [PARALLEL with US1 — independent]
   ↓                                    │
US2 ambient recall (T017-T020)  ────────┘ (needs US1)
   ↓
US4 compaction (T021-T022)  (needs US1 + US2 dedup)
   ↓
Polish (T023-T026)
```

**Critical path:** Setup → Foundational → US1 → US2 → US4. US3 floats (parallel to US1).

## Parallel Opportunities

- **Foundational:** T003 (provider) ∥ T004 (cache) — different files; T005 tests after both.
- **US1 vs US3:** entire Phase 4 (US3) runs parallel to Phase 3 (US1) — no shared files, no dependency.
- **Within stories:** test tasks (T012, T016, T020, T022) are [P] once their implementation lands.
- **Polish:** T023, T024, T026 independent.

## Implementation Strategy

- **MVP = US1 only** (T001-T012): hybrid recall that surfaces semantic matches and degrades cleanly. This alone addresses the core "absent until prompted" pain at the CLI level.
- **Increment 2:** add US3 (warm resume) — independent, low-risk, no embeddings.
- **Increment 3:** US2 (ambient surfacing) — turns CLI recall into automatic per-turn injection.
- **Increment 4:** US4 (compaction) — completes the "never lose memory mid-session" story.
- Ship each increment behind the run-alongside rule (Constitution IV): no PAI teardown, MemCarry store separate, throughout.

## Format validation
All 26 tasks: ✅ checkbox · ✅ sequential ID · ✅ [P]/[US#] labels where applicable · ✅ explicit file paths · setup/foundational/polish carry no story label by design.
