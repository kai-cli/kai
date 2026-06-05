# Memcarry — Plan & PAI Integration Strategy

> **Home:** pai-config `docs/planning/` (PRIVATE — not synced to KAI, so this may reference real
> workflow freely). Canonical forward plan. Mirrors `~/Projects/NewTool/ROADMAP.md` (dev copy).
> **Status:** MVP live in PAI (committed + pushed). Signal-gathering period in progress.

---

## 0. The decision on the table: standalone vs. fully integrated into PAI

We built Memcarry **standalone** (own repo, vendored into pai-config) for two good reasons:
portability ("beside any AI") and the safety rule (don't touch the 269-file store during the trial).
But it is now **intrinsically PAI-linked**: it runs as PAI hooks, and every roadmap integration
(reads `ratings.jsonl`, PRDs, the jina embedding index, SessionEndComposite) ties it tighter. The
question: keep the seam, or dissolve it?

### What already overlaps (the case FOR integration)
- PAI has **`memory-scorer.ts`** (recency/frequency/importance/relevance, 30-day half-life) — this is
  *most of* Memcarry's deferred value-loop, already written.
- PAI has **`memory-disclosure.ts`** (3-layer INDEX/TIMELINE/DETAIL) — a tiering model parallel to
  Memcarry's HEAD/DETAIL atoms.
- PAI has **278 unstructured `.md` memories** + MemoryRecall; Memcarry has structured atoms. The
  roadmap's A1/A2/A3 already plan to interlink them.
- Building B3 (reinforce from ratings) means Memcarry depends on PAI internals anyway.

### What argues AGAINST full dissolution (the case to KEEP a seam)
- **Portability** was a founding goal ("usable for any AI, like Hermes"). Dissolving into PAI hooks
  kills the standalone/KAI-public/other-AI story.
- **Clean test surface** — the vendored core has 26 isolated tests; merging into PAI's 1689-test
  suite + shared libs raises coupling and blast radius.
- The **public KAI** release wants a self-contained unit, not something fused into PAI's guts.

### RECOMMENDATION: "Integrated core, portable engine" (the seam moves, doesn't vanish)
Don't choose standalone-OR-absorbed. Restructure so the **engine stays a standalone library** and
**PAI becomes its first-class host**, sharing infrastructure rather than duplicating it:

```
   @memcarry/lib  (standalone engine — schema, store, probes, verify, recall)
        │  pure, portable, its own tests, no PAI imports
        ├── consumed by PAI adapters (hooks) ──► uses PAI's scorer/embeddings/ratings via INJECTION
        └── consumed by KAI / other AIs ───────► uses their own (or built-in) equivalents
```

Concretely:
- The **engine never imports PAI**. Instead, PAI-specific capabilities (the jina index, ratings
  signal, PRD next-action, memory-scorer) are passed IN as adapters/providers. PAI wires its real
  ones; KAI/others wire stubs or their own.
- **Unify the SCORER:** Memcarry's deferred value-loop should NOT be rebuilt — it should *delegate*
  to PAI's `memory-scorer.ts` when hosted in PAI (via the provider seam). One scorer, two memory
  shapes feeding it.
- **Unify the STORE location** but not the format: Memcarry atoms live under `MEMORY/memcarry/`
  alongside PAI's `MEMORY/LEARNING` etc. — one memory tree, distinct typed regions.
- The result IS "fully integrated" from the user's view (one memory system, one scorer, one tree)
  while preserving the portable engine underneath. Best of both; reverses nothing already shipped.

**Decision needed from user** (see §6) before building the provider seam — it's a one-time refactor
that shapes everything after.

---

## A. Memcarry ↔ MemoryRecall interlinking
*(unchanged from ROADMAP.md — the two systems are complementary; wide net + sharp tool)*
- **A1 Ingestion:** promote USED cross-project matches (MemoryRecall hit + good rating) into structured lessons.
- **A2 Dual-recall:** run `memcarry recall` on EVERY UserPromptSubmit alongside MemoryRecall, with
  dedup-at-injection (suppress if MemoryRecall already surfaced the same source). *Simplest first step
  once the store has real lessons.*
- **A3 Dedup→global:** cross-project-index flags knowledge in 3+ projects as global-lesson candidates.

## B. Harness existing PAI systems
- **B1** resume reads active PRD next-action (free fix for 45%-shallow; buildable now).
- **B2** reuse jina embeddings (`semantic-fallback.ts`) for recall + dedup.
- **B3** reinforce atoms from `ratings.jsonl` → **delegate to `memory-scorer.ts`** (don't rebuild). Needs signal.
- **B4** fold MemCapture into `SessionEndComposite` (shares its trivial-session gate = F1).
- **B5** emit `memcarry.*` on the `events.jsonl` bus (retire heartbeat.jsonl).
- **B6** wire `memcarry confirm` into the `/end` skill.

## C. Hardening
- **H2** re-inject resume on compaction (PostCompactRecovery). **H4** auto-derive repo slug (`git remote`).
- **H1** index cache. **H3** archival sweep as weekly cron (co-locate with A3 dedup scan).

## D. Do NOT build yet
P4 action-time triggers; full P5 polynomial (use PAI scorer instead); 2nd AI adapter; graph edges.

---

## 4. Signal Log (observe during real use — fill in)
| Question | Check | Finding |
|---|---|---|
| Warm-resume saves re-explaining? | next cold start | _TBD_ |
| Auto-`next` good vs needs edit? | each session | _TBD_ |
| % non-git projects (degraded) | "_detached" ids | ~44% (measured) |
| False-drift ever? | `<memcarry-drift>` blocks | _TBD_ |
| Lessons worth promoting global? | `memcarry duplicates` weekly | _TBD_ |
| All 3 hooks firing? | tail heartbeat.jsonl | resume ✓ (Du, AIrouter) |

## 5. Build order (when signal says go)
1. **B1 + B2 + H2 + H4** — buildable now, not signal-blocked.
2. **The provider-seam refactor** (if §0 approved) — before B3, since B3 delegates to PAI's scorer.
3. **A2** dual-recall — once store has real lessons.
4. **B3 + A1** — once weeks of rated sessions exist.
5. **A3 + H3** — one weekly cron. **B4 + B5** — observability/robustness.

## 6. Open decisions
- [ ] **§0 integration model:** approve "integrated core, portable engine" (provider seam) vs keep
  fully standalone vs fully absorb-into-PAI? *(shapes the refactor)*
- [ ] Reconcile with the **parallel PAI memory work** (cross-project fixes + weekly cron + `/curate`
  skill, committed locally) — A2/A3/H3 must reuse that plumbing, not duplicate. Confirm overlap first.
- [ ] Unify scorer now (B3) or keep Memcarry's own simple `last_used+use_count` until proven?

---

## Cross-reference
- Dev repo: `~/Projects/NewTool/` — `ARCHITECTURE.md`, `ROADMAP.md`, `INTEGRATION-OPPORTUNITIES.md`,
  `SMOKE-FINDINGS.md`, `PHASE-MINUS-1-FINDINGS.md`, `core/` (engine + 26 tests).
- Live: vendored at `~/.claude/memcarry/`, hooks `Mem{Resume,Drift,Capture}`, store `MEMORY/memcarry/store/`.
