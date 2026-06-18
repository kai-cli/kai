# Implementation Plan: MemCarry Retrieval Sprint

**Branch**: `003-memcarry-retrieval` (no git branch; SpecKit workspace doc) | **Date**: 2026-06-12
**Spec**: `specs/003-memcarry-retrieval/spec.md` | **Program**: `specs/003-memcarry-retrieval/PROGRAM.md`

**Input**: Feature specification from `specs/003-memcarry-retrieval/spec.md`

> **Target codebase is external to this repo.** SpecKit is the design studio; implementation lands in
> the LIVE canonical copy **`~/Projects/pai-config/memcarry/`** (= `~/.claude/memcarry`) + its adapter
> hooks `~/.claude/hooks/Mem*.hook.ts`. (`~/Projects/NewTool/core` was tombstoned 2026-06-12 — stale,
> do NOT build there. NewTool/ remains the design-docs home only.) `core/...` paths below = under
> `pai-config/memcarry/`.

## Summary

Fix the #1 lived pain — "memory is stored but absent until I prompt for it" — by upgrading MemCarry's
retrieval from keyword-only to **hybrid keyword+semantic recall (RRF-fused)**, surfacing it **ambiently
on every prompt** via a new sibling hook, making **warm cold-starts** read the active PRD's next-action,
and **re-injecting memory after compaction**. Per Fork 1 (refined by the live `ScoreProvider` seam): the
embedding model lives **host-side** (PAI adapter injects a jina cosine provider), the core stays
embedding-free, and **RRF fusion lives in `recall()`**. Four items; B1 is already built (verify-only),
B2's seam already exists (add RRF), A2/H2 are net-new.

## Technical Context

**Language/Version**: TypeScript (ESM), Bun 1.3.9 / Node 26 runtime. Hooks exec `.ts` directly (no build step).

**Primary Dependencies**: `zod@^4` (schema, already in `@memcarry/lib`); `@huggingface/transformers`
(jina embeddings, model `Xenova/jina-embeddings-v2-small-en`, dim 512, no API key — port the loader
PAI already uses); `@modelcontextprotocol/sdk` (existing, MCP server, not touched this sprint).

**Storage**: Git-tracked markdown **atoms** at `~/.claude/MEMORY/memcarry/store` (sole source of truth,
`MEMCARRY_STORE` env). Rebuildable, **gitignored** embedding **index cache** at Memcarry repo `index/`.

**Testing**: `bun test` (existing suite: 35 tests in `packages/lib/src/{lib,phase1,w6}.test.ts`). New unit tests for
`embeddings.ts`, `similarity.ts`, RRF fusion in `recall.ts`, dedup matcher; integration via the
`fixtures/replay-sessions.ts` smoke harness against real sessions.

**Target Platform**: Local macOS dev machine; Claude Code hook runtime (detached subprocesses) + MCP
stdio. Single-user, single-machine.

**Project Type**: CLI + library + thin hook adapters (monorepo: `packages/lib`, `packages/cli`,
`packages/mcp`, `adapters/claude-kai/hooks`).

**Performance Goals**: Recall on `UserPromptSubmit` must add **no perceptible latency** — disk + cached
index only, **no network, no blocking probes** (warm embed of the *query* only; atom vectors come from
cache). Target: recall returns in well under the hook-timeout budget (resume already returns in ~48ms;
recall budget similar, query-embed is the only new cost and is cached-model, in-process).

**Constraints** (from ARCHITECTURE.md §11 — these ARE the governance here):
1. Atoms are the sole source of truth; index/cache is gitignored + rebuildable.
2. Never block SessionStart/UserPromptSubmit on probes or network.
3. Degrade WITHOUT crashing (NOT silently): embedder down → keyword-only fallback; store down → no
   injection. Per the observability-hole rule, log a stderr/heartbeat trace on any dropped recall/resume
   context — exit 0, but never vanish silently.
4. Run ALONGSIDE PAI v8.0; no migration/retirement of the 269-file store this sprint.
5. Atoms stay human-readable markdown (WHEN→DO→BECAUSE HEAD).

**Scale/Scope**: Store is tiny today (~5 atoms) and grows slowly during the signal-gathering month.
All design choices (RRF over weighted-sum, no auto-promotion, no value-loop) are calibrated for n=few.

## Constitution Check

*GATE: Must pass before Phase 0. Re-check after Phase 1.*

Validated against `.specify/memory/constitution.md` v1.0.0 (ratified 2026-06-12). Each principle ↔ this
plan:

| Principle | Compliance |
|-----------|-----------|
| **I. Verification Before Assertion** | ✅ 8 runnable quickstart scenarios + per-item acceptance criteria; every requirement maps to a check |
| **II. Inconclusive ≠ Confirmation** | ✅ embedder-unavailable is a distinct, handled state (keyword fallback, `semanticRank:null`), not silently treated as "no match"; reuses MemCarry's existing 3-state probe discipline unchanged |
| **III. First Principles, Surgical Change** | ✅ extends `recall.ts`/`capture.ts`, adds 2 hooks; no rearchitecting; ports proven PAI logic rather than re-inventing; no atom-schema fields removed |
| **IV. Prove New Before Retiring Old** | ✅ runs ALONGSIDE PAI v8.0; no writes to the 269-file store; index cache is rebuildable/gitignored, atoms remain sole truth |
| **V. Provenance & Earned Authority** | ✅ PRD-derived `next` stays `auto-captured` until `/end` confirm unless ISC user-checked; recall only ranks, never grants authority |
| **VI. No False Precision; Defer Unjustified** | ✅ RRF chosen over weighted-sum precisely because n≈5 can't justify tuned weights; P4 triggers / P5 value-loop explicitly deferred |

**Result: PASS** — all six principles satisfied, no gate violations. Complexity Tracking left empty.
(Note: ARCHITECTURE.md §11 remains the *domain* contract for MemCarry; the constitution is the
*universal* layer above it — both are satisfied.)

## Project Structure

### Documentation (this feature)

```text
specs/003-memcarry-retrieval/
├── PROGRAM.md           # Full program scope + locked decisions (already written)
├── spec.md              # Feature spec + clarifications (already written)
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (CLI + hook contracts)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (in `~/Projects/pai-config/memcarry/` — LIVE canonical, NOT this repo)

```text
packages/lib/src/
├── recall.ts            # MODIFY: ScoreProvider seam ALREADY EXISTS — change `provided ?? keywordScore`
│                        #         to RRF fusion of keyword+semantic ranks (US1/B2). Gate preserved.
├── (embeddings: NONE in core — host-side provider per Fork 1 + live seam)
└── (schema/store/transcript/probes/verify/project/capture/duplicates.ts — unchanged)

packages/cli/src/index.ts  # MODIFY: pass host ScoreProvider through to recall()

(host side — PAI adapter)
├── adapters/claude-kai/lib/jina-provider.ts  # NEW (T003): (lesson,prompt)=>cosine|null, reuse PAI embeddings.ts
├── adapters/.../index-cache.ts               # NEW (T004): host vector cache, gitignored, rebuild-on-miss
├── ~/.claude/hooks/MemRecall.hook.ts         # NEW (US2/A2): every-turn recall → <memcarry-recall>
├── ~/.claude/hooks/MemCompact.hook.ts        # NEW (US4/H2): PostCompact → re-inject cached cursor+recall
├── ~/.claude/hooks/MemResume.hook.ts         # ✅ ALREADY has B1 (activePrdNextAction) — verify only
├── ~/.claude/hooks/MemDrift.hook.ts          # UNCHANGED: read-once drift (separate from MemRecall)
└── ~/.claude/hooks/MemCapture.hook.ts        # unchanged this sprint
```

**Structure Decision**: Edit the LIVE `pai-config/memcarry` monorepo (sync to kai via `sync-to-kai.sh`;
never edit kai or the tombstoned NewTool/core). Core stays embedding-free — the `ScoreProvider` seam
already exists; we only add RRF fusion in `recall()`. The jina provider + vector cache live **host-side**
(PAI adapter) per Fork 1. New hooks `MemRecall`/`MemCompact`; `MemResume` B1 is already built (verify).
No new package; no build step (bun execs `.ts`).

## Complexity Tracking

> No Constitution Check violations — table intentionally empty.

## Phase Status

- [x] Phase 0: research.md (fusion, embeddings-in-core, dedup, PRD-read, compaction) — generated
- [x] Phase 1: data-model.md, contracts/, quickstart.md — generated
- [ ] Phase 2: tasks.md — created by `/speckit-tasks`
