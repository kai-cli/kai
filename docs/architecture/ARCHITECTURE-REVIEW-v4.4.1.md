# PAI v4.4.1 — Architecture Review

> Holistic review of the PAI system after v4.4.0→v4.4.1-dev cleanup. Covers what the system does, what we changed, what's broken, design flaws, and improvement paths.
>
> **Date:** 2026-03-11
> **Branch:** v4.4.1-dev
> **Reviewer:** Oz (AI) + Deven (human)
> **Companion docs:** SYSTEM-ATLAS.md (structure), IMPROVEMENT-INDEX.md (tracker), HOOK-SYSTEM-AUDIT.md (hook details)

---

## 1. What PAI Is

PAI (Personal AI Infrastructure) is a Claude Code customization framework. It wraps Claude Code with:

1. **Identity system** — A named Digital Assistant (DA) with personality traits, stored in `config/identity.jsonc`
2. **Hook system** — 23 TypeScript scripts triggered on Claude Code lifecycle events (SessionStart, Stop, UserPromptSubmit, PreToolUse, etc.)
3. **Algorithm system** — A structured 7-phase problem-solving framework (Observe→Think→Plan→Build→Execute→Verify→Learn) with effort tiering (Micro vs Standard+)
4. **Learning system** — Sentiment capture, explicit 1-10 ratings, failure analysis, written to MEMORY/LEARNING/
5. **Skill system** — 47 modular skills across 11 categories (Security, Research, Media, etc.) with SKILL.md manifests
6. **Config pipeline** — JSONC domain files → BuildSettings.ts → settings.json (source-of-truth pattern)

The active installation lives at `Releases/v4.4.0/.claude/` and symlinks to `~/.claude/` at install time.

---

## 2. What We Changed (v4.4.0 → v4.4.1-dev)

**6 commits on `v4.4.1-dev`, pushed to `fork` remote:**

| Commit | Description | Impact |
|--------|-------------|--------|
| `9257f53` | README cleanup: voice remnants, duplicate sections, developer links | Docs only |
| `7c9037f` | P1/P2 batch: removed 10 phantom hooks from settings.json, added 5 missing hooks to hooks.jsonc, fixed version strings, doc counts, stale refs | 11 files, -92 lines |
| `9fa902a` | hooks/README.md rewrite to match actual 23-hook architecture | 1 file |
| `3889951` | IMPROVEMENT-INDEX.md status update | 1 file |
| `3692c1a` | P3 bloat removal: deleted 11 old release dirs (~314MB), old Algorithm versions, transcription artifacts | 11,246 files, -2.18M lines |
| `3be9e81` | P4 architecture: extracted shared agent output partial, migration README, BuildSettings docs, USER/ audit, Python justification | 17 files, -393 lines |

**Assessment: No regressions introduced.** All changes were removals of dead code/files, doc fixes, or new documentation. No functional code was modified.

---

## 3. Runtime Bugs Found

These bugs are **pre-existing in v4.4.0** — not introduced by our changes.

### BUG 1 (Critical): StopOrchestrator Has Phantom Imports

**File:** `hooks/StopOrchestrator.hook.ts`
**Lines:** 26-27

```typescript
import { handleRebuildSkill } from './handlers/RebuildSkill';
import { handleAlgorithmEnrichment } from './handlers/AlgorithmEnrichment';
```

**Evidence:** Neither file exists:
```
ls handlers/ → BuildCLAUDE.ts, BuildSettings.ts, DocCrossRefIntegrity.ts, SystemIntegrity.ts, TabState.ts, UpdateCounts.ts
```

No `AlgorithmEnrichment.ts` or `RebuildSkill.ts` anywhere in the repo.

**Impact:** StopOrchestrator crashes immediately on import resolution. Since Claude Code hooks catch errors and exit(0), this is **silent** — but it means NONE of the orchestrator's handlers run (TabState reset, DocCrossRefIntegrity, etc.). The standalone `DocIntegrity.hook.ts` partially compensates since it's also registered on Stop.

### BUG 2 (Critical): StopOrchestrator Wrong Import Path

**File:** `hooks/StopOrchestrator.hook.ts`
**Line:** 23

```typescript
import { parseTranscript, extractCompletionPlain, extractStructuredSections } from '../skills/PAI/Tools/TranscriptParser';
```

**Evidence:** The path `../skills/PAI/Tools/TranscriptParser` does not exist. The actual file is at `../PAI/Tools/TranscriptParser.ts`. This is a leftover from an earlier version where PAI tools lived under `skills/PAI/`.

**Impact:** Even if Bug 1 were fixed, this would still prevent the orchestrator from loading.

### BUG 3 (High): DocCrossRefIntegrity Double Registration

**File:** `config/hooks.jsonc` lines 137-139

Both `DocIntegrity.hook.ts` (standalone) and `StopOrchestrator.hook.ts` (orchestrator) are registered on the Stop event. Both call `handleDocCrossRefIntegrity()`.

**Evidence:**
- `hooks.jsonc:137` → `DocIntegrity.hook.ts` (standalone entry point)
- `hooks.jsonc:139` → `StopOrchestrator.hook.ts` (calls same handler at line 104)

**Impact:** Currently masked by Bug 1 (orchestrator crashes before reaching it). If Bug 1 were fixed, the handler would run twice per Stop event — wasting inference credits (~$0.01/call for Sonnet) and creating race conditions on `doc-drift-state.json` writes.

### BUG 4 (Medium): IntegrityMaintenance Broken Path

**File:** `PAI/Tools/IntegrityMaintenance.ts`
**Line:** 112

```typescript
const CREATE_UPDATE_SCRIPT = join(PAI_DIR, 'skills/_SYSTEM/Tools/CreateUpdate.ts');
```

**Evidence:** `skills/_SYSTEM/` does not exist in v4.4.0. The `_SYSTEM` skill category was removed or renamed in a prior version.

**Impact:** IntegrityMaintenance's update documentation feature fails silently when it tries to spawn CreateUpdate.ts.

### BUG 5 (Low): Voice Notification Remnants in DocCrossRefIntegrity

**File:** `hooks/handlers/DocCrossRefIntegrity.ts`
**Lines:** 870-885

```typescript
// Step 10: Voice notification — ONLY when actual documentation edits were applied
// No voice for "queued for review" or "in sync" — that's noise
if (updatesApplied.length > 0) {
    // Delay 3s so the main 🗣️ {DAIDENTITY.NAME} voice line plays first
    await new Promise(resolve => setTimeout(resolve, 3000));
    ...
```

**Evidence:** Voice notification system was removed in v4.3.2-dev/v4.4.0 cleanup. This code path survives because we focused on hook files and settings, not handler internals.

**Impact:** Adds a 3-second delay after doc updates (the `await` on the setTimeout). The voice notification itself is a no-op (just a console.error) but the delay is real.

---

## 4. Design Flaws

### FLAW 1: The StopOrchestrator Paradox

**The problem:** StopOrchestrator was designed as the "single entry point for Stop hooks" (its own docstring says so). But hooks.jsonc registers 5 separate hooks on the Stop event:

```
Stop event → 5 hooks spawned in parallel:
  1. LastResponseCache.hook.ts  (standalone)
  2. TerminalState.hook.ts      (standalone)
  3. DocIntegrity.hook.ts        (standalone — calls same handler as #4)
  4. StopOrchestrator.hook.ts    (orchestrator — calls TabState, RebuildSkill, AlgorithmEnrichment, DocCrossRefIntegrity)
  5. AlgorithmTracker.hook.ts    (standalone)
```

**Root cause:** The orchestrator pattern was started but never completed. TabState and DocCrossRefIntegrity were moved into it, but LastResponseCache, AlgorithmTracker, and TerminalState were not. Then standalone hooks were left registered alongside the orchestrator.

**Consequences:**
- 5 separate processes spawned per Stop event (each reads stdin, parses JSON)
- Transcript parsed independently by each hook that needs it
- DocCrossRefIntegrity called from two paths
- Race conditions on shared state files (tab state, drift state)

**How I found this:** Cross-referenced `config/hooks.jsonc` Stop registrations against the StopOrchestrator's import list and handler array. Then verified which handler files actually exist on disk.

### FLAW 2: Giant Monolithic Files

Files over 500 lines that do multiple unrelated things:

**PAI/Tools/ (CLI tools):**
- `algorithm.ts` — 1,515 lines: CLI arg parsing + PRD parsing + loop execution + state management + status display + pause/resume/stop commands
- `IntegrityMaintenance.ts` — 926 lines: transcript reading + inference prompting + update generation + notification dispatch
- `Banner.ts` — 866 lines: 5 banner design themes + stats collection + terminal width detection
- `pai.ts` — 808 lines: CLI launcher + MCP management + version checking + upgrade orchestration

**hooks/ (lifecycle handlers):**
- `handlers/DocCrossRefIntegrity.ts` — 886 lines: 6 pattern checkers + inference analysis + review queue management + auto-fix logic + drift reporting
- `RatingCapture.hook.ts` — 553 lines: explicit rating parser + 200-line sentiment prompt + implicit sentiment analysis + learning capture + failure capture
- `SessionAutoName.hook.ts` — 524 lines: 185-word noise filter + name generation + lock management + background inference upgrade + rework detection + work.json sync

**How I found this:** `find ... | xargs wc -l | sort -rn` across the .claude directory, then read each file to understand its responsibility boundaries.

### FLAW 3: Banner File Proliferation

7 files totaling ~167KB dedicated to terminal startup banners:

| File | Lines | KB |
|------|-------|----|
| Banner.ts | 866 | 39 |
| NeofetchBanner.ts | 727 | 29 |
| BannerRetro.ts | 728 | 28 |
| BannerNeofetch.ts | 598 | 26 |
| BannerMatrix.ts | 693 | 22 |
| BannerTokyo.ts | 176 | 12 |
| BannerPrototypes.ts | 169 | 11 |

Only `Banner.ts` is referenced by `pai.ts` (the CLI entry point). The others appear to be experimental designs or prior iterations.

### FLAW 4: Inconsistent Handler Extraction

No clear rule for when a hook should extract logic into `handlers/`:

| Pattern | Examples |
|---------|----------|
| Thin hook → handler | DocIntegrity→DocCrossRefIntegrity, UpdateCounts→UpdateCounts handler |
| Monolithic hook | RatingCapture (553 lines all inline), SessionAutoName (524 lines all inline), LoadContext (536 lines all inline) |

The handler pattern is better (separation of concerns, testability, shared by orchestrator) but it's applied inconsistently.

### FLAW 5: ACTIONS v1/v2 Dual System

`PAI/ACTIONS/lib/` contains both generations:

| Version | Files | Used By |
|---------|-------|---------|
| v1 | runner.ts (258 lines), types.ts (184 lines) | pai.ts (CLI entry point) |
| v2 | runner.v2.ts (314 lines), types.v2.ts (177 lines) | action files, pipeline-runner.ts |

Both are actively imported. Migration requires updating pai.ts to use the v2 runner.

### FLAW 6: Path Confusion (skills/PAI/ vs PAI/)

Historical path migration left stale references. In earlier versions, PAI tools lived under `skills/PAI/Tools/`. They were moved to `PAI/Tools/` but some imports weren't updated:

- `StopOrchestrator.hook.ts:23` → `../skills/PAI/Tools/TranscriptParser` (BROKEN)
- Possible other stale references in skill files or docs

---

## 5. Architecture Strengths

Not everything is broken. These patterns are well-designed:

1. **Config-as-code pipeline** — `config/*.jsonc` → `BuildSettings.ts` → `settings.json` is clean. Source of truth is unambiguous. Rebuild detection uses mtime comparison. Validation catches missing fields before write.

2. **Shared hook library** — `hooks/lib/` has 17 focused utility modules (atomic.ts for safe writes, paths.ts for PAI_DIR resolution, time.ts for PST timestamps, identity.ts for DA/principal names). Good extraction.

3. **Algorithm effort tiering** — MICRO (single change, <30s) vs Standard+ (load full algorithm) avoids the overhead of the 7-phase framework on trivial tasks.

4. **Handler extraction pattern** — Where applied (DocCrossRefIntegrity, BuildSettings, TabState, UpdateCounts), it provides clean separation, testability, and reuse by orchestrators.

5. **Atomic file operations** — `hooks/lib/atomic.ts` provides `atomicWriteJSON()` used consistently across hooks. Prevents corruption from concurrent writes.

6. **SessionAutoName lock management** — mkdir-based POSIX locks with stale detection (10s timeout). Handles concurrent sessions writing to the same session-names.json.

---

## 6. Proposed Improvement Path

### P0: Fix Runtime Bugs (immediate)
1. Fix StopOrchestrator phantom imports (remove AlgorithmEnrichment, RebuildSkill)
2. Fix StopOrchestrator TranscriptParser import path
3. Deduplicate DocCrossRefIntegrity (remove from either hooks.jsonc or StopOrchestrator)
4. Fix IntegrityMaintenance _SYSTEM path
5. Remove voice remnants from DocCrossRefIntegrity

### P1: Complete Stop Event Consolidation
Move all Stop hooks into StopOrchestrator: LastResponseCache, AlgorithmTracker, TerminalState. Register only StopOrchestrator on Stop event. One process, one stdin read, one transcript parse, all handlers get parsed data via Promise.allSettled.

### P2: Break Up Large Files
Extract focused modules from monolithic files. Priority targets:
- DocCrossRefIntegrity (886 lines) → lib/doc-patterns.ts, lib/doc-inference.ts, lib/doc-review-queue.ts
- RatingCapture (553 lines) → lib/rating-parser.ts, lib/rating-learning.ts, data/sentiment-prompt.ts
- SessionAutoName (524 lines) → lib/session-lock.ts, lib/session-name-inference.ts, data/noise-words.ts
- algorithm.ts (1,515 lines) → algorithm-cli.ts, algorithm-loop.ts, algorithm-state.ts, algorithm-prd.ts

### P3: Banner Consolidation
Audit which banner files are actually invoked. Archive or delete unused variants. Consolidate active designs into Banner.ts with a theme selector.

### P4: Longer-Term Architecture
- ACTIONS v1→v2 migration (update pai.ts to use v2 runner)
- Path canonicalization audit (find all `skills/PAI/` references)
- Test coverage for security-critical hooks
- Hook performance measurement (5 hooks on UserPromptSubmit = 5 processes per prompt)

---

## 7a. Decomposition Blueprints

Detailed proposed file structures for the major splits in P2/P3. Source: ARCHITECTURAL-UNDERSTANDING.md §7.

### algorithm.ts → algorithm/ (1,515 lines → 5 modules)
```
PAI/Tools/algorithm/
├── index.ts          ← thin CLI router
├── cli.ts            ← arg parsing, help, command dispatch
├── loop.ts           ← loop execution engine (spawn, iterate, pause/resume/stop)
├── prd.ts            ← PRD creation, frontmatter parsing, criteria extraction
├── dashboard.ts      ← state sync to algorithms/, session-names.json
└── notifications.ts  ← notification routing at key moments
```

### pai.ts → pai/ (808 lines → 4 modules)
```
PAI/Tools/pai/
├── index.ts      ← thin CLI entry
├── mcp.ts        ← MCP shortcuts, loading, profile management
├── launch.ts     ← Claude launch, wallpaper, banner invocation
└── commands.ts   ← update, version, profiles, mcp-list commands
```

### IntegrityMaintenance.ts → integrity/ (926 lines → 3 modules)
```
PAI/Tools/integrity/
├── scan.ts       ← detect issues (file existence, cross-refs, checksums)
├── report.ts     ← format and output integrity reports
└── fix.ts        ← apply automated fixes
```

### Banner consolidation (7 files, ~4,400 lines → banners/ with theme system)
```
PAI/Tools/banners/
├── index.ts      ← exports renderBanner(theme: BannerTheme)
├── types.ts      ← BannerTheme enum, shared interfaces
├── default.ts    ← main PAI banner (was: Banner.ts)
├── matrix.ts     ← (was: BannerMatrix.ts)
├── retro.ts      ← (was: BannerRetro.ts)
├── neofetch.ts   ← merge BannerNeofetch.ts + NeofetchBanner.ts
├── tokyo.ts      ← (was: BannerTokyo.ts)
└── prototypes.ts ← (was: BannerPrototypes.ts)
```

### SecurityValidator extraction (618 lines → 3 files)
```
hooks/lib/security-patterns.ts  ← pattern definitions + loading
hooks/lib/security-decision.ts  ← decision engine (continue/ask/block)
hooks/SecurityValidator.hook.ts ← thin orchestrator (target: ~150 lines)
```

### RatingCapture extraction (553 lines → 2 files)
```
hooks/lib/rating-capture.ts   ← explicit + implicit + sentiment detection (testable)
hooks/RatingCapture.hook.ts   ← thin orchestrator (~100 lines)
```

### LoadContext extraction (536 lines → composable loaders)
```
hooks/lib/context-loaders/
├── wisdom.ts     ← load from MEMORY/WISDOM/
├── work.ts       ← load from MEMORY/WORK/ (active PRD)
├── state.ts      ← load from MEMORY/STATE/
└── learning.ts   ← load from MEMORY/LEARNING/
```

### change-detection.ts (612 lines → 3 modules)
```
hooks/lib/change-detection/
├── index.ts      ← re-exports (backward compatible)
├── watcher.ts    ← file system watching utilities
├── diff.ts       ← diff computation
└── analyzer.ts   ← code change analysis
```

---

## 7. Key Technical Details for Future Sessions

### BuildSettings.ts Merge Behavior
`BuildSettings.ts` (hooks/handlers/) does a **full spread-merge rebuild** — not a selective update. The merged object is assembled from scratch every time:
```
{ ...expandedPrefs, ...permissions, ...identity, ...expandedHooks, ...notifications, spinnerVerbs, spinnerTipsOverride, counts (preserved), feedbackSurveyState (preserved) }
```
Manual edits to settings.json are **overwritten** on next SessionStart when any config/*.jsonc file is newer.

### The 23 Actual Hook Files
AgentExecutionGuard, AlgorithmTracker, ConfigChange, DocIntegrity, GitHubWriteGuard, IntegrityCheck, LastResponseCache, LoadContext, ModeClassifier, PostCompactRecovery, PRDSync, QuestionAnswered, RatingCapture, RelationshipMemory, SecurityValidator, SessionAutoName, SessionCleanup, SkillGuard, StopOrchestrator, TerminalState, UpdateCounts, UpdateTabTitle, WorkCompletionLearning

### Hook Execution per Event
- **SessionStart:** 4 hooks (TerminalState, LoadContext, BuildCLAUDE, BuildSettings + PostCompactRecovery on compact)
- **UserPromptSubmit:** 5 hooks (ModeClassifier, RatingCapture, TerminalState, UpdateTabTitle, SessionAutoName)
- **PreToolUse:** up to 4 hooks depending on matcher (SecurityValidator on Bash/Edit/Write/Read, GitHubWriteGuard on Bash, TerminalState on AskUserQuestion, AgentExecutionGuard on Task, SkillGuard on Skill)
- **PostToolUse:** 2 hooks (QuestionAnswered on AskUserQuestion, PRDSync on Write/Edit)
- **Stop:** 5 hooks (LastResponseCache, TerminalState, DocIntegrity, StopOrchestrator, AlgorithmTracker)
- **SessionEnd:** 5 hooks (WorkCompletionLearning, SessionCleanup, RelationshipMemory, UpdateCounts, IntegrityCheck)
- **ConfigChange:** 1 hook (ConfigChange)

---

## 8. Future Vision

Architectural directions worth considering for v4.5.0+. Not tasks yet — possibilities. Source: ARCHITECTURAL-UNDERSTANDING.md §8.

### 8.1 Structured Agent Orchestration
Currently agents are standalone files with no composition framework. `algorithm.ts loop` mode could auto-select agents based on task type (Architect for design, Engineer for implementation, QATester for verification), creating a multi-agent pipeline rather than one agent doing all phases.

### 8.2 Skill Composition Pipeline
Skills are invoked individually. A "pipeline" primitive that chains skills (`research → synthesize → report`) would enable complex workflows. `PipelineOrchestrator.ts` already exists but isn't wired to the skill system.

### 8.3 Memory with Relevance Scoring
Currently LoadContext injects all active memory. Semantic relevance scoring would inject only memory relevant to the current task, preventing context pollution as MEMORY/ grows.

### 8.4 Dashboard as First-Class Component
`PipelineMonitor.ts` + `pipeline-monitor-ui/` exist but aren't integrated into the main session experience. A persistent dashboard (electron or tmux pane) showing algorithm state, ISC progress, and session stats in real-time.

### 8.5 PAI Algorithm v4.0
Current algorithm (v3.9.0) is spec-only — Claude reads it and follows it. Future: `algorithm.ts` could enforce phase transitions programmatically, validate ISC format before proceeding, and prevent phase-skipping at the execution level.

### 8.6 Version Central Registry
Single `PAI/version.ts` exports `PAI_VERSION`. BuildSettings.ts, BuildCLAUDE.ts, install.sh, manifest.json all import/read it. Eliminates version string sprawl.

### 8.7 Typed Skill Manifests
Standardized YAML frontmatter for every skill:
```yaml
---
skill: research/multi-agent
description: Multi-agent research synthesis
effort: Standard+
requires: [ClaudeResearcher, PerplexityResearcher]
outputs: [markdown-report]
---
```
Enables programmatic skill discovery, composition, and validation. Pairs with §8.2.

### 8.8 Skill Discovery System
Build a queryable skill registry: `PAI/Tools/SkillIndex.ts` scans `skills/` recursively, parses each SKILL.md for metadata, outputs to `MEMORY/STATE/skill-index.json`. Add `pai skills list [--category <cat>]` and `pai skills search <query>` CLI commands.

### 8.9 Expanded Test Coverage
Priority order for new tests:
1. Security-critical: SecurityValidator, AgentExecutionGuard, GitHubWriteGuard
2. Most complex: algorithm.ts (PRD parsing, loop state machine)
3. After extraction: RatingCapture, LoadContext (once split to lib/)
4. Infrastructure: Inference.ts (mock API), IntegrityMaintenance
5. Integration: full SessionStart → SessionEnd lifecycle test
