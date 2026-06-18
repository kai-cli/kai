# Memcarry / PAI — Next Steps (re-based against live reality)

> **Written 2026-06-15** after the retrieval sprint shipped. Re-bases the stale `SATURATION-CANDIDATES.json`
> (2026-06-04) findings against verified live code, so no future session re-derives already-done work.
> **Verification method:** grepped live `hooks/`, `config/hooks.jsonc`, ran `memcarry health`. Not assumed.

## ✅ DONE — the retrieval sprint (003-memcarry-retrieval)

All four items live + committed in pai-config (5 commits, full suite 1828 green):
- **B2** hybrid keyword+semantic RRF recall — `memcarry/packages/lib/src/recall.ts` + host `ScoreProvider`/cache
- **A2** every-prompt recall — `hooks/MemRecall.hook.ts` (registered, in-process, degrades to keyword-only)
- **B1** PRD-aware resume — `hooks/MemResume.hook.ts` (was already built)
- **H2** compaction recovery — `hooks/PostCompactRecovery.hook.ts` re-injects resume cursor + lessons; shared `recallLessons()` helper
- **T017** cross-system dedup — DEFERRED by decision (C+); see `003-memcarry-retrieval/tasks.md`

## ✅ DONE — backflow (004) + capture (005): the cross-project cycle is CLOSED (2026-06-16)
- **004 backflow** (B→A) — `memcarry refine` + `refine.ts`; a global lesson improved in B propagates everywhere. FR10 relaxed (MCP-orphan tag dropped). SHIPPED + pushed.
- **005 capture** (forward) — `memcarry capture-lesson` + `capture-lesson.ts`; turns a session learning into a `human-confirmed` lesson atom. Steering rule + End-skill 1c net. SHIPPED + pushed (`06ff9d3`). Full suite 60 green.
- **Cycle proven on REAL atoms (dogfood 2026-06-16):** captured 2 lessons from the build session → live store grew **6→8** (lessons 2→4); both recall #1 from unrelated projects (linksys-mcp, feed-bbf). First organic growth since Phase-0 fixtures.
- **Net:** the §0 root pain ("nothing turns a learning into a lesson") is now mechanically solved. The store grows hands-confirmed. The remaining work is FEEDING it (curated migration, below) + tuning (dup threshold, below).

### Fast-follow — dup-check similarity threshold tune (found during 005 dogfood, 2026-06-16)
**Finding:** with only 1–4 global lessons, the single dominant lesson (`lsn_memory_harness_already_built`)
trickles into EVERY `capture-lesson` dry-run's `similar` list at score **~0.0164** — the RRF weak floor,
not a real near-dup. Harmless today (advisory only, non-blocking; the human-confirm gate is the arbiter),
but it means the "similar lesson(s) exist — refine instead?" hint fires on essentially every capture.
**Plan:** introduce a minimum similarity threshold below which a hit is NOT surfaced as `similar` (start
conservative — the spec explicitly deferred the number to "tuned against real atoms"). Do NOT tune now:
4 atoms is too small a sample to pick a meaningful floor. Revisit once the curated migration grows the
store to dozens of lessons — then the score distribution is real and a threshold can be set from data.
**Where:** `captureLesson()` in `memcarry/packages/cli/src/index.ts` (the `.filter()` on `similar`).
Low priority — cosmetic noise, not a correctness bug.

## ⚠️ Thread C / W1 "shared engine" — MOSTLY ALREADY BUILT (findings were stale)

The PROGRAM.md recommended Thread C / W1 as the next sprint, citing `SATURATION-CANDIDATES.json`. **Live
verification 2026-06-15 shows W1 is largely done** — that analysis was 11 days stale and PAI had already
consolidated (the code carries `W1`/`W4` consolidation comments from prior work):

| Finding | June-4 claim | Live reality (verified) | Status |
|---|---|---|---|
| **C1** | 3 cosine defs, 2 jina loaders | one `hooks/lib/similarity.ts` + one `hooks/lib/embeddings.ts` | ✅ DONE |
| **C3** | SessionEndComposite unwired | wired in `config/hooks.jsonc` | ✅ DONE |
| **C5** | 4-5 SessionEnd hooks race on inference | one `SessionEndComposite` orchestrator | ✅ DONE |
| **C6** | 14 hooks re-parse transcript | `transcript-cache.ts` exists; 3 hooks use it; `SessionEndComposite.analyzeTranscript` + others still read independently | 🟡 PARTIAL |

**Net:** Thread C / W1 is NOT a sprint. The only genuine remainder is a small **C6 audit** — wire the
remaining SessionEnd transcript readers (SessionEndComposite, RatingCapture, InsightExtractor,
WorkCompletionLearning, etc.) to the existing `transcript-cache.ts` so the session is parsed once.
Minor optimization, not high-value. **Re-run a fresh saturation scan before treating any C-finding as
real** — do not trust the 2026-06-04 JSON.

## 🎯 THE ROOT PAIN, FINALLY NAMED (2026-06-15) — and what it implies

Deven's actual frustration that started this whole program: **bidirectional cross-project knowledge
cycling.** "I had deep knowledge in project A → it never surfaced in B → I re-learned + refined it in B →
the refinement never flowed BACK to A → so A became stale and I couldn't trust it." Both directions fail.

**Why PAI structurally CANNOT fix this (not "doesn't" — can't):** PAI stores lessons as PER-PROJECT FILES
(A has its copy, B has its copy). Forward (A→B) is only lossy KnowledgeHarvester summaries. Backflow
(B→A) is **impossible** — separate files, separate dirs; editing B's copy can't touch A's. The
per-project-copies data model is incapable of backflow. No amount of retrieval tuning fixes a data-model
mismatch. THIS is why the pain never resolved.

**Why MemCarry's `scope:global` atom is the right model:** ONE atom, recalled everywhere. Forward =
automatic (eligible in every project). Backflow = automatic IF you update the one atom (everyone reads the
update). Trust restored — no stale per-project copy, one current truth. **This validates MemCarry's core
architecture** — it's the only one of the 5 memory layers that can cycle.

**VERIFIED GAP (don't overclaim):** the backflow *data model* exists (`writeAtom` overwrites by id) but
there is **NO WORKFLOW** to do it — `capture`/`confirm` only touch resume-state cursors, `recall` is
read-only, `write` is raw-JSON-by-hand. So backflow is *possible, not operational*. Migration alone =
forward-only propagation (which PAI already does lossy-ly). **The backflow workflow is the true unlock.**

**DECIDED PLAN (2026-06-15): backflow workflow FIRST, then curated migration to feed it.**
1. ✅ **Backflow workflow** — SHIPPED (004). `memcarry refine` updates the one global atom (append-dated
   `because`, provenance human-confirmed). The differentiator.
2. ✅ **Capture workflow** — SHIPPED (005, added to the plan after backflow). `memcarry capture-lesson`
   turns a learning into a lesson atom. The forward half; both halves of the cycle now exist.
3. 🎯 **Curated migration — NEXT (in progress 2026-06-16).** Identify the genuinely CROSS-project lessons
   among the ~114 PAI `feedback_*` files (NOT project-specific ones) → global atoms via the shipped
   `capture-lesson` primitive. Feeds the now-complete cycle with real existing knowledge.
   (Project-specific lessons stay in PAI; full-114 migration would pull noise into the atom store.)

**Open DESIGN questions for the backflow workflow (think before building):**
- WHEN does new info UPDATE an existing atom vs CREATE a new one? (supersede vs append vs fork)
- Conflict/confirmation: does an update need human-confirm, or auto with provenance downgrade?
- How does the model KNOW a recalled atom is now stale mid-work? (explicit "/refine" vs detected contradiction)
- Audit trail: the WHEN→DO→BECAUSE `because` should accumulate dated evidence, not overwrite history.

### 0b. (subsumed) capture→lesson path — the missing capture→lesson path (CORRECTED 2026-06-15)
**Earlier framing ("value loop gated on signal — wait longer") was wrong.** Measured the live system:
- **11 days live** (Jun 4→15), **10 distinct active days**, 424 heartbeats — NOT too early; a fair sample.
- **137 resumes fired, but only 8 captures.** Store stuck at **6 atoms**, almost all created Jun 4-5
  (Phase-0 fixtures + 1 manual). Lessons have NOT grown from real work.
- **Why:** auto-capture only writes *resume-state cursors* (overwritten per project, don't accumulate).
  There is **no path from "I learned something" → a lesson atom** except a rare manual write. By design.
- **So the store isn't starving from immaturity or low signal — there's a missing mechanism.** Retrieval
  (137 resumes, recall firing) is healthy; it just has almost nothing transferable to retrieve.

**The unblock = a capture→lesson path. Two flavors (Deven's instinct: don't artificially pump the store):**
- **Assisted capture (preferred first):** a fast flow (`/remember`-style or End-skill step) turning a
  session learning into a **human-confirmed** lesson atom. Safe, high-trust, zero pollution. Grows the
  store with exactly the lessons you'd want.
- **A1 auto-ingestion (staged after):** detect a cross-project recall that was *used + preceded a good
  outcome* → auto-draft a lesson (provenance: auto-captured, low trust until vindicated). The adversarial
  review deferred this precisely for pollution risk; only safe once there's signal to judge quality.
- **NOT recommended:** bulk-importing the 255 PAI memory files (re-introduces the noise MemCarry avoids).

### 1. Memcarry value loop — B3 (reinforcement) — gated on ATOMS, not signal
- **B3/I1:** join `MEMORY/LEARNING/SIGNALS/ratings.jsonl` (**312 ratings already on disk** — signal is
  NOT the gate) → reinforce atoms a recall preceded a high-rated turn.
- **Real gate:** only **6 atoms to reinforce** — reinforcement is meaningless until §0 grows the store.
  So B3 follows the capture path, not the calendar.

### 1c. Hook consolidation — UserPromptSubmit composite (verified 2026-06-16) — SCOPED PROJECT
**Finding:** SessionEnd was already consolidated (10 hooks → 1 `SessionEndComposite`), but SessionStart
(12 hooks) and UserPromptSubmit (13 hooks: 10 sync + 3 async) were NOT. Each hook = a separate ~33ms bun
cold-start, sequential. Per-prompt overhead is real but small (tens of ms) — this is perf-polish +
tidiness, NOT a broken thing.

**Verified consolidation opportunities (each checked against live code):**
- **⭐ UserPromptSubmit composite (highest value):** 13 separate hooks → 1 orchestrator mirroring
  `SessionEndComposite`. Also: 3-4 of them re-read the transcript/stdin independently
  (`SessionAutoName`, `InstinctCapture`, `RatingCapture`) → share ONE read (the C6 pattern, this event).
- **SessionStart guard-merge (smaller):** 4 hooks emit ZERO context (HealthCheck, TerminalState,
  CheckVersion, StartupGreeting) — pure side-effect guards → merge into one "startup-guards" hook.
- **NOT cleanup (load-bearing, leave):** LoadContext, MemResume, MemDrift, SecretScanner, the recall hooks
  — distinct real work. The async trio already runs non-blocking.
- **MemoryRecall + MemRecall both firing = INTENTIONAL** (PAI+memcarry parallel-run), not cleanup — that
  resolves only when PAI memory is eventually retired in favor of memcarry.

**Why a scoped project, not a quick edit:** it's surgery on the HOTTEST path (every prompt) — highest
blast radius in the system. Deserves full spec→validate→build rigor, NOT a session-tail edit. Mirror the
existing `SessionEndComposite` (+ its README) as the template. Re-verify the hook list against live
`settings.json` first (it drifts as hooks are added — e.g. MemRecall/SkillTracker were added this session).

**Full lifecycle-event survey (verified 2026-06-16) — which events are consolidatable:**
| Event | Hooks | Consolidatable? |
|---|---|---|
| SessionEnd | 1 (composite) | ✅ ALREADY DONE (the template) |
| **UserPromptSubmit** | 13 (all fire every prompt) | ✅ YES — the ⭐ target above |
| **SessionStart** | 12 (all fire every start) | ✅ YES — guard-merge (smaller) |
| PreToolUse | 11 across 9 matchers | ⚠️ MOSTLY NO — matcher-ROUTED (a tool call fires only its 1-2 matching hooks, not all 11). Only `Bash` (SecurityValidator+GitHubWriteGuard) and `Skill` (SkillGuard+SkillTracker) have 2 hooks sharing an input-parse — MINOR shared-parse tidy-ups, not a composite. |
| PostToolUse | 6, one per matcher | ❌ NO — one hook per matcher, nothing to merge |
| Stop | 3 | (survey if ever touched; low traffic) |
| PreCompact/ConfigChange/WorktreeRemove/TaskCompleted/TeammateIdle | 1 each | ❌ NO |

**Corrected understanding:** the "fire ALL N every time" cost is UNIQUE to SessionStart + UserPromptSubmit
(unconditional events). Per-tool events (Pre/PostToolUse) are matcher-routed, so their N-count overstates
real cost. The only true composites worth building are the two unconditional events. Optional micro-tidy:
merge the 2-hook `PreToolUse:Bash` and `PreToolUse:Skill` matchers to share their command/skill parse.

### 2. Persona scoping (Tier 1) — READY, NEEDS DEVEN'S INPUT
- Define which of the ~49 skills / capabilities actually serve the four hats (TPM / PM / QA / Engineer).
- Pure input from Deven, not analysis. Unblocks the eventual W4 capability-cluster streamlining.
- Two-tier plan (locked): initial definition now → audit real usage → refine.

### 3. NEW atom type: `synthesis` / `briefing` — CANDIDATE (schema-expansion phase)
- **Problem (from `feedback_investigation_outputs.md`, 2026-06-15):** when an investigation produces
  *communication-ready* findings (for an email/meeting/stakeholder update), the synthesis isn't stored
  in usable form — memory logs the EVENT ("email sent to Olivier"), the wiki stores STRUCTURED reference,
  the actual synthesis lives in the ephemeral transcript. User re-excavates transcripts to reconstruct it.
  This is the "stored but not surfaced" problem one layer UP from retrieval — about the *form* of what's
  captured, not just whether it's recalled.
- **The fit:** a `synthesis`/`briefing` atom type optimized for communication re-use — distinct from
  `lesson` (durable rule) and `resume-state` (work cursor). Captures findings as ready-to-reference
  content (bullets/facts/decisions/gaps + any human clarifications that aren't in wiki/code). Retrieved by
  the SAME MemRecall hook already built — no new location (avoids the fragmentation that caused the bug).
- **Why type-3 over the alternatives Deven listed:** (1) richer memory files = low-effort interim, works
  in current schema; (2) a dedicated Deliverables/ folder = a NEW location, mildly conflicts with the
  one-unified-store principle — only acceptable if indexed by the same retrieval; (3) **the new atom type
  is the architecturally-aligned answer** — same store, same retrieval, distinct trust/shape.
- **Gating:** schema expansion is post-MVP (memcarry deliberately ships 2 types; more deferred). Slot this
  into the same phase as the value-loop/schema work — NOT now. Captured here so it isn't re-derived.

### 3. C6 transcript-cache audit — SMALL, OPTIONAL
- Wire remaining SessionEnd transcript readers to `transcript-cache.ts`. Low value; do opportunistically.

## Recommended posture (REVISED 2026-06-15)

**The next high-value development is the capture→lesson path (§0) — NOT "wait for signal."** The 11-day
measurement corrected the earlier "let it accrue" framing: retrieval is healthy and exercised (137
resumes), 312 ratings already exist, but the store is stuck at 6 atoms because **nothing turns a session
learning into a lesson atom.** That's a missing mechanism, not immaturity.

- **When ready to build:** assisted capture first (human-confirmed, safe), A1 auto-ingestion staged after.
- **Deven's guardrail (honored):** don't artificially pump the store — grow it with lessons genuinely worth
  keeping, at human-confirmed trust. Quality over volume, consistent with the whole MemCarry ethos.
- **Still genuinely deferred:** B3 reinforcement (needs atoms first, §1), persona Tier-2 (needs skill-usage
  data — tracker just started, 2 entries), synthesis atom type (§3), W4 cleanup (needs persona + fresh scan).
- **No rush:** the capture path is the clear next build, but it's a choice of *when*, not a fire. Nothing
  is broken; the system runs fine — it just doesn't yet learn lessons hands-free.

## Standing rule for the next session
Before building ANY "cleanup" item: re-verify it against live code. The 2026-06-04 saturation findings
are stale — three times this program, "the work was already done" was the answer. Verify first.
