# Phase 0 Research — MemCarry Retrieval Sprint

All NEEDS CLARIFICATION resolved (most via the `/clarify` session; remainder grounded here against the
live code + PAI infra). Format: Decision / Rationale / Alternatives.

## R1 — Fusion method: RRF

**Decision:** Reciprocal-rank fusion. For each atom, `score = Σ 1/(k + rank_i)` over the keyword
ranking and the semantic ranking (standard `k=60`). Atoms absent from a list contribute 0 for that list.

**Rationale:** Parameter-free — no weights to calibrate, which matters because the store has ~5 atoms
(no data to fit weights to; a weighted sum would be false precision). RRF naturally preserves
exact-identifier wins: an atom ranked #1 by keyword fuses high regardless of its semantic score, so
`M62CF-EU` / `issue #248` style hits aren't drowned by semantic noise (the spec's stated risk). Robust
and order-of-magnitude stable as the store grows.

**Alternatives considered:** (a) Weighted-sum of normalized keyword + cosine — rejected: needs weights
+ scale normalization with no data to tune them. (b) A/B both behind a flag — rejected: more code now,
defers a call that's cheap to revisit later since RRF is a 10-line function.

## R2 — Embedding engine home: Memcarry core (Fork 1)

**Decision:** Implement `embeddings.ts` (`embed(text): Promise<number[]|null>`, lazy model load) and
`similarity.ts` (`cosineSimilarity`) **inside `@memcarry/lib`**. Port logic from PAI's
`hooks/lib/embeddings.ts` + `similarity.ts` as a reference; do **not** import from `~/.claude`.

**Rationale:** Locked decision Fork 1 (PROGRAM §2): the shared engine lives in Memcarry core so Memcarry
stays portable ("beside any AI") and PAI imports FROM it during W1 cleanup — inverting today's
re-implementation (finding C15). Importing from PAI would couple Memcarry to a `~/.claude` install and
break portability. Model `Xenova/jina-embeddings-v2-small-en`, dim 512, no API key — identical to PAI
so vectors are comparable when the engines later converge.

**Alternatives:** Import PAI libs now / share PAI's `index.jsonl` — both rejected for coupling +
portability per the locked fork.

## R3 — Index cache: gitignored, atom-keyed, rebuild-on-miss

**Decision:** Vector cache at Memcarry repo `index/` (already exists, empty). One entry per atom keyed
by `id + content-hash` of the embedded text. On recall: for each candidate atom, look up vector by
(id, hash); on miss or hash-mismatch, embed and write-through. Cache header pins `model` + `dim`; a
model-id change invalidates the whole cache (clean rebuild). `index/` stays in `.gitignore`.

**Rationale:** Atoms are sole source of truth (finding #13); the cache is pure derived data. Content-hash
keying means editing an atom auto-invalidates its stale vector (acceptance criterion: "write a new atom,
recall finds it without a manual reindex"). Write-through on miss = no separate reindex step.

**Alternatives:** Persist vectors in atom frontmatter — rejected: pollutes the human-readable atom +
couples truth to a model. Full reindex on every write — rejected: needless at scale.

## R4 — Embedded text: rendered claim + triggers

**Decision:** Embed `renderClaim(claim)` (`WHEN…→DO…BECAUSE…`) concatenated with `trigger[]` tokens,
not triggers alone.

**Rationale:** Mirrors Anthropic Contextual-Retrieval finding — a contextual header lifts both recall
legs. The full claim carries the semantics; triggers carry the exact identifiers. Embedding both gives
the semantic leg real signal instead of a bag of keywords.

**Alternatives:** Embed triggers only (today's match surface) — rejected: too sparse for semantics.
Embed the DETAIL body — rejected: DETAIL is on-demand and would dilute the HEAD-level match.

## R5 — Precondition gate precedence over semantic score

**Decision:** The existing `when`-precondition gate in `recall.ts` runs **before** fusion. A lesson
whose precondition clearly doesn't apply is excluded and does not consume the top-K budget — even if its
semantic similarity is high.

**Rationale:** Finding #12. Semantic similarity ≠ applicability; a lesson about Jenkins builds is
semantically near a Jenkins question but must not fire when its `when` (e.g. "editing a .patch file")
doesn't hold. The gate is a correctness guard, not a ranking signal.

**Alternatives:** Let semantic score override the gate — rejected: reintroduces wrong-moment injection
(failure mode #1, the very thing we're fixing).

## R6 — A2 hook: new sibling `MemRecall`

**Decision:** New `MemRecall.hook.ts` on `UserPromptSubmit`, separate from `MemDrift`.

**Rationale:** Clean separation of concerns — `MemDrift` = read-once drift surfacing (consumes the async
verify file), `MemRecall` = every-turn recall. Independently testable; neither's failure masks the
other. (The eventual I3/B4 SessionEndComposite-style consolidation is a *cleanup-spec* concern, not this
sprint's — premature merging here would couple two different lifecycles.)

**Alternatives:** Extend `MemDrift` — rejected: mixes read-once + every-turn lifecycles in one hook.

## R7 — Injection dedup: source-path + content-hash

**Decision:** `dedup-inject.ts` suppresses a MemCarry recall hit when PAI's `MemoryRecall` already
surfaced the same content this turn. Match on originating **source path**; fall back to **content hash**
of the surfaced text. No embedding call in the injection path.

**Rationale:** Exact + deterministic + cheap (the hot path must stay fast, finding #2/#3). Most dupes are
literally the same source file (the proven `never-hand-edit-patches` case lived as the identical file in
two projects). Detecting that needs path/hash, not semantics.

**Open detail for tasks:** how MemCarry reads "what MemoryRecall injected this turn" — likely a small
shared per-turn marker (e.g. PAI writes injected source paths to a per-session scratch the recall hook
reads). Resolve in tasks; fallback is no-dedup (at worst a duplicate line, not a correctness bug).

**Alternatives:** Semantic near-dup — rejected: adds an embed call to every turn. Cascade (exact then
semantic) — deferred: start exact-only, add semantic later if real dupes slip through.

## R8 — Item 3 PRD read: parse work.json + PRD frontmatter, no LLM

**Decision:** `prd-read.ts` resolves the active PRD via `~/.claude/MEMORY/STATE/work.json` (active-work
pointer / session map) → `~/.claude/MEMORY/WORK/<dir>/PRD.md`. Extract `next` from the STATUS
next-action or the first unchecked ISC checkbox (`- [ ]`). `capture.ts` uses it for resume `next` when
present; mechanical `[CONFIRM] continue work` otherwise. Provenance stays `auto-captured` until `/end`
confirm unless the ISC item was user-checked.

**Rationale:** Pure structured read — no inference on the SessionStart path (finding #3, latency-safe).
Kills most of the measured 45%-shallow problem for the PRD-backed sessions. PRD format is known
(MEMORYSYSTEM.md §WORK: frontmatter + STATUS + ISC checkboxes).

**Alternatives:** LLM-draft the next from the PRD — rejected: adds latency + a deferred dependency;
the structured next-action is already authored.

## R9 — Item 4 compaction hook: PostCompact re-inject

**Decision:** `MemCompact.hook.ts` on the post-compaction event (pattern from PAI
`PostCompactRecovery.hook.ts`). Re-inject the **cached** resume cursor (`memcarry resume`, no fresh
probes) + top recall hits for the last prompt, annotated as recovered. Reuse `dedup-inject.ts` so it
doesn't double-surface what `MemRecall` already injected this turn.

**Rationale:** Compaction silently drops earlier-injected memory (the gap). Re-inject from cache only —
same no-block rule as SessionStart. Dedup shared with A2 (why H2 belongs in this sprint, not a separate
one).

**Alternatives:** Re-run full verify-at-load on compaction — rejected: blocking probes on a mid-session
event; cached cursor is sufficient.

## Resolved unknowns summary

| Unknown | Resolution |
|---|---|
| Fusion | RRF, k=60 (R1) |
| Embeddings home | `@memcarry/lib` (Fork 1) (R2) |
| Cache strategy | gitignored, id+hash keyed, rebuild-on-miss (R3) |
| What to embed | rendered claim + triggers (R4) |
| Gate vs semantic | gate first, always (R5) |
| A2 hook shape | new `MemRecall` sibling (R6) |
| Dedup basis | source-path + content-hash (R7) |
| PRD read | structured parse, no LLM (R8) |
| Compaction | PostCompact re-inject from cache + dedup (R9) |

**No NEEDS CLARIFICATION remain.** One implementation detail (R7: the cross-hook "what was injected"
marker) is flagged for `/speckit-tasks` with a safe no-dedup fallback.
