# Spec 003 — MemCarry Retrieval Sprint

> **Status:** Draft for review · **Owner:** Deven · **Created:** 2026-06-12
> **Supersedes:** `specs/002-claude-harness/brief.md` ("Sentinel") — that brief was an independent
> re-derivation of work already done in `~/Projects/NewTool/ARCHITECTURE.md` (Ferrymem) and built as
> MemCarry. This spec implements the **next roadmap items**, it does not design a new system.
> **Source of truth:** `~/Projects/NewTool/ROADMAP.md` (items B2, A2, B1) + `ARCHITECTURE.md` §1, §11.

## Clarifications

### Session 2026-06-12
- Q: Fusion method for combining keyword + semantic recall rankings? → A: **RRF** (reciprocal-rank fusion; parameter-free, robust at ~5 atoms)
- Q: Per Fork 1, how should B2 get embeddings this sprint? → A: **Build in Memcarry core** (`@memcarry/lib`); pin model id; no PAI coupling
- Q: A2 ambient recall — hook structure on every UserPromptSubmit? → A: **New sibling hook** (separate from MemDrift; drift=read-once, recall=every-turn)
- Q: Dedup-at-injection basis? → A: **Source-path + content-hash** (exact, deterministic, no embedding call in hot path)

## Why this sprint exists

The #1 lived pain is **"memory is there but absent until I prompt for it."** Diagnosed precisely
in `ARCHITECTURE.md` failure mode #1 (Activation gap) and #3 (Transfer gap). The fix is **not** more
storage — MemCarry's schema/provenance/staleness are already built and good. The fix is **retrieval**:

1. MemCarry's `recall.ts` is **keyword-only** today (literal trigger-token overlap). It misses
   semantically-related lessons that don't share exact words.
2. Cross-project recall barely fires because the store has ~5 atoms and recall only contributes on
   the **first** prompt (via `MemDrift`), not every turn.
3. Cold starts are still partly mechanical because resume-state doesn't read the active PRD's
   next-action.

Independent retrieval research (this session) confirmed the canonical fix: **hybrid keyword + semantic
recall fused, run ambiently per-turn.** Pure vector misses exact identifiers (`M62CF-EU`, `issue #248`,
`br-backbone`); pure keyword misses paraphrases. You need both. PAI already ships the embedding half.

## Scope — four items, in dependency order

### Item 1 — B2: Hybrid (semantic + keyword) recall  ⭐ core fix · PARTLY BUILT

> **Re-baselined 2026-06-12 against live `pai-config/memcarry`.** A **`ScoreProvider` seam already
> exists** in the live `recall.ts` (W6 work, tested in `w6.test.ts`): `recall()` accepts an optional
> per-lesson `ScoreProvider = (lesson, prompt) => number | null`; the engine stays embedding-free and a
> host injects semantics. **Remaining work** = (a) implement the jina-backed provider on the host/adapter
> side, and (b) change `recall()` from *replace* (`provided ?? keywordScore`) to **RRF fusion** of the
> keyword rank and the semantic rank — so exact-identifier keyword hits aren't overwritten by cosine.

**What:** Complete the hybrid scorer. Keep the portable per-lesson `ScoreProvider` seam (provider returns
**raw cosine similarity**, not a rank). Move **RRF fusion into `recall()`** where both the keyword ranking
and the semantic ranking are visible. The semantic provider is jina-backed and lives on the **host/adapter
side** (PAI supplies it; KAI/others pass nothing → keyword-only). The engine (`@memcarry/lib`) never
imports an embedding model — RRF is pure arithmetic on two ranks.

**Embeddings home (CLARIFIED → Fork 1, REFINED by live seam):** The embedding model lives on the
**host/adapter side**, NOT in `@memcarry/lib`. This is *stronger* portability than "build in core" — the
core has zero embedding dependency; it exposes the `ScoreProvider` seam and the host injects a jina-backed
scorer. RRF fusion (pure arithmetic) lives in core `recall()`.
- **Provider (host side, PAI adapter):** `(lesson, prompt) => cosine | null`. Backed by PAI's existing
  `~/.claude/hooks/lib/embeddings.ts` (`embed()`, `Xenova/jina-embeddings-v2-small-en`, dim 512, no API
  key) + `similarity.ts` (`cosineSimilarity`). The adapter embeds prompt + lesson, returns cosine.
  Returns `null` when the embedder is unavailable (→ keyword-only fallback). KAI/others inject nothing.
- **Core (`@memcarry/lib`):** keeps the `ScoreProvider` type + the gate; `recall()` gains RRF fusion.
  No model load in core. The index cache (vectors) is also host-side (where the embedder is).

**Design constraints (from ARCHITECTURE.md §11):**
- **Atoms remain sole source of truth.** The embedding index is **gitignored, rebuildable cache**
  (finding #13). Store it under `index/` in the MemCarry repo, keyed by atom `id` + content hash;
  rebuild on miss. Pin the embedding model id in the cache header (finding #13).
- **Recall must survive the embedder being unavailable** (finding #2 degraded mode). If `embed()`
  returns null (model not loaded), fall back to today's pure-keyword scorer — never throw, never block.
- **Precondition gate still applies** (finding #12): a lesson whose `when` clearly doesn't match must
  not be injected and must not consume the top-K budget — semantic score does **not** override the gate.
- Embed the **rendered claim** (`WHEN→DO→BECAUSE`) + triggers, not just triggers (better recall;
  mirrors Anthropic contextual-retrieval "context header" finding).

**Fusion (CLARIFIED → RRF, in `recall()`):** `score = 1/(60+keywordRank) + 1/(60+semanticRank)`; a
lesson absent from a ranking contributes 0 for that term. Lives in `recall()` (sees all candidates —
the per-lesson provider cannot compute a rank). Replaces the live `provided ?? keywordScore` line.
Parameter-free, robust at ~5 atoms. Exact-identifier protection: a #1 keyword rank fuses high regardless
of cosine, so `M62CF-EU` / `issue #248` hits are never overwritten by semantic similarity. Embedder down
⇒ all `semanticRank` absent ⇒ score reduces to pure keyword ranking (free degraded mode).

**Acceptance criteria:**
- [ ] `memcarry recall "<prompt>"` returns a lesson that shares **zero literal keywords** with the prompt
      but is semantically on-topic (proves semantic leg works).
- [ ] With the embedder forcibly disabled, `memcarry recall` still returns keyword hits (proves degraded
      mode) and prints no error.
- [ ] Index lives under `index/`, is gitignored, and rebuilds automatically when an atom is added
      (verify: write a new atom, recall finds it without a manual reindex step).
- [ ] Precondition-gated non-matching lessons are still excluded even when semantically near.
- [ ] `duplicates` report optionally upgraded to semantic similarity (Jaccard → cosine) — or noted
      as a fast-follow.

### Item 2 — A2: Dual-recall on every UserPromptSubmit  ⭐ ambient surfacing

**What:** Make MemCarry's hybrid recall contribute `additionalContext` on **every** prompt, alongside
PAI's existing `MemoryRecall`. Today `MemDrift` only fires read-once on the first prompt.

**Design:**
- **(CLARIFIED → new sibling hook)** Add a dedicated `MemRecall` hook alongside `MemDrift` (not an
  extension of it). Keeps concerns clean: `MemDrift` = read-once drift surfacing, `MemRecall` =
  every-turn recall. Runs `memcarry recall "<userPrompt>" --project <p>` on every `UserPromptSubmit`
  and injects top-K HEADs as `<memcarry-recall>…</memcarry-recall>`.
- **Dedup at injection time — DEFERRED (decision C+, 2026-06-12).** Originally specced as source-path +
  content-hash suppression. Investigation during build found: hooks are separate processes (fs-only
  coordination); MemoryRecall fires FIRST so MemRecall could only suppress *itself* (hiding the better
  distilled claim, keeping MemoryRecall's weaker pointer — wrong direction); and collisions are
  near-zero (different stores, overlap only for file-promoted lessons) and low-harm (≤2 redundant lines).
  Not worth coupling two hooks yet. **Enabler for later:** an optional lesson `source` field (provenance)
  would make clean source-path dedup possible — not built now. Revisit if redundancy annoys in real use.
- Respect the physics budget (ARCHITECTURE.md §1): **K=5** default for MemCarry recall (matches the CLI
  `k ?? 5` default), capped so total injected memory across both systems stays ≤ ~5/turn; HEAD
  truncation already enforced by `CLAIM_DISPLAY_CAP`.
- Drift (the existing read-once behavior) stays as-is; this is **additive**, a recall channel, not a
  replacement for the drift channel.

**Acceptance criteria:**
- [ ] On the 2nd, 3rd, … prompt of a session, a relevant lesson is injected (not just the 1st).
- [~] When PAI MemoryRecall and MemCarry would surface the same fact, only one appears — DEFERRED (C+):
      double-surfacing accepted as low-harm; near-zero collision frequency. See Item 2 dedup note.
- [ ] Total injected memory context stays within the per-turn budget (K=5); the `MemRecall` hook
      returns in **< 150ms p95** on UserPromptSubmit (recall reads disk + cached index; query-embed on
      the cached model; no network) — measured against the resume hook's ~48ms baseline.
- [ ] Degrades silently if the CLI or store is unavailable.

### Item 3 — B1/I4: Resume-state reads the active PRD next-action  ✅ ALREADY BUILT

> **Re-baselined 2026-06-12: this is DONE in the live copy.** `~/.claude/hooks/MemResume.hook.ts:96`
> already calls `activePrdNextAction()` and emits `NEXT (PRD <task>): <next>` alongside MemCarry's own
> cursor (host-adapter enrichment — the PRD read lives in the PAI adapter, keeping core PAI-free).
> **Remaining work = verification only**, not implementation. Confirm the acceptance criteria hold and
> add a regression test if one doesn't exist.

**What (as built):** When a session has an active PAI WORK/PRD, the resume hook surfaces the PRD's
next-action / first unchecked ISC item alongside the mechanical cursor.

**Reuse:**
- `~/.claude/MEMORY/STATE/work.json` (active work pointer) + `~/.claude/MEMORY/WORK/*/PRD.md`
  frontmatter (`phase`, `progress: M/N`, STATUS next-action, ISC checkboxes).
- No LLM call — pure read of existing structured state.

**Design constraints:**
- resume-state and PRD are complementary: PRD = structured task ISC; resume-state = runnable cursor +
  verify-at-load. Wire: **resume reads PRD when one exists, falls back to mechanical otherwise.**
- Provenance: a PRD-derived `next` is `human-confirmed`-adjacent (you authored the PRD) — but keep it
  `auto-captured` until `/end` confirm, per the no-auto-authority rule (finding #7), unless the ISC
  item itself was user-checked.

**Acceptance criteria:**
- [ ] For a session with an active PRD, `memcarry resume <project>` shows the PRD's real next-action, not
      `[CONFIRM] continue work`.
- [ ] For a session with **no** PRD, behavior is unchanged (mechanical fallback).
- [ ] No new LLM inference is introduced on the SessionStart path (latency-safe, finding #3).

### Item 4 — H2: Re-inject memory on window compaction  ⭐ don't go cold mid-session

**What:** When the context window compacts mid-session, re-inject the active resume-state cursor + the
top recalled lessons, so a long session doesn't lose its memory context halfway through.

**Why here:** Retrieval that only fires at SessionStart/UserPromptSubmit is silently undone by
compaction. This shares A2's dedup-at-injection machinery, so it belongs in this sprint, not a separate
one. (Resolves spec open-question #5 / PROGRAM Thread B.)

**Reuse:**
- PAI's `~/.claude/hooks/PostCompactRecovery.hook.ts` + `PreCompact.hook.ts` as the pattern.
- Memcarry's existing `memcarry resume <project>` + `memcarry recall` CLI as the payload source.

**Design constraints:**
- Re-inject the **cached** resume cursor (no fresh probes — same async/no-block rule as SessionStart).
- **Dedup against what A2 already injected this turn** — reuse Item 2's injection-dedup, don't
  double-surface.
- Annotate as recovered context, not new ("resume cursor re-surfaced after compaction").

**Acceptance criteria:**
- [ ] After a forced compaction in a long session, the resume cursor + relevant lessons reappear in
      context without the user re-prompting.
- [ ] No double-injection when A2's UserPromptSubmit recall already covered the same content this turn.
- [ ] Degrades silently if no active resume-state or CLI unavailable; no blocking probes.

## Out of scope (explicitly deferred — do not build here)

- **P4 action-time triggers / P5 value-loop polynomial** — deferred until weeks of real captures exist
  (ARCHITECTURE.md §11; ROADMAP §D). Reinforcement from `ratings.jsonl` (B3/I1) is the *next* sprint,
  not this one.
- **Persona atom types (TPM/PM/QA/Engineer)** — the one genuinely net-new design dimension; deserves
  its own spec after retrieval works. Noted so it isn't lost.
- **The PAI subtraction decision** (what dies once MemCarry owns memory) — separate spec; inputs already
  exist in `NewTool/SYSTEM-DIAGNOSIS.json` (38 components), `SATURATION-CANDIDATES.json`, `DEDUP-REVIEW.json`.
- **Second AI adapter, graph edges** — phase 2+.

## Constraints that govern ALL items (from the hardened review)

1. **Atoms are the sole source of truth.** Indexes/caches are gitignored and rebuildable.
2. **Never block SessionStart or UserPromptSubmit on probes or network.** Disk + cached index only.
3. **Degrade WITHOUT CRASHING — but never silently lose context (REVISED 2026-06-12).** Embedder down →
   keyword fallback. Store/CLI down → no injection. BUT per the project rule
   [[feedback-swallow-catch-is-observability-hole]]: a catch that drops recall/resume/handoff context is
   an **observability hole**, not acceptable silence — emit a `console.error` / heartbeat line so the
   degrade is visible. Exit 0 (don't break the turn), but leave a trace. (Original "degrade silently"
   was wrong for this codebase.)
4. **Run alongside PAI v8.0** in MemCarry's own repo/store. Do not migrate the 269 files or retire
   anything until retrieval proves itself in daily use (the signal-gathering period is ongoing).
5. **Atoms must remain human-readable markdown** with the WHEN→DO→BECAUSE HEAD.
6. **Use the shared project-dir encoder (REVISED 2026-06-12).** Any code resolving a project store dir
   MUST use the canonical `encodeProjectDir`/`projectMemoryDir` (`/[^a-zA-Z0-9]/g`), never a hand-rolled
   `replace(/[/_]/g,'-')` — per [[constraint-project-dir-encoder-single-source]]. Resolution helpers
   fail loud, not fall back quiet.

## Build environment

bun 1.3.14 / node 26 · live store `~/.claude/MEMORY/memcarry/store` (set `MEMCARRY_STORE`).

**CANONICAL BUILD TARGET (CORRECTED 2026-06-12):** `~/Projects/pai-config/memcarry` — this IS the live
copy (`~/.claude` → `pai-config` symlink; live hooks invoke `${PAI}/memcarry/packages/cli/...`).
`kai/memcarry` syncs FROM pai-config. `~/Projects/NewTool/core` is a **STALE older snapshot** — do NOT
build there; it must be reconciled/retired (new task). Live hooks: `~/.claude/hooks/Mem{Resume,Drift,
Capture}.hook.ts`. jina embeddings already wired in PAI (`hooks/lib/embeddings.ts`, no API key) — the
host-side `ScoreProvider` reuses them.

## Open questions — ALL RESOLVED (2026-06-12)

1. ~~RRF vs weighted-sum fusion?~~ **RESOLVED → RRF** (parameter-free, robust at ~5 atoms). See Clarifications.
2. ~~Where does the rebuildable index live?~~ **RESOLVED → Memcarry repo `index/`** (Fork 1: core owns
   the engine + cache; portable; PAI imports later). See Clarifications + Item 1 Embeddings home.
3. ~~A2: extend `MemDrift` vs new sibling hook?~~ **RESOLVED → new sibling `MemRecall` hook.** See Item 2.
4. ~~Dedup-at-injection basis?~~ **RESOLVED → source-path + content-hash** (exact, no hot-path embedding).
5. ~~H2 re-inject on compaction?~~ **RESOLVED → folded in as Item 4.**
6. ~~C15 fork — embeddings reuse direction?~~ **RESOLVED → Fork 1** (shared engine in Memcarry core;
   PAI imports FROM it). See `PROGRAM.md` locked decisions §.
