# Memory Architecture Plan — the consolidated, decoupled memory track

> **Status:** DECIDED · build-ready · created 2026-06-21 · **the single source of truth for memory work.**
> Decoupled from `ROADMAP-7.x.md` by explicit decision (2026-06-21): *"segregate it… focus on
> fixing memory and ignore everything else until memory is solid."*
>
> This doc owns the memory track end-to-end: what we want, what exists (PAI / memcarry / Claude
> native), the rearchitecture question, the recommendation, and the phased path. All memory items
> in ROADMAP-7.x.md now point HERE rather than duplicating.
>
> **The two gating decisions are now MADE (2026-06-21, see §6):** D1 = relocate-only with an exit
> criterion · D2 = Option 3 now → Option 5 *conditionally* (on a two-shape drift signal, else stop at
> Opt 3) · D2-sub = markdown-as-truth.
> Build still follows the §7 phased path; the Phase-0 capture-loss guard proceeds regardless.

---

## 0. Why this doc exists

Memory work was scattered across three roadmap homes (7.4.0 spine, 7.7.0 Knowledge Cascade,
signal-blocked memcarry) plus four design docs. Worse, a **native Claude Code feature (Auto Memory)
landed underneath us** and writes to the *same directory* PAI treats as human-curated. We cannot
make good per-item decisions while the systems overlap and the foundation is unsettled.

So: stop the piecemeal roadmap entries, pull the whole picture into one place, decide the
architecture, then execute a focused track. **Memory is the priority until it's solid; everything
else waits.**

The stakes are concrete: the **rayhunter incident** (2026-06-17) lost 9 days of operational
knowledge to a memory-routing failure that was *invisible* because there was no telemetry. "A
memory system you can't observe is one you can't trust." This plan treats observability and safety
as first-class, not afterthoughts.

---

## 1. What we want from memory (the desired end-state)

Independent of any current implementation — these are the capabilities, ranked by the pain they kill.

1. **Never lose what we learn** (TOP — the rayhunter lesson). Every learning lands in the right
   project, survives compaction, and is provably saved. No silent routing failures.
2. **Never re-explain how to resume a project** (TOP). Start a session and the prior state,
   next-action, and open threads are already loaded — verified against reality, not stale.
3. **Never re-learn a cross-project lesson** (TOP — proven by duplicate lesson files). A lesson
   learned in one repo is recalled in another when relevant.
4. **Stop re-teaching domain conventions** (the ADA #1 pain). Repo branch targets, naming, check-in
   procedures activate automatically (this is ADA — see relationship in §7; ADA is the *activation*
   layer that sits on top of this memory foundation).
5. **Recall is relevant, not noisy.** Semantic, not keyword-only (the confirmed 33% miss). Surfaced
   memories are trustworthy; stale/wrong memory is worse than none.
6. **Learning actually changes behavior.** A captured correction provably prevents the repeat error
   — the loop is closed and measured, not just logged.
7. **Knowledge stays coherent across locations.** A fact learned once doesn't rot in 5 of the 6
   places it lives (the Knowledge Cascade problem).
8. **The whole thing is observable.** Recall hit-rate, save-events-per-project, capture latency are
   visible so we can prove any change helped (and would have made rayhunter visible on day 1).
9. **Portable, not Claude-locked** (memcarry's founding goal — **kept**: D2 chose Opt 3→Opt 5, both
   of which preserve the standalone engine).
10. **Safe by construction.** No deletion-as-cleanup of curated memory (rayhunter failure class);
    additive + telemetry-measured changes only.

---

## 2. What exists today — three systems in parallel

### 2A. Claude Code **native Auto Memory** (the new variable)
- **ON by default**, v2.1.59+; we run **2.1.183** with no disable set → live now.
- Default directory is literally **`~/.claude/projects/<project>/memory/`** (confirmed via
  claude-code-guide against official docs) — entrypoint `MEMORY.md` + Claude-named kebab-case topic
  files. Claude writes when it judges something worth keeping; loads first 200 lines / 25 KB at
  session start with **no hook required**.
- **Does NOT touch `CLAUDE.md`** (you write those). **Captures, does NOT consolidate/dedup/resolve
  contradictions** — the "Dreams/AutoDream" pipeline WARP described does **not exist** natively (that
  behavior is PAI's own InstinctCapture/MemoryCurate, misattributed).
- **Live state (verified 2026-06-21): it has written NOTHING yet** — **zero files lacking PAI's
  frontmatter schema** across all 375 memory `.md` files.
  - **⚠️ Detection caveat (WARP, verified in source):** "PAI-named vs native-named" is NOT a valid
    discriminator. PAI and native produce **structurally identical** output in the same dir — a
    `MEMORY.md` entrypoint plus kebab-case topic files with `[title](file.md)` links.
    `memory-disclosure.ts` parses exactly that index format; `MemoryCurate.ts:343` *writes* exactly
    that `- [title](file.md) — …` entry. The **only reliable signal is PAI's frontmatter schema**
    (`metadata.node_type: memory`, `originSessionId`, `source: auto-generated`). The concrete
    native-detection test is therefore: **a topic file with NO PAI frontmatter, or a `MEMORY.md`
    mutation not attributable to MemoryCurate** — not a filename pattern. (The 2026-06-21 sweep that
    found zero native files already used the frontmatter signal, so the conclusion holds; the doc's
    earlier "native-named" phrasing was the error.)
- **The collision:** PAI hooks (`memory-disclosure.ts`, `LoadContext`, `MemoryRecall`) treat that
  path as **read-only / human-curated**. If native starts writing `MEMORY.md` + topic files there,
  two writers share one tree. The docs do not address coexistence with a custom memory system.
  **This is now mitigated** — native is relocated to a separate `autoMemoryDirectory` (§7 Phase 0,
  applied 2026-06-21).
- Settings: `autoMemoryEnabled` (default true), `autoMemoryDirectory` (relocatable),
  `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`.

### 2B. **PAI memory stack** (the hand-built incumbent)
Mature, broad, mostly wired. Live map (verified 2026-06-21):

| Component | Type | Event / status |
|---|---|---|
| `LoadContext` | hook | SessionStart — injects relationship/learning/work + 3-layer index |
| `MemoryRecall` | hook | UserPromptSubmit — PAI project MEMORY.md, keyword + `memory-scorer` (flag-gated `useScorer`) |
| `LocalContextFirst` | hook | UserPromptSubmit — domain routing; embeddings fallback (the ADA T3 defect lives here) |
| `InstinctCapture` | hook | UserPromptSubmit — correction/repeat/low-rating → instincts.jsonl |
| `PreCompact` / `PostCompactRecovery` | hook | PreCompact / SessionStart(compact) — checkpoint + re-inject |
| `RelationshipMemory` | hook | SessionEnd (via SessionEndComposite) |
| `KnowledgeSync` | hook | **ORPHANED** — file exists, not registered |
| `MemoryTimeline` | hook | **ORPHANED** — not wired to any event; timeline read on-demand only |
| `memory-disclosure.ts` | lib | 3-layer INDEX/TIMELINE/DETAIL, eviction scoring (age + refcount) |
| `memory-scorer.ts` | lib | recency/frequency/importance/relevance composite; **only if `useScorer`** |
| `embeddings.ts` / EmbeddingIndex | lib/tool | jina `Xenova/jina-embeddings-v2-small-en`; ~3514 chunks; weekly rebuild wired |
| `KnowledgeHarvester` / `KNOWLEDGE/` | tool/dir | cross-project distillation, injected by LoadContext |
| `MemoryCurate` / `AutoConsolidate` / `KnowledgeHealth` / `CrossProjectIndex` | tools | curation, dedup, health, cross-project index (CrossProjectIndex **exists, not surfaced in recall**) |
| `LEARNING/` | dir | ratings, instincts, reflections, FAILURES full-context dumps |

- **Scale:** 324 frontmatter project-memory files across 32 project dirs.
- **Known gaps:** keyword-only recall by default (SF-3, 33% miss); CrossProjectIndex built but not
  wired into recall; agent-harvesting missing (subagents can't save — parent must, via PostToolUse
  `Task`); 2 orphaned hooks.

### 2C. **Memcarry** (the portable engine)
- Standalone repo (`~/Projects/NewTool/`, private GitHub `DevenDucommun/memcarry`), vendored at
  `~/.claude/memcarry/`. Engine + CLI + (dropped) MCP; 26–60 lib tests.
- **Store is GIT-TRACKED** (corrected — an agent audit wrongly called it gitignored):
  **35 atoms** = 30 global lessons (WHEN→DO→BECAUSE, ≤500-char HEAD + DETAIL) + 5 project
  resume-states (kai, AIrouter, feed-bbf, NewTool, Du_tracking).
- Hooks: `MemResume` (SessionStart, shells `resume`), `MemRecall` (UserPromptSubmit, hybrid
  keyword+semantic `recallLessons`), `MemDrift`, `MemCapture` (Stop, shells `capture`),
  `PostCompactRecovery` re-resume.
- **Cross-project cycle is CLOSED + populated:** 003 retrieval (RRF recall), 004 backflow
  (`refine`, human-confirmed), 005 capture (`capture-lesson`). Signal-gathering period.
- **Deferred (signal-blocked, not code-blocked):** B3 reinforcement from ratings, A1 ingestion,
  dup-threshold tune — all need weeks of rated use.

---

## 3. The overlaps and tensions (why this needs a decision, not just tidying)

| Concern | PAI | Memcarry | Native | Tension |
|---|---|---|---|---|
| **Recall on UserPromptSubmit** | MemoryRecall (MEMORY.md, keyword) **+** LocalContextFirst (38MB semantic index, on routing-miss) | MemRecall (35 atoms, semantic) | loads MEMORY.md at start | **Three recall-ish reads fire per turn** (§4) — distinct sources, overlapping intent, shared budget. LocalContextFirst's read is bounded by routing-misses, not every prompt (R-perf) |
| **Tiering** | 3-layer disclosure (INDEX/TIMELINE/DETAIL) | HEAD/DETAIL atoms | 200-line MEMORY.md cap | Parallel models of the same idea |
| **Value/relevance scoring** | `memory-scorer.ts` (rich, flag-gated **off** by default) | own `last_used+use_count`; plan says *delegate to PAI scorer* | none | Memcarry explicitly wants PAI's scorer — duplication if not unified |
| **Embeddings** | jina index, consumed by LocalContextFirst | `memcarry-semantic.ts` over same seam | none | One index, two consumers — fine, but un-unified scoring |
| **Capture / write** | hooks → LEARNING/, project memory | `capture-lesson` → atoms | writes MEMORY.md + topic files | **Three writers**; native *would* contend for PAI's dir — **now mitigated** by relocate (§2A/§7 Phase 0) |
| **Consolidation** | MemoryCurate/AutoConsolidate | — | **none** (despite WARP's claim) | PAI is the only consolidator; native won't do it |
| **Cross-project transfer** | KnowledgeHarvester→KNOWLEDGE/, CrossProjectIndex (unwired) | global lessons (working) | none | Two mechanisms, one wired one not |

**The core architectural fact:** PAI and memcarry are *already converging* (memcarry-plan §0 lists
the overlaps and proposes a provider seam). Native Auto Memory is a *third* writer that nobody
designed for. The question isn't "are they redundant" — it's **"what is the single intended shape,
and who owns each layer."**

### ⚠️ The MemoryCurate cross-writer hazard (WARP, verified in source — rayhunter-class)
`MemoryCurate.scanAllMemoryFiles()` (`MemoryCurate.ts:130-131`) globs **every** `.md` in each
`projects/*/memory/` dir except `MEMORY.md` with **no authorship filter**, flags stale files, and
`archiveFile()` (`:205`) `renameSync`s them out. So the moment native Auto Memory writes a topic
file into that shared tree, PAI's staleness sweep treats it as a curation candidate — a native file
PAI never authored could be archived as "stale." That is the rayhunter loss class (a sweep moving
files it shouldn't), applied to a *new* writer the safety rules never anticipated.
- **Severity, accurately:** the archive is **human-gated, not silent** — `interactiveStale()`
  (`:436-444`) prompts per file `[a]rchive [k]eep [s]kip [q]uit`, and `pai curate` is **manually
  triggered** (weekly-maintenance only *nudges* it). So this is not an autonomous deletion loop. The
  real exposure: a human rubber-stamping `[a]` on a kebab-named file they don't recognize as
  native-authored — exactly the misclassification the detection caveat above warns about.
- **The clean fix is structural, not vigilance:** relocate native out of the scanned tree entirely
  (§7 Phase 0). Once `autoMemoryDirectory` is a separate path, native files are never in
  MemoryCurate's glob — the hazard is removed by construction, not by careful clicking.

---

## 4. The rearchitecture question — five options

The user asked directly: *do we need memcarry? roll it into PAI? or pull more out of PAI into
memcarry? look at all angles.* Here are five coherent end-states (Options 1–4 are the original
framing; **Option 5 added 2026-06-21** as the convergence target the others stop short of).

### Option 1 — **Absorb memcarry into PAI** (dissolve the seam)
Memcarry's atoms/recall/resume become PAI hooks + libs; the standalone repo retires.
- ✅ One codebase, one test suite, no vendoring, no shell-out latency.
- ✅ Direct access to PAI scorer/embeddings/ratings — no provider injection.
- ❌ **Kills portability** (memcarry's founding goal — "beside any AI"). No KAI-public/other-AI story.
- ❌ Throws away the clean standalone test surface; raises PAI blast radius.

### Option 2 — **Pull more PAI memory logic INTO memcarry** (memcarry becomes the core)
Memcarry becomes the canonical memory engine; PAI keeps only Claude-specific glue.
- ✅ Strongest portability; the engine is the product.
- ✅ Forces the clean schema/typed-atom discipline across all memory.
- ❌ **Huge migration** of 324 memories + LEARNING/ + KNOWLEDGE/ into atom shapes — high blast radius,
   exactly the kind of sweep the rayhunter rules warn against.
- ❌ PAI's rich curation/health/failure-capture tooling would have to move or be re-pointed; months.

### Option 3 — **"Integrated core, portable engine"** (the provider seam — memcarry-plan §0 recommendation)
Engine stays a standalone library that *never imports PAI*; PAI becomes its first-class host,
**injecting** its scorer/embeddings/ratings as adapters. One memory tree, one scorer, two atom
shapes. From the user's view it's "one memory system"; underneath the portable engine survives.
- ✅ Best-of-both: integrated UX + preserved portability; **reverses nothing already shipped.**
- ✅ Unifies the scorer (memcarry delegates to `memory-scorer.ts`) — kills the duplication.
- ✅ Incremental, low blast radius — it's a seam refactor, not a data migration.
- ❌ Requires building the provider seam (one-time refactor) before B3.
- ❌ Two atom shapes coexist — conceptual overhead remains.

### Option 4 — **Status quo: parallel systems, leave the seam implicit**
Keep MemoryRecall + MemRecall + LocalContextFirst all firing on UserPromptSubmit, no unification.
- ✅ Zero work.
- ❌ Permanent duplication (three recall-ish reads, two scorers, two tiering models); the convergence
   tension never resolves; native collision still unaddressed. **Not a real answer to "make it solid."**

### Option 5 — **One memory service: typed-atom canonical store + single retrieval pipeline** (the convergence target)
A fifth end-state the four above don't name (WARP, 2026-06-21). Make **memcarry's typed atom the
canonical record** (generalized to cover lesson / resume-state / project-fact / relationship), behind
**one store with a real index** (pragmatically a single SQLite file: FTS5 for keyword + a vector table
for semantic), with **one retrieval pipeline** (keyword/trigger candidate-gen → semantic rerank →
precondition gate → budget) consumed by every surface (SessionStart, per-prompt, subagent harvest).
`MEMORY.md`, native files, and `KNOWLEDGE/` become **projections** of the store, never parallel
sources of truth.
- ✅ Removes the *actual* fragility sources at once: keyword-only recall (the 33% miss), multi-writer
  file contention, and the `memory-meta.jsonl` sidecar drift — and Phase-1 telemetry falls out nearly
  for free (the store is a queryable event log).
- ✅ Promotes memcarry's best asset (structured `when/do/because` + precondition gate, verified in
  `recall.ts`) to the canonical model instead of leaving it as one of two shapes.
- ✅ Preserves portability the same way Opt 3 does (store + engine stays a standalone lib).
- ⚠️ **Sounds like the migration Opts 1/2 were rejected for — but need not be.** Done
  **projection-first / additive**: new writes go to the atom store from day one; the 324 existing
  memories are **indexed in place via a read adapter** (never bulk-rewritten or deleted); promotion of
  an old memory to a typed atom is lazy, on-access, human-confirmed (memcarry's existing `refine`
  backflow). That satisfies the same rayhunter safety constraint used to reject Opts 1/2.
- ❌ Larger build than Opt 3; introduces a new storage substrate (SQLite) to operate and back up.
- **Relationship to Opt 3:** Opt 3 is the safe stepping stone (logical unification over two shapes);
  Opt 5 is the end-state (one shape, one store). Opt 3's deliberate "two atom shapes" is exactly the
  residual liability Opt 5 removes — so **Opt 3 → Opt 5 is a coherent sequence, not a competing fork.**
  Verified against the live recall path (2026-06-21): **three recall-ish reads fire on
  UserPromptSubmit today** — (1) `MemoryRecall` over PAI `MEMORY.md` (keyword + optional scorer),
  (2) `MemRecall` over the 35 memcarry atoms via `memcarry-semantic.ts` (`recallLessons`, tiny/cheap),
  and (3) `LocalContextFirst`'s Feature-C semantic fallback via `semantic-fallback.ts` over the 38MB
  PAI embeddings index (the heavy read — see R-perf). Opt 3 unifies the *scorer* behind them; Opt 5
  unifies the *stores* and collapses the three reads into one pipeline. You cannot collapse to one
  pipeline (5) before the scorer/embeddings inject through one seam (3) — Opt 3 is literally the first
  half of Opt 5's work. (Three independent reads makes the unification case *stronger* than "two.")

> **Two technical realities that must be named honestly (verified 2026-06-21, not assumed):**
>
> **R1 — Vector search is NOT uniformly "free" the way FTS5 is.** `bun:sqlite` ships **FTS5
> (keyword) built-in** (verified working, zero deps) — but ANN vector search is not built in. Two
> real paths, both viable, neither a blocker:
> - **(a) brute-force cosine over a vectors table** — exactly what we do *today* (`cosineSimilarity`
>   in `lib/similarity.ts`), just moving vectors out of the 38MB JSONL into SQLite rows. **Fine at the
>   current ~3,514 chunks (<10ms); ships with zero new deps.** This is the default first cut.
> - **(b) `loadExtension` + `sqlite-vec`** — `bun:sqlite` exposes `loadExtension` (verified); `sqlite-vec`
>   is a single small loadable binary (not the heavy `sqlite-vss` native-compile). The scale-up path
>   when chunk count crosses ~50K. **One new dep, deferred until measured need.**
> - *Why this matters:* the move to SQLite is justified **today** purely by FTS5 + killing the fat-file
>   hot path (see R-perf below) — semantic does NOT depend on a vector extension landing first.
>
> **R-perf — the SQLite move fixes a measured liability, not a hypothetical.** Today
> `LocalContextFirst` → `semantic-fallback.ts:56` does `readFileSync(38MB index.jsonl).split('\n')
> .map(JSON.parse)` with **no module-level cache** (re-read each call) + a linear cosine scan over all
> ~3,514 chunks. This is **PAI's own** embeddings index — **not** memcarry's recall path
> (`memcarry-semantic.ts` reads the tiny 35-atom store; cheap and separate), which means the hot path
> is justified to fix *independent of any memcarry/Opt-5 decision*. **Frequency, stated precisely:**
> it fires **per semantic-fallback invocation — i.e. on routing-miss exploratory queries**
> (`isKnowledgeExploration` + `isIndexAvailable` gate it, early-exit otherwise), not on every prompt.
> So the win is bounded by the routing-miss rate, but each miss pays the full 38MB load+parse+scan. An
> indexed store eliminates exactly that. Concrete near-term win, independent of the full Opt 5 schema.
>
> **R2 — Source of truth: this is a real DECISION, not a default (rayhunter-relevant).** Option 5 as
> first sketched implies "SQLite file is truth, markdown is export." But today memcarry's store is
> **git-tracked plaintext** — diffable, reviewable, and the **rayhunter recovery story** depends on
> that (you can see in `git log` what changed). A `.db` is an opaque binary blob in git. Two shapes:
> - **(i) DB-as-truth + markdown-export-on-write** — fastest queries, but the source of truth is
>   un-diffable; recovery leans on the export.
> - **(ii) markdown-as-truth + DB-as-derived-index (rebuilt from files)** — keeps git diffability AND
>   the rayhunter recovery story AND fixes the hot path (the DB is a disposable cache, regenerable
>   from the plaintext atoms). **Recommended lean** — it preserves every safety property we already
>   rely on; the index becomes a performance projection, not a new source of truth.
> - **Drift caveat for (ii) — name the invalidation trigger up front.** A derived cache can go stale
>   vs the markdown truth — the *same drift class* R1 cites for `memory-meta.jsonl`. Don't recreate
>   the problem we're removing: the index must rebuild on a defined trigger — **on-write (atom
>   created/edited → upsert its row)** as the primary, with an **mtime-vs-index staleness check** at
>   session start and the **existing weekly `EmbeddingIndex --incremental` rebuild** as the backstop.
>   A derived index without a stated invalidation trigger is just a new drift vector.
> - This sub-decision rides inside D2-Opt5 and must be made explicitly before any write path changes.

### Cutting across all options — the **native Auto Memory** disposition (independent axis)
Whatever we choose above, native is a third writer. Three sub-choices:
- **(a) Relocate** native to a separate dir (`autoMemoryDirectory`) → no collision, both coexist.
- **(b) Disable** native (`autoMemoryEnabled:false`) → PAI/memcarry stay authoritative.
- **(c) Embrace** native as the low-friction capture layer; PAI/memcarry do consolidation + recall +
  cross-project (native can't). Highest integration, live two-writer interaction to manage.

**Strategic weight on (c) — don't under-rate it (WARP #5).** Native Auto Memory is a **vendor feature
on our host that will keep improving** — it may, over time, obsolete chunks of *both* PAI's and
memcarry's capture/load machinery. There is a real long-run maintenance cost to *fighting the
platform* (every Claude Code release could change native behavior under us). So while relocate is the
right *safety* move now, **(c) embrace deserves genuine evaluation — not a one-line footnote — at the
D1 decision point**: specifically, can native become the capture substrate with PAI/memcarry layered
as the consolidation + recall + cross-project tier it will never provide? That division (vendor owns
capture, we own intelligence) may be the lowest-maintenance end-state. It is explicitly an option to
*develop*, not just to defer.

---

## 5. Recommendation → DECIDED (§6, 2026-06-21)

**Target architecture: Option 3 (integrated core, portable engine) now → Option 5 (one memory
service) as the triggered end-state + native relocate-only.** This section is the rationale; the
decisions themselves and their refinements (exit criterion, proceed-to-5 trigger, md-as-truth,
derived-index-forward) are recorded in §6.

Rationale:
- It's the only option that **resolves the convergence without a dangerous migration.** Options 1
  and 2 are both large rewrites that move 324 curated memories — precisely the blast radius the
  rayhunter safety rules exist to prevent. Option 4 isn't a solution.
- It **directly kills the named duplications:** one scorer (memcarry delegates to
  `memory-scorer.ts`), one embeddings index, one **logical** memory tree — while keeping memcarry's
  portable engine and the cross-project lesson cycle that already works.
- It is **incremental and reversible** — a seam, built behind the existing working systems, so we
  never have a flag day.

**What "one memory tree" means in Option 3 (WARP — disambiguated):** it is **LOGICAL unification, not
physical migration**. A shared index + shared scorer operate over the existing stores *in place* —
PAI's `.md` memories stay `.md` files, memcarry's atoms stay atoms. **No files move, no format
conversion.** This is precisely why Option 3 escapes the migration-risk objection that sinks Options
1 and 2: it adds a unifying layer, it does not relocate the 324 curated memories. (If we ever found
ourselves physically moving stores, part of the Option 1/2 risk would re-apply — so the seam must
stay logical by design.)

**Conditional longer-term target — Option 5 (WARP).** Option 3 is the recommended *next* move (safe,
reversible, kills the duplication). Option 5 — one typed-atom canonical store behind a real index, with
markdown/native as projections, reached **additively** (new writes as atoms; the 324 existing memories
indexed in place, promoted lazily and human-confirmed) — is the **conditional** end-state: pursued
**only if a two-shape maintainability/correctness signal appears** (coherence-drift count or
dual-shape sync incidents — §6 D2 / Phase 1 metrics). **If Opt 3 resolves recall and no such signal
ever appears, stopping at Opt 3 is a legitimate end-state, not a failure** — the drift metric (not a
vow to proceed) is the anti-calcification guard. Sequence when triggered: Opt 3 logical unification
first, then collapse to one schema/store as Opt 5 — every step inside rayhunter safety.

On the native axis: **relocate is DONE and unconditional** (2026-06-21; current path
`${HOME}/.pai-runtime/auto-memory`) — `autoMemoryDirectory` now points at a sandbox outside PAI's
curated tree and outside MemoryCurate's
scan path). This is strictly safer and is **not in tension with observing native** — it gives a
clean sandbox to watch *while* removing the cross-writer hazard. The remaining open question is only
whether to later **(c) embrace** native as the capture layer; that is evidence-gated (§6 D1), not a
reason to delay the relocate.

**What we explicitly do NOT do:** no deletion pass on PAI's hooks/memories framed as "redundant with
native" (rayhunter class). Any retirement is additive-first and telemetry-proven (§7 redundancy
audit), never a cleanup sweep.

---

## 6. The two gating decisions — MADE 2026-06-21

Both decisions are now resolved (recorded here as the single source). The refinements attached to
each close two failure modes the bare choices left open: a decision that never terminates (D1) and
an interim that calcifies into the destination (D2).

**D1 — Native Auto Memory disposition → DECIDED: RELOCATE-ONLY (revisit embrace later).**
- **Relocate: DONE (2026-06-21; current path `${HOME}/.pai-runtime/auto-memory`).** Removes the
  cross-writer + MemoryCurate hazards immediately; post-relocate native loads from an empty sandbox,
  so it costs ~0 session-start budget. PAI/memcarry stay the authoritative capture path.
- **Embrace deferred — but with a terminator (the gap this closes).** "Observe before embracing" had
  no natural end, AND relocation may have *neutered the signal* (native may have nothing to trigger
  on and stay dormant forever → the decision never becomes decidable). So:
  1. **Verify native still writes post-relocate** — run something that should trigger a native
     capture, confirm a file lands in the sandbox. If relocation silently disabled writes, "observe"
     yields zero data by construction and we must know that.
  2. **Time-boxed re-eval:** revisit D1-embrace on **first native-authored file in the sandbox OR
     after 10 rated sessions, whichever first; if neither by 2026-07-21 (≈1 month) → default to (b)
     DISABLE.** An open decision with no deadline is latent debt. (Numbers are intentions, re-datable
     — the point is none is blank.)
- **Why not embrace now:** it would hard-wire the capture layer to unvalidated vendor behavior and
  reshape the D2 seam (native→memcarry ingestion) around a topology we haven't observed (see §6 D1×D2).

**D2 — Memcarry integration model → DECIDED: Option 3 now → Option 5 CONDITIONALLY (on a drift signal).**
- **Now:** Option 3 provider seam (logical unification — one scorer, one orchestrated recall path,
  in-place stores). Verified little is throwaway: the scorer/embeddings unification + single recall
  path are reused by Opt 5, and the in-place file readers *become* Opt 5's legacy read-adapter for
  the additive migration.
- **Proceed-to-5 trigger (the gap this closes).** Staged only beats straight-to-5 if there's a
  commitment to actually proceed — else Opt 3 ships, is "good enough," and the two-shape duplication
  becomes permanent (**Option 4 with extra steps**).
  - **The trigger must measure Opt 5's ACTUAL rationale — maintainability, not performance.** Earlier
    drafts triggered on "dual-read/dedup hurting recall latency/hit-rate." That is **self-defeating**:
    Phase 2b (Opt 3) is *designed* to fix exactly that recall-performance pain (one orchestrated path,
    dedup at injection), so once Opt 3 lands the performance trigger can never fire — yet the
    two-shape *maintainability* liability (Opt 5's real reason to exist) persists, unmeasured. That is
    the same "interim calcifies into the destination" failure, relabeled.
  - **Trigger (corrected): advance to full Opt 5 canonicalization when a TWO-SHAPE MAINTAINABILITY/
    CORRECTNESS signal appears** — e.g. a **coherence-drift count** (facts that diverge between the
    PAI `.md` store and the atom store) crossing a threshold, OR **incidents/bugs attributable to
    dual-shape sync**. That is what actually degrades under two shapes; recall performance does not.
  - **Honest corollary:** if Opt 3 fully resolves recall AND no coherence-drift/sync-cost signal ever
    appears, **Opt 5 is genuinely OPTIONAL — and stopping at Opt 3 is then a legitimate end-state, not
    a failure.** Opt 5 is "promote IF a two-shape cost signal appears," not an unconditional destiny.
    (The anti-calcification guard is now the drift *metric*, not a vow to proceed regardless.)
  - (Note: the **~50K-chunk threshold is NOT this trigger** — that's the `sqlite-vec` adoption point
    for the embeddings *index* (§4 R1 / Phase 2a), an ANN-performance concern about the ~3,514-chunk
    index. Different population from the canonicalization set (35 atoms + 324 memories); says nothing
    about whether atoms should be canonical — do not OR them.)
- **Refinement — pull the derived SQLite index FORWARD, decoupled from canonicalization.** The 38MB
  hot-path fix (§4 R-perf) is pure-PAI and independent of the seam, so the real sequence is:
  **Opt 3 seam + early derived-SQLite-index-for-perf → full Opt 5 canonicalization LAST.** This banks
  the biggest concrete win soon (embeddings perf + the telemetry substrate) and de-risks the
  telemetry double-build, while deferring the "atoms are THE canonical record" commitment.

**D2 sub-decision — source of truth → DECIDED: MARKDOWN-AS-TRUTH + DB-as-derived-index.**
- Plaintext atoms stay the source of truth (git-diffable, rayhunter-recoverable); SQLite is a
  regenerable throwaway cache. See §4 Option 5 → R2.
- **Operational guard:** keep the index **upsert async/non-blocking on the write path**, or
  capture-latency (the Phase-1 metric) eats every index write. Keep all three invalidation backstops
  (on-write upsert + session-start mtime check + weekly incremental) — the mtime check is the cheap
  insurance against the `memory-meta.jsonl` drift class.
- Vector-search path (brute-force-now / `sqlite-vec`-at-scale, §4 R1) remains an implementation
  detail, not a gating decision.

**D1 × D2 are NOT orthogonal (WARP — interaction note).** The embrace sub-decision of D1 feeds
directly into what the D2 seam must build:
- **Relocate-native + Option 3** (current default): native is an isolated sandbox; the seam exposes
  PAI scorer/embeddings/ratings to memcarry; memcarry keeps its `capture-lesson`/MemCapture path as
  the capture authority. Straightforward.
- **Embrace-native + Option 3**: if native becomes the capture layer, it **undercuts memcarry's
  capture rationale** (`capture-lesson`/MemCapture overlap native's write path) and the seam must
  instead expose a *native→memcarry ingestion* adapter (consolidate native's raw captures into
  typed atoms). Meaningfully different build. **Decide D1's embrace question before finalizing the
  D2 seam surface**, or the seam gets designed for the wrong capture topology.

**With the decisions made, the plan moves from understand/decide → build (the §7 phased path).** The
restraint that held until now (ISC-A1: understand the whole picture before committing to the seam) is
satisfied. Two items proceed independently of any remaining deliberation: the **Phase-0
capture-loss guard** ("never lose" — the active rayhunter-class bleed; do not let it wait) and the
**D1 post-relocate write-verification** (cheap, and it's what makes the embrace re-eval decidable).

---

## 7. Phased path forward (after the decisions — sequenced, decoupled from the rest of the roadmap)

> Order is chosen so the **verification substrate comes first** (so we can prove each later step
> helped) and **safety is never deferred** — including the cheap capture-loss guard, which is pulled
> forward out of Phase 3 (WARP critique #5: "never lose" can't wait on observability). Each phase is
> independently shippable. **Sizes are T-shirt** (S ≈ ½–1 session, M ≈ 1–2, L ≈ 3–5) for sequencing
> only, not commitments.
>
> **Flag + revert discipline (WARP #4, all phases):** every behavior change ships behind a config
> flag (reuse the existing `useScorer` pattern) with an **explicit revert criterion** stated up
> front — e.g. "if recall hit-rate drops below baseline, flip the flag off." No phase is "done" until
> its revert path is proven to work.

> **✅ BUILD STATUS (2026-06-21, pushed origin/main @ e69e7f4):** Phases **0, 1, 2a** SHIPPED +
> validated (1758 tests pass). Phases **2b + 3** found ALREADY SHIPPED in W6 (memcarry-semantic seam +
> RRF fusion + CrossProjectIndex surfacing); the remaining gap — the recall→hit-rate loop
> (`recall-hit-ledger.ts`) — was built. **Phases 4, 5, 6 remain GATED** on real-session telemetry /
> native-write observation / a drift trigger (cron `daf7e92d` fires 2026-07-05 to check the baseline).
> Files: `AgentMemoryCapture.hook.ts`, `lib/memory-telemetry.ts`, `lib/embeddings-sqlite.ts`,
> `lib/recall-hit-ledger.ts`, `scripts/memory-telemetry-report.ts`.
>
> **2026-06-23 breakout:** the executable memory-spine scope is now split into
> `MEMORY-SPINE-SPEC.md`: Workstream A observability baseline, Workstream B cross-project scope model,
> Workstream C SF-3 embeddings into `MemoryRecall`. Treat this plan as the architecture/decision record
> and `MEMORY-SPINE-SPEC.md` as the implementation acceptance spec for that spine.

**Phase 0 — Settle the foundation (safety done now; decisions framed).** *(size: S)*
- ✅ **DONE 2026-06-21:** relocate native (`autoMemoryDirectory` → `${HOME}/.pai-runtime/auto-memory`) —
  removes the cross-writer + MemoryCurate-archive hazards by construction.
- ✅ **DONE:** confirmed sandbox is outside `projects/*/memory` (MemoryCurate never scans it).
- **Interim capture-loss guard (PULLED FORWARD from Phase 3 — WARP #5):** land a minimal parent-side
  checkpoint so subagent learnings stop being dropped *every session until Phase 3*. Cheapest form:
  a MemCapture steering rule + a thin PostToolUse `Agent` hook that prompts the parent to persist what
  a returned subagent learned. The interim parent-side guard shipped in PR #14; the broader harvesting
  path remains open. This is the known rayhunter root cause; it is cheap and must not wait
  behind observability or the seam. *(size: S)*
- **D1 post-relocate write-verification (proceeds regardless):** trigger something that should
  produce a native capture, confirm a file lands in `${HOME}/.pai-runtime/auto-memory/`. If relocation silently
  disabled writes, the embrace re-eval has no signal by construction — we must know now. Then arm the
  exit criterion (first sandbox file OR 10 sessions → revisit; neither by 2026-07-21 → disable).
- Confirm rayhunter guards intact (SecurityValidator rm/mv memory block; cwd-mismatch detection).
- **Decisions MADE (§6):** D1 relocate-only · D2 Opt 3 now → Opt 5 *conditionally* (on a drift signal) · D2-sub md-as-truth.

**Phase 1 — Observability FIRST (the substrate).** *(size: M)*
- Telemetry with **operational definitions + a captured baseline before any change** (WARP #4):
  - **recall hit-rate** — define "a hit" concretely: a surfaced memory whose source file is
    subsequently Read/referenced in the same session (proxy for "recall was useful"). Capture the
    current-system baseline over ~10 sessions *before* Phase 2a touches scoring.
  - **memory-save-events-per-project** — count of writes to each `projects/*/memory/` per session;
    a project showing 0 while actively worked = the rayhunter signature. Baseline now.
  - **capture latency** — wall-time of capture hooks; target stays within current p95.
  - **recall latency** — wall-time of the recall path (the three reads + dedup); baseline now as a
    health metric and the Phase-2b revert signal (if unifying the reads regresses latency, flip back).
  - **coherence-drift count** — facts that diverge between the PAI `.md` store and the atom store.
    This is the metric the **corrected D2 proceed-to-5 trigger** reads (§6): two-shape *maintainability*
    cost, the thing recall-performance can't capture. Start counting once Phase 2b's two shapes coexist.
    **What it sees / doesn't (WARP nuance):** it captures **correctness drift** between the stores —
    but today they are largely *disjoint* (PAI project-memories vs memcarry lessons/resume-states), so
    divergence may sit near 0 until they cover overlapping facts. It does **not** directly measure pure
    two-schema *maintenance burden* (e.g. the cost of editing two write-paths). If that burden ever
    becomes the real pain, you'd feel it without the drift count moving — so treat a rising drift count
    as *sufficient* to trigger Opt 5, not *necessary*; a felt maintenance cost is a valid manual trigger too.
- Wire the ~12 silent-degrade swallow-catch sites to emit signal.
- `/health` or board view for memory telemetry.
- *Gate:* baselines recorded → we can later **prove** Phase 2a/2b helped, not just assert it.

**Phase 2a — Pure-PAI recall wins (no memcarry dependency, independently shippable).** *(size: M)*
- **Stand up the derived SQLite index EARLY (pulled forward — §6 D2 refinement):** md-as-truth +
  DB-as-derived-throwaway-cache. Fixes the 38MB hot path (§4 R-perf) and becomes the telemetry
  substrate — **decoupled from Opt 5 canonicalization** (does NOT yet declare atoms the canonical
  record). **Index upserts async/non-blocking** so capture-latency (§Phase-1 metric) isn't taxed;
  invalidation = on-write upsert + session-start mtime check + weekly incremental. (The `sqlite-vec`
  vs brute-force-cosine choice lives here, gated on the ~50K-chunk threshold — §4 R1.)
- Wire embeddings into MemoryRecall scoring (SF-3; keyword→semantic; fixes the 33% miss). *Flagged;
  revert if hit-rate regresses vs the Phase-1 baseline.*
- *Why split:* 2a banks the two biggest concrete wins (hot-path + 33%-miss) **without touching
  memcarry's contract** — if 2b slips, 2a still stands. Each step flag-gated + revertable.

**Phase 2b — Memcarry provider seam (D2 = Option 3 work).** *(size: M)*
- Build the **memcarry provider seam** — **LOGICAL unification only** (shared index + scorer over
  in-place stores; no files move, no format conversion — see §5): engine takes PAI
  scorer/embeddings/ratings via injection; unify on `memory-scorer.ts` (memcarry stops needing its
  own value-loop). Seam built for the **relocate-only (D1)** topology; if embrace is later chosen, add
  the native→memcarry ingestion adapter then (see §6 D1×D2).
- Resolve the three-read overlap (one orchestrated recall path, dedup at injection).

**Phase 3 — Finish the capture gaps (root causes — interim guard already landed in Phase 0).** *(size: M)*
- Promote the Phase-0 interim guard to the full **PostToolUse `Agent`-matcher** agent-harvesting path.
- Surface **CrossProjectIndex** in recall (built, currently unwired).

**Phase 4 — Close the learning loop + coherence (measured by Phase 1).** *(size: L)*
- Instrument whether a promoted instinct/lesson actually prevents the repeat error (audit §B).
- Memcarry B3 reinforcement from ratings (now has a substrate + atoms) — once signal exists.
- **Knowledge Cascade:** keep a fact coherent across its 5–6 homes (registry + `/end` integration).

**Phase 5 — Additive redundancy audit (NOT a deletion pass).** *(size: M)*
- With telemetry live, evaluate which PAI hooks native Auto Memory genuinely covers. Retire only
  what telemetry proves redundant, additively, one at a time. Retire the 2 confirmed orphans
  (`KnowledgeSync`, `MemoryTimeline`) or wire them — decide explicitly.

**Phase 6 — Full Option 5 canonicalization (GATED + OPTIONAL — only if a two-shape cost signal appears).** *(size: L)*
- **Entry gate (the corrected proceed-to-5 trigger, §6 D2):** only begin when a **two-shape
  MAINTAINABILITY/CORRECTNESS signal** appears — a coherence-drift count (PAI `.md` store vs atom
  store diverging) crossing threshold, OR incidents attributable to dual-shape sync. **NOT** a
  recall-performance signal (Opt 3 already fixes that, so a perf trigger could never fire) and **NOT**
  the ~50K-chunk threshold (that's `sqlite-vec` index adoption, Phase 2a). **If no such signal ever
  appears, Phase 6 never runs — and stopping at Opt 3 is a legitimate end-state, not a failure.** It
  stays on the board, guarded by the drift metric, so the decision is data-driven rather than calcified.
- Declare the generalized typed atom the **canonical record** (lesson / resume-state / project-fact /
  relationship); make `MEMORY.md` / native / `KNOWLEDGE/` **projections**. Migrate the 324 in-place
  memories **additively** — lazy, on-access, human-confirmed promotion (memcarry `refine` pattern);
  **never a bulk rewrite** (the rayhunter constraint that ruled out Opts 1/2).
- **Re-run the Phase-5 redundancy audit after this fires:** canonicalization changes which hooks are
  redundant (projections replace some readers), so the §7 Phase-5 audit needs a second pass post-Phase-6.

---

## 8. Relationship to ADA and the rest of the roadmap

- **ADA is the activation layer; this is the memory foundation.** ADA (T1 packs / T2 procedure
  cards / T3 on-demand) pushes *domain* context. It sits ON the memory substrate but is **not
  blocked by it** — ADA phase-1 (hand-written packs) can proceed in parallel because it uses
  `CLAUDE.local.md`, not the memory recall path. The one shared dependency is the native Auto Memory
  D1 decision (both touch the same dir question), which is why the ADA build was already gated on it.
- **ROADMAP-7.x.md memory items now POINT here** (no duplication): 7.4.0 §1 observability,
  §2 memory-routing, §3 SF-3; 7.7.0 Knowledge Cascade; the signal-blocked memcarry items. They
  remain in the roadmap as *pointers with their release intent*, but the design + sequencing lives
  in this doc.

---

## 9. Open evidence to gather (cheap, do alongside)

> **Evidence log — D1 native-write probe (2026-06-21):** config verified live (`autoMemoryDirectory`
> → `${HOME}/.pai-runtime/auto-memory`, `autoMemoryEnabled` unset = ON, not disabled); sandbox confirmed empty +
> writable; **zero** native-authored files (no-PAI-frontmatter) leaked to `projects/*/memory/`. Ran the
> documented "remember this for future sessions" trigger → native did **NOT** write synchronously
> (sandbox still 0 files immediately after; the one transcript event was `file-history-snapshot`, edit
> tracking, not memory). **Inconclusive, not "broken":** native is harness-controlled and may defer
> writes to session-end/idle, and/or may have nothing to capture because PAI/memcarry are the
> authoritative path (the plan's hypothesis). **Next checkpoint:** `ls ~/.pai-runtime/auto-memory/` at next
> session start — file present ⇒ native writes post-relocate (embrace signal live); still empty ⇒ the
> D1 exit criterion governs (10 sessions / 2026-07-21 → disable).
>
> **Evidence log — native inbox triage (2026-06-26):** the relocated inbox contained 5 native memory
> topic files plus `MEMORY.md`. `scripts/auto-memory-inbox-report.ts` now classifies the inbox read-only
> and routed all 5 live files to manual review because project/global/session targets were not explicit
> enough for automated promotion. This confirms the desired posture: native Auto Memory can capture
> candidate material, but durable PAI/memcarry promotion remains human-confirmed and no topic file is
> treated as source merely because it exists.

- Run `/memory` live → confirm native now reports the **relocated** folder (`${HOME}/.pai-runtime/auto-memory`)
  and whether auto memory shows enabled.
- **Native-write test (use the frontmatter signal, NOT filenames — see §2A):**
  - **PRIMARY** (post-relocate): watch the sandbox `${HOME}/.pai-runtime/auto-memory/` — any file appearing
    there is native's own write, and it's now the expected place for it. This is the main watch.
  - **SECONDARY (misconfig safety net):** confirm **no file lacking PAI frontmatter**
    (`metadata.node_type` / `originSessionId` / `source: auto-generated`) appears in any
    `projects/*/memory/` dir — this only catches the case where the relocate didn't take (native
    ignored `autoMemoryDirectory`), not the normal path. A kebab-cased filename is NOT evidence of
    native authorship; absence of PAI frontmatter is.
- Memcarry signal log (memcarry-plan §4): is warm-resume saving re-explanation? auto-`next` quality?

---

## Appendix — source docs folded into this plan
- `ambient-domain-activation-design.md` (ADA rev 2) + `ada-native-first.md` + handoff — ADA layer.
- `memcarry-plan.md` — the §0 integration decision + build order (D2).
- `knowledge-cascade-design.md` — Phase 4 coherence.
- `PAI/MEMORYSYSTEM.md` — the live PAI subsystem reference.
- Memory files: `project_auto_memory_interaction.md`, `project_rayhunter_memory_loss.md`,
  `project_memcarry_ferrymem.md`, `project_cognitive_persistence_fixes.md`.
