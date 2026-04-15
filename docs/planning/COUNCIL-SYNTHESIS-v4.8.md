# PAI Council Synthesis — v4.8 Improvement Plan

**Generated:** 2026-04-15
**Sources:** 3 Architect council agents (Token Economy, Learning Loop, Curation Workflow), 49 reflections, system survey
**Status:** Awaiting principal review

---

## Executive Summary

Three independent Architect agents analyzed PAI's memory system from different angles. Their findings converge on a 4-phase improvement plan that:

1. **Optimizes startup tokens** — 38-41% reduction (~2,200 tokens saved) by removing duplication and making context conditional
2. **Closes the learning loop** — ReflectionHarvester extracts patterns from reflections with human review gate, injecting <200 tokens of behavioral lessons per session
3. **Adds self-curation** — `pai curate` weekly CLI command + rating-triggered draft memory staging with 14-day expiry

**Key principle across all three:** Human approval gates everywhere. The system suggests, the user decides. No auto-promotion to production memory.

---

## Phase 0: Token Economy Optimization (P0 — Do First)

**Why first:** Reduces baseline cost before adding new capabilities. Every subsequent feature benefits from a leaner startup.

### 0A. Remove Duplicate CLAUDE.md

The project CLAUDE.md (`pai-config/CLAUDE.md`) is identical to the global CLAUDE.md (`~/.claude/CLAUDE.md`). Claude loads both. Savings: ~452 words / ~588 tokens.

**Action:** Replace project CLAUDE.md with a one-liner: `See ~/.claude/CLAUDE.md — this project uses global PAI instructions.`

### 0B. Conditional TELOS Loading

TELOS (life goals context) is force-loaded every session but only relevant to personal/life planning tasks.

**Action:** In LoadContext.hook.ts, load TELOS only when session context mentions personal/goals/telos keywords. Default: skip.

### 0C. Strip Template Boilerplate

ROLE_CONTEXT and PROJECTS files contain template headers, examples, and formatting that could be compressed.

**Action:** Consolidate ROLE_CONTEXT + TELOS + PROJECTS into a single `SESSION_BRIEF.md` (~530 words saved), loaded conditionally by project type.

### 0D. Compress Steering Rule Examples

AISTEERINGRULES.md Bad/Correct examples are verbose. The rules themselves are ~13 lines but examples triple the token count.

**Action:** Move examples to a separate `AISTEERINGRULES-EXAMPLES.md` loaded only during Algorithm mode or on first session.

**Total Phase 0 savings:** ~2,200 tokens (38-41% of current dynamic injection)

---

## Phase 1: Foundation Infrastructure (Week 1-2)

### 1A. Read Telemetry in LoadContext

Currently no data on which memory files are actually consumed. This makes staleness detection guesswork.

**Action:** In LoadContext.hook.ts, after knowledge injection, log which domains/files were injected to `MEMORY/STATE/memory-reads.jsonl`.

```typescript
const readEntry = {
  timestamp: new Date().toISOString(),
  session_id: process.env.CLAUDE_SESSION_ID,
  project: projectDir,
  domains_injected: injectedDomains,
};
appendFileSync(readLog, JSON.stringify(readEntry) + '\n');
```

### 1B. MEMORY/STAGING/ Directory

Create the staging area for draft memories, explicitly excluded from all production paths (KnowledgeSync, LoadContext, knowledge injection).

```
~/.claude/MEMORY/STAGING/
  ├── {timestamp}_{type}_{slug}.md    (draft files with frontmatter)
  └── .staging-state.json             (expiry tracking)
```

- 14-day expiry on all drafts
- Cleanup runs at every `pai curate` invocation
- Excluded from KnowledgeSync scanning

### 1C. `pai curate` CLI Skeleton

Build `MemoryCurate.ts` with initial subcommands:
- `pai curate stats` — memory system statistics
- `pai curate stale` — list stale files
- `pai curate domains` — knowledge domain health
- Wire into pai.ts CLI router

### 1D. SessionEnd Inference Budget Cap

**From risk analysis:** Multiple hooks calling LLM inference at SessionEnd risks timeouts.

**Action:** Max 3 LLM calls across all SessionEnd hooks. KnowledgeSync gets priority. Implement via shared semaphore in `hooks/lib/inference-budget.ts`.

---

## Phase 2: Weekly Review Workflow (Week 2-3)

### 2A. Full `pai curate` Interactive Report

Five-section weekly report (target: 3-7 minutes to complete):

| Section | What User Sees | Decision | Time Each |
|---------|---------------|----------|-----------|
| **1. Staleness** | Files not updated >90d AND not read >30d AND not active project | archive / keep / skip | ~2s |
| **2. Domain Health** | 7 domains scored [OK], [STALE], [THIN] | re-distill / merge / skip | ~3s |
| **3. Draft Memories** | Pending drafts with confidence scores and source context | approve / edit / reject / skip | ~10s |
| **4. Session Insights** | Top positive + negative patterns from last 7 days | create memory / skip | ~5s |
| **5. Quick Stats** | Growth, coverage, oldest, most active — informational | none | ~0s |

**Compound staleness check:**
```
is_stale(file) =
  (days_since_update > threshold_for_type(file.type))
  AND (days_since_last_read > 30)
  AND (NOT is_referenced_by_active_project(file))
```

Type-specific thresholds:
| File type | Staleness threshold |
|-----------|-------------------|
| `feedback_` | 60 days |
| `project_` | 30 days after project completion |
| `reference_` | 180 days |
| `MEMORY.md` | Never auto-stale |

### 2B. Archive/Restore Mechanics

```
~/.claude/projects/{project}/memory/
  ├── active files (current)
  └── .archive/
      └── {filename}.{archived-date}.md
```

- Archive is reversible: `pai curate restore <file>`
- Archived files excluded from KnowledgeSync but remain on disk
- No data is ever deleted

---

## Phase 3: Learning Loop (Week 3-4)

### 3A. ReflectionHarvester.ts

Periodic tool that extracts patterns from algorithm reflections with human review gate.

**Architecture:**
```
Raw reflections (62+) → Jaccard dedup → LLM synthesis → STAGING/
→ User reviews in `pai curate` → Approved lessons → session injection
```

**Two-pass extraction:**
1. **Pass 1 (cheap):** Jaccard similarity dedup — remove near-duplicates from raw reflections
2. **Pass 2 (LLM):** Synthesize unique reflections into 3-7 behavioral lessons, each <30 words

**Injection:** <200 tokens of approved lessons loaded at session start via LoadContext. Only lessons explicitly approved by user in `pai curate`.

**7 Safeguards Against Feedback Poison:**
1. Human approval gate — no auto-promotion from staging
2. Source attribution — every lesson traces to specific reflection IDs
3. Confidence scoring — LLM assigns confidence, user sees it
4. Decay via evidence-based + time-based hybrid — lessons not reinforced by new reflections fade
5. Rejection tracking — rejected patterns inform future confidence calibration
6. Cap on active lessons (max 10) — prevents lesson bloat
7. Reflections treated as evidence to evaluate, not truth to follow

### 3B. Rating-Triggered Draft Generation

Piggyback on the existing rating system (no new user interaction at session end):

| Rating | Action | Method |
|--------|--------|--------|
| 1-3 | Full failure capture (already exists) | No change |
| 4-5 | Generate correction draft | Regex scan for "no", "not that", "wrong" — no LLM |
| 6-7 | No action | Correct default — these sessions are fine |
| 8-10 | Generate success pattern draft | Fast inference on last 5 turns, only if Algorithm PRD exists |

Drafts go to `MEMORY/STAGING/` with 14-day expiry. User discovers them in `pai curate`.

**Generation filter:**
- Session has explicit rating >= 8 OR 4-5 with corrections detected
- Session had substantive work (>10 tool calls OR Algorithm PRD exists)
- Extracted content is >50 words
- Confidence score >= 0.7

---

## Phase 4: Automation Refinement (Week 4+)

### 4A. LearningPatternSynthesis Enhancement

Enhance existing `LearningPatternSynthesis.ts` to produce weekly pattern summaries that feed Section 4 of `pai curate`.

### 4B. Batch Operations

`pai curate approve-all --confidence 0.8` for users who trust the system after weeks of good suggestions. Track approval rate in `.staging-state.json`.

### 4C. Confidence Calibration

Over time, rejection patterns inform confidence thresholds:
- If user approves >80% of suggestions over 4+ weeks, consider lowering threshold from 0.8 to 0.7
- If approval rate drops below 60%, raise threshold
- All adjustments are suggested to user, not auto-applied

### 4D. Nudge System

If `pai curate` hasn't been run in >14 days AND staging has unreviewed drafts:
- One line at session start: `"STAGING has N unreviewed drafts — run 'pai curate'"`
- Not a wall of text, not blocking, just a reminder

---

## Risk Mitigation Summary

| Risk | Mitigation |
|------|-----------|
| **User doesn't run `pai curate` weekly** | Gentle nudge after 14 days (one line at session start) |
| **Auto-drafts are noisy** | High initial confidence threshold (0.8), lower only after 4+ weeks of >80% approval |
| **Archiving wrong files** | Archive is reversible, compound staleness check, user can `[KEEP]` permanently |
| **Session-end latency** | DraftMemoryGenerator runs async (fire-and-forget), inference budget cap of 3 calls |
| **Feedback poison from reflections** | 7 safeguards: human gate, source attribution, confidence scoring, decay, rejection tracking, lesson cap, evidence-not-truth |
| **Token inflation from new features** | Phase 0 saves tokens first; new injections capped at <200 tokens; net budget improves |
| **Complexity creep** | Each phase is independently valuable; can stop after any phase |
| **Memory staleness** | Compound check (not updated AND not read AND not active project) prevents false positives |

---

## Build Order

```
Phase 0 ──→ Phase 1 ──→ Phase 2 ──→ Phase 3 ──→ Phase 4
(tokens)    (infra)     (review)    (learning)   (refine)
 ~1 day      ~2 days     ~2 days     ~3 days      ongoing
```

Phase 0 has no dependencies. Phases 1-2 can partially overlap (read telemetry and staging are independent). Phase 3 depends on staging (Phase 1B). Phase 4 depends on everything working.

---

## Relationship to Existing Roadmap

This plan supersedes Priority 1 items from `IMPROVEMENT-ROADMAP-v4.8.md`:

| Roadmap Item | Status in This Plan |
|-------------|-------------------|
| 1.1 Memory Archival & TTL | Expanded → Phase 2A/2B (compound staleness, archive/restore) |
| 1.2 Parallelization Forcing | Unchanged — still valid, independent of this work |
| 1.3 Pre-flight Target File Reading | Unchanged — already implemented in v3.11.0 |
| 2.1-2.3 Security items | Unchanged — independent track |
| 2.4 Version String Centralization | Unchanged — independent track |
| 3.3 Test Coverage | Unchanged — should cover new MemoryCurate.ts |

New items added by this plan: Token optimization (Phase 0), Read telemetry (1A), STAGING directory (1B), `pai curate` CLI (1C-2A), ReflectionHarvester (3A), Rating-triggered drafts (3B).
