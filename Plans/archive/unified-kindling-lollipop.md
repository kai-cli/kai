# Plan: PAI Memory System Improvements

## Decision

**Phase 1 (now):** Implement Option A — ROLE_CONTEXT.md + CONTEXT_ROUTING cross-project pointers. Useful regardless of what else we build. ~200 extra tokens/session.

**Phase 2 (future):** Build automated knowledge harvesting (Option C) informed by investigation findings below.

---

## Phase 1: Implement Now

### Step 1: Create ROLE_CONTEXT.md
**File:** `~/.claude/PAI/USER/ROLE_CONTEXT.md` (new) + repo copy at `PAI/USER/ROLE_CONTEXT.md`

Content — YourName's persistent work identity (~150-200 tokens):
- Role: Engineering Manager / Product Line Manager, Your Company Wireless (NPI)
- Products: Pinnacle 2.0 (M60), Pinnacle 2.2 (M62) — CF and DU customers
- Team context, current focus areas, key tools
- This file gets force-loaded every session — eliminates "who am I" re-establishment

### Step 2: Add to loadAtStartup
**File:** `~/.claude/settings.json`

Add `PAI/USER/ROLE_CONTEXT.md` to the `loadAtStartup.files` array (currently has 4 files, will have 5).

### Step 3: Update CONTEXT_ROUTING.md with cross-project pointers
**Files:** `~/.claude/PAI/CONTEXT_ROUTING.md` + repo copy at `PAI/CONTEXT_ROUTING.md`

Add a new section mapping topics to memory files in other projects:

| Topic | Memory File Path |
|-------|-----------------|
| Firmware build system | `~/.claude/projects/-Users-user-Projects-Learning-Your Company-Repo/memory/build-system.md` |
| JNAP API | `.../Learning-Your Company-Repo/memory/jnap-api.md` |
| Jenkins CI/CD | `.../Learning-Your Company-Repo/memory/jenkins.md` |
| SDK patches | `.../Learning-Your Company-Repo/memory/sdk-patches.md` |
| Feed architecture | `.../Learning-Your Company-Repo/memory/feed-your-company.md` |
| TR-069/TR-369 | `.../TR-069-TR-369/memory/` |
| WiFi troubleshooting | `.../WiFi-Troubleshooter/memory/` |
| + all 17 Learning-Your Company-Repo files + other projects with memory |

This means when I need firmware context, I already know where to `Read` it instead of you having to tell me.

### Step 4: Deploy to runtime
Copy repo versions of changed files to `~/.claude/` (same pattern as Algorithm v3.11.0 deployment).

### Verification
1. Read `~/.claude/settings.json` — confirm ROLE_CONTEXT.md in loadAtStartup
2. Read `~/.claude/PAI/USER/ROLE_CONTEXT.md` — confirm content is accurate
3. Read `~/.claude/PAI/CONTEXT_ROUTING.md` — confirm cross-project pointers present
4. (Full test: start new session, check stderr for "Force-loaded: PAI/USER/ROLE_CONTEXT.md")

---

## Phase 2: Automated Knowledge Harvesting (Investigation Findings)

### What exists today
All existing PAI harvesters are **rule-based** (no LLM), except FailureCapture which uses one fast Haiku call for descriptions:

| Tool | Approach | Input → Output |
|------|----------|----------------|
| SessionHarvester | Regex patterns (corrections, errors, insights) | Transcripts → LEARNING/ files |
| LearningPatternSynthesis | Keyword matching + Jaccard similarity | ratings.jsonl → synthesis reports |
| FailureCapture | Rule-based + 1 LLM call (description) | Transcript + rating → FAILURES/ directory |
| WisdomCrossFrameSynthesizer | Word-overlap Jaccard | FRAMES/*.md → verified principles |
| ResearchIndex | Tokenization + scoring | Research outputs → searchable index |

### Design direction for automated knowledge harvesting

**The problem:** 51 memory files across 12 projects. Knowledge drifts and duplicates. Manual curation doesn't scale.

**Proposed approach: KnowledgeHarvester.ts**

A periodic tool (not a hook — too expensive for session start) that:

1. **Scans** all `~/.claude/projects/*/memory/MEMORY.md` index files to build a complete inventory
2. **Reads** each referenced memory file, extracts topic + key facts (rule-based: headings, bold text, tables)
3. **Detects duplicates** across projects (Jaccard similarity on extracted facts, similar to existing WisdomCrossFrameSynthesizer pattern)
4. **Generates** a `MEMORY/KNOWLEDGE/` directory with distilled cross-project summaries
5. **Uses one LLM call** (fast/Haiku) per knowledge domain to produce a coherent ~200-token summary from scattered source files — same pattern as FailureCapture's description generation

**Token cost:** Zero per-session (runs offline). One-time cost per invocation: ~5-10 fast LLM calls to distill knowledge domains. Run weekly or on-demand.

**What it replaces:** The manual curation from the original Improvement 1 + 5 in the previous plan.

**What it enables:** The KNOWLEDGE/ directory stays fresh automatically. LoadContext injection (original Improvement 2) becomes viable without manual maintenance burden.

### Future implementation order
1. Build KnowledgeHarvester.ts (scan + extract + deduplicate + distill)
2. Add `MEMORY/KNOWLEDGE/` to LoadContext.hook.ts injection (knowledge-readback.ts)
3. Add a cron or hook trigger to run harvester weekly

This is Phase 2 — not building now, but the design is ready when we want it.

---

## Summary of Phase 1 changes

| File | Action | Tokens Added |
|------|--------|-------------|
| `PAI/USER/ROLE_CONTEXT.md` | Create | ~150-200/session |
| `settings.json` | Edit (add 1 line to array) | 0 |
| `PAI/CONTEXT_ROUTING.md` | Edit (add cross-project section) | 0 (read on-demand, not injected) |
| Deploy to `~/.claude/` | Copy 2 files | — |

**Total per-session overhead: ~200 tokens.** CONTEXT_ROUTING changes cost zero tokens unless I actually need to look up firmware context mid-session.
