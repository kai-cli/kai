# Phase 1 Data Model — MemCarry Retrieval Sprint

This sprint is **retrieval over existing atoms** — it adds **no new atom types** and changes the atom
schema only additively (nothing removed). Entities below are the data structures the new/modified
modules introduce. Existing types (`LessonAtom`, `ResumeStateAtom`, `Claim`, `Belief`, `VerifiableFact`)
are unchanged — see `packages/lib/src/schema.ts`.

## E1 — IndexEntry (vector cache)  · `index-cache.ts`

One cached embedding per atom. Cache is gitignored, rebuildable, NOT a source of truth.

| Field | Type | Notes |
|---|---|---|
| `atomId` | string | matches `Atom.id` |
| `contentHash` | string | hash of the exact embedded text (claim+triggers); invalidates on edit |
| `vector` | number[] | length = `dim` (512) |

**Cache file header** (once per cache file):
| Field | Type | Notes |
|---|---|---|
| `model` | string | `Xenova/jina-embeddings-v2-small-en` — mismatch ⇒ full rebuild |
| `dim` | number | 512 |

**Rules:** lookup by (`atomId`, `contentHash`); miss or hash-mismatch ⇒ embed + write-through. Header
`model` mismatch ⇒ discard entire cache, rebuild. Lives at repo `index/` (gitignored).

## E2 — ScoredHit (recall output)  · `recall.ts`

Extends today's `RecallHit` with the fused score components (for debuggability/observability).

| Field | Type | Notes |
|---|---|---|
| `id` | string | atom id |
| `scope` | string | `global` \| `project:<name>` |
| `claim` | string | rendered `WHEN→DO→BECAUSE` (DISPLAY surface; ≤ `CLAIM_DISPLAY_CAP`) |
| `keywordRank` | number \| null | rank in keyword list (null if absent) |
| `semanticRank` | number \| null | rank in semantic list (null if absent / embedder down) |
| `rrfScore` | number | fused score = Σ 1/(60+rank) |
| `expand_when` | string? | carried from atom (unchanged) |

**Rules:** precondition gate (`when`) runs **before** scoring (R5) — gated-out atoms never appear.
Sorted by `rrfScore` desc, sliced to top-K (default 5). If embedder unavailable, `semanticRank=null`
for all and `rrfScore` reduces to the keyword-only ranking (degraded mode, R2/finding #2).

## E3 — InjectionRecord (dedup basis)  · `dedup-inject.ts` — ⏸️ DEFERRED (decision C+, 2026-06-12)

> NOT BUILT. Cross-system dedup deferred: hooks are separate processes, MemoryRecall fires first (so
> MemRecall could only suppress itself — wrong direction), collisions near-zero + low-harm. Enabler
> (a lesson `source` field) noted for later. See spec.md Item 2 dedup note + tasks T017. Structure
> below kept as the design-of-record for if/when it's revisited.

Represents one piece of memory content surfaced this turn, by either system.

| Field | Type | Notes |
|---|---|---|
| `sourcePath` | string \| null | originating file path (primary match key) |
| `contentHash` | string | hash of surfaced text (fallback match key) |
| `system` | `"memcarry"` \| `"memoryrecall"` | which system surfaced it |

**Rules:** a MemCarry hit is suppressed if an existing record (from `memoryrecall`) shares `sourcePath`,
else shares `contentHash`. No embedding. If the "what MemoryRecall injected" source is unavailable this
turn, dedup is a no-op (safe fallback — at worst a duplicate line).

## E4 — PrdNext (resume next-action source)  · `prd-read.ts`

Result of reading the active PRD, consumed by `capture.ts` for the resume cursor.

| Field | Type | Notes |
|---|---|---|
| `found` | boolean | false ⇒ caller uses mechanical `[CONFIRM] continue work` |
| `next` | string \| null | STATUS next-action, or first unchecked ISC `- [ ]` text |
| `prdPath` | string \| null | `~/.claude/MEMORY/WORK/<dir>/PRD.md` |
| `iscUserChecked` | boolean | true only if the source ISC item was user-checked ⇒ may skip auto-captured downgrade |

**Rules:** resolve active PRD via `STATE/work.json`; parse PRD frontmatter + STATUS + ISC checkboxes.
Pure read, no LLM (R8). Provenance of a PRD-derived `next` stays `auto-captured` until `/end` confirm
unless `iscUserChecked`.

## Relationships

```
Atom (existing, sole truth)
  │  embed(claim+triggers)            ┌─ IndexEntry (E1, cached vector, gitignored)
  ├──────────────────────────────────┘
  │
  └─ recall() ── precondition gate ──► keyword rank ┐
                                       semantic rank ┘─ RRF ─► ScoredHit (E2) ─► top-K HEADs
                                                                                    │
                          MemoryRecall injections ─► InjectionRecord (E3) ─ dedup ─┤
                                                                                    ▼
                                                                          <memcarry-recall> context

ResumeStateAtom.next ◄── PrdNext (E4) when active PRD exists, else mechanical fallback
```

## Schema impact

- **No new atom types.** `LessonAtom` / `ResumeStateAtom` unchanged.
- **Additive only:** new derived structures (E1–E4) live in new modules; no field removed from any atom.
- Backward compatible: existing atoms recall correctly; missing cache ⇒ rebuilt; missing PRD ⇒ fallback.
