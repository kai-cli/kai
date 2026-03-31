# PAI — Architectural Index & Improvement Plan
> v4.4.1-dev | Created 2026-03-10 | Branch: v4.4.1-dev
>
> This document is the **single source of architectural truth** for the PAI project. It covers what the system is, how it works, where the design flaws are, and what to do about them. Reference this before making architectural decisions.

---

## Table of Contents
1. [What Is PAI?](#1-what-is-pai)
2. [System Map](#2-system-map)
3. [Core Subsystems](#3-core-subsystems)
4. [Data Flow](#4-data-flow)
5. [Large File Analysis](#5-large-file-analysis)
6. [Design Flaws](#6-design-flaws)
7. [Improvement Checklist — v4.4.1](#7-improvement-checklist--v441)
8. [Future Vision](#8-future-vision)

---

## 1. What Is PAI?

**PAI (Personal AI Infrastructure)** is a structured personal digital assistant built natively on top of Claude Code. It wraps every Claude session with a lifecycle hook system, enforces a 7-phase algorithmic problem-solving methodology, and maintains persistent memory across sessions.

The central idea: **Claude is not the DA — PAI is.** Claude is the inference engine. PAI is the system that makes Claude behave like an intelligent, opinionated, memorious assistant with personality, security policies, and structured output.

### The Three Pillars

| Pillar | Mechanism | Purpose |
|--------|-----------|---------|
| **Structured Execution** | PAI Algorithm v3.9.0 | 7-phase problem-solving with ISC verification |
| **Persistent Memory** | MEMORY/ hierarchy + hooks | Context, learning, relationship state across sessions |
| **Identity + Personality** | config/identity.jsonc + agents/ | Consistent voice, values, preferences |

### What "Euphoric Surprise" Means

The system's north star metric is a 9-10 user rating (called "Euphoric Surprise"). Every architectural decision should be evaluated against: *does this make the assistant more likely to genuinely delight the user?*

---

## 2. System Map

```
Releases/v4.4.0/.claude/           ← THE PAI RUNTIME (installed to ~/.claude/)
│
├── CLAUDE.md                      ← Loaded first. Mode router (NATIVE/ALGORITHM/MINIMAL)
├── settings.json                  ← GENERATED. Never edit directly.
├── manifest.json                  ← SHA-256 integrity manifest (204KB)
├── install.sh                     ← Installation orchestrator
│
├── config/                        ← SOURCE OF TRUTH for settings
│   ├── identity.jsonc             ← DA identity + principal info
│   ├── hooks.jsonc                ← All 23 hook registrations
│   ├── permissions.jsonc          ← Security allow/ask/deny lists
│   ├── notifications.jsonc        ← Routing: ntfy, Discord, Twilio
│   ├── preferences.jsonc          ← Env vars, tech stack, memory paths
│   ├── spinner-verbs.json         ← 426 personality verbs (loaded per session)
│   └── spinner-tips.json          ← 198 feature tips (loaded per session)
│
├── hooks/                         ← Lifecycle event handlers (23 hooks)
│   ├── *.hook.ts                  ← 23 hook files
│   ├── handlers/                  ← 6 complex handler scripts
│   └── lib/                       ← 17 shared utility libraries
│
├── agents/                        ← 14 specialized agent personas
│   ├── *.md                       ← Agent definitions
│   └── partials/output-format.md  ← Canonical output format (shared)
│
├── PAI/
│   ├── Algorithm/                 ← Algorithm spec (v3.9.0)
│   ├── Tools/                     ← 42 TypeScript utilities
│   └── ACTIONS/                   ← Action runner (v1 + v2 — needs migration)
│
├── skills/                        ← 12 categories, 47+ skills
├── MEMORY/                        ← Runtime memory hierarchy
├── USER/                          ← User customizations (upgrade-safe)
├── lib/migration/                 ← v2.5/v3.0→current migration pipeline
├── PAI-Install/                   ← Electron installer (3.6MB, not runtime)
└── tests/                         ← 7 test files, 143+ passing tests
```

### Config → Settings Pipeline

```
config/identity.jsonc    ─┐
config/hooks.jsonc        │
config/permissions.jsonc  ├──► BuildSettings.ts ──► settings.json
config/notifications.jsonc│        (full rebuild)       (GENERATED)
config/preferences.jsonc  │
config/spinner-*.json    ─┘
```

`settings.json` is always **rebuilt from scratch** on SessionStart. Manual edits are overwritten. Always edit the `config/` sources.

---

## 3. Core Subsystems

### 3.1 Hook Lifecycle (23 hooks)

```
SESSION START ──► [TerminalState] [BuildSettings] [BuildCLAUDE] [LoadContext] [PostCompactRecovery]
USER PROMPT   ──► [ModeClassifier] [RatingCapture] [UpdateTabTitle] [SessionAutoName] [TerminalState]
PRE TOOL USE  ──► [SecurityValidator] [GitHubWriteGuard] [AgentExecutionGuard] [SkillGuard] [TerminalState]
POST TOOL USE ──► [QuestionAnswered] [PRDSync]
STOP          ──► [LastResponseCache] [TerminalState] [DocIntegrity] [StopOrchestrator] [AlgorithmTracker]
SESSION END   ──► [WorkCompletionLearning] [SessionCleanup] [RelationshipMemory] [UpdateCounts] [IntegrityCheck]
CONFIG CHANGE ──► [ConfigChange]
```

**Hooks by type:**
- **Blocking** (inject to stdout): LoadContext, ModeClassifier, RatingCapture
- **Decision** (exit codes block/allow): SecurityValidator, GitHubWriteGuard, AgentExecutionGuard, SkillGuard
- **Side-effect** (async, non-blocking): Everything else

### 3.2 Hook Library (hooks/lib/, 17 files)

| File | Purpose |
|------|---------|
| atomic.ts | Atomic file writes (prevent corruption) |
| change-detection.ts | File/code change detection (612 lines — largest lib) |
| classify.ts | Mode tier classification |
| hook-io.ts | Stdin reader for hook payloads |
| identity.ts | DA + principal identity loading |
| learning-readback.ts | Learning retrieval for session context |
| learning-utils.ts | Learning categorization helpers |
| notifications.ts | ntfy + Discord routing |
| output-validators.ts | Tab output validation |
| paths.ts | Canonical path construction |
| payload-schema.ts | Hook payload validation (all 6 event types) |
| prd-template.ts | PRD markdown template generator |
| prd-utils.ts | PRD frontmatter parsing + criteria extraction |
| recovery-block.ts | Post-compact recovery utilities |
| tab-constants.ts | Kitty tab state constants |
| tab-setter.ts | Kitty tab manipulation (363 lines) |
| time.ts | Timestamp utilities |

### 3.3 Hook Handlers (hooks/handlers/, 6 files)

| File | Purpose | Called By |
|------|---------|-----------|
| BuildSettings.ts | Merges config/*.jsonc → settings.json | BuildSettings.hook.ts on SessionStart |
| BuildCLAUDE.ts | CLAUDE.md.template → CLAUDE.md | BuildCLAUDE.hook.ts on SessionStart |
| DocCrossRefIntegrity.ts | Cross-reference validation | DocIntegrity.hook.ts on Stop |
| SystemIntegrity.ts | System integrity checks | IntegrityCheck.hook.ts on SessionEnd |
| TabState.ts | Tab state manipulation | TerminalState.hook.ts |
| UpdateCounts.ts | Runtime counts cache | UpdateCounts.hook.ts on SessionEnd |

### 3.4 Agent System (14 agents)

| Agent | Persona | Primary Use |
|-------|---------|-------------|
| Algorithm.md | Vera Sterling | ISC specification, verification |
| Architect.md | Serena Blackwood | System design, architecture |
| Engineer.md | Marcus Webb | TDD, implementation |
| QATester.md | Quinn Torres | QA, edge cases |
| Artist.md | — | Visual/creative work |
| Designer.md | — | UX/design |
| ClaudeResearcher.md | — | Claude-native research |
| CodexResearcher.md | — | Code analysis |
| GeminiResearcher.md | — | Gemini API research |
| GrokResearcher.md | — | Grok API research |
| PerplexityResearcher.md | — | Perplexity research |
| BrowserAgent.md | — | Browser automation |
| Pentester.md | — | Security testing |
| UIReviewer.md | — | UI/UX review |

**Note:** BrowserAgent, Pentester, UIReviewer do NOT use canonical output format from `partials/output-format.md`. They have inline formats.

### 3.5 PAI Tools (42 TypeScript files)

**Tier 1 — Core Runtime:**
- `pai.ts` (808 lines) — CLI entry point
- `algorithm.ts` (1,515 lines) — Algorithm runner (loop + interactive)
- `upgrade.ts` (439 lines) — Install/upgrade/rollback engine
- `Inference.ts` — Anthropic API wrapper (haiku for speed)
- `GenerateManifest.ts` — SHA-256 integrity manifest builder

**Tier 2 — Analysis & Memory:**
- `ActivityParser.ts` (688 lines), `TranscriptParser.ts` (418 lines)
- `SessionHarvester.ts` (392 lines), `LearningPatternSynthesis.ts` (399 lines)
- `FailureCapture.ts` (554 lines), `OpinionTracker.ts` (419 lines)
- `RelationshipReflect.ts` (536 lines), `SessionProgress.ts` (370 lines)
- `WisdomCrossFrameSynthesizer.ts`, `WisdomDomainClassifier.ts`, `WisdomFrameUpdater.ts`

**Tier 3 — Display/UI:**
- `Banner.ts` (866 lines) — Primary banner
- `BannerMatrix.ts` (693 lines), `BannerNeofetch.ts` (598 lines)
- `BannerPrototypes.ts`, `BannerRetro.ts` (728 lines), `BannerTokyo.ts`
- `NeofetchBanner.ts` (727 lines)
- `PAILogo.ts`, `PreviewMarkdown.ts`

**Tier 4 — Utilities:**
- `IntegrityMaintenance.ts` (926 lines), `SecretScan.ts`
- `LoadSkillConfig.ts`, `GetCounts.ts`, `FeatureRegistry.ts`
- `PipelineMonitor.ts` (602 lines), `PipelineOrchestrator.ts`
- `RebuildPAI.ts`, `AlgorithmPhaseReport.ts`

**Tier 5 — Media:**
- `ExtractTranscript.ts`, `SplitAndTranscribe.ts`, `GetTranscript.ts`
- `YouTubeApi.ts`, `AddBg.ts`, `RemoveBg.ts`
- `extract-transcript.py` (Python, justified: faster-whisper CTranslate2)

**Tier 6 — Duplicate/Legacy:**
- `BuildCLAUDE.ts` — Duplicated in both PAI/Tools/ and hooks/handlers/
- `PAI/ACTIONS/Actions.ts` (v1) + `ActionsV2.ts` (v2) — Both active

### 3.6 Memory System

```
MEMORY/
├── WISDOM/          ← Insights: books, movies, interviews, principles
├── WORK/{slug}/     ← Active projects: PRD.md (single source of truth)
├── LEARNING/        ← Signals, phase learnings, reflections
├── STATE/           ← Runtime: algorithms/, session-names.json, model-cache.txt
├── SECURITY/        ← Events: security-events.jsonl
├── SIGNALS/         ← Ratings: ratings.jsonl
└── RELATIONSHIP/    ← Notes on people
```

**PRD.md is the work system's single source of truth:**
```yaml
---
prd: true
id: PRD-20260207-auth
status: active
mode: ALGORITHM
effort_level: Extended
phase: Build
progress: 45
---
# [Task Title]
## Context
## Criteria
- [ ] ISC-1: Criterion description (8-12 words, binary, verifiable)
## Decisions
## Verification
```

---

## 4. Data Flow

### Session Start Flow
```
Claude Code starts
  → SessionStart fires
  → BuildSettings.ts: config/*.jsonc → settings.json
  → BuildCLAUDE.ts: CLAUDE.md.template → CLAUDE.md
  → LoadContext.ts: MEMORY/* → stdout injection into Claude context
  → TerminalState: Kitty tab initialized
  → PostCompactRecovery: Restore state if post-compact
```

### User Prompt Flow
```
User sends message
  → UserPromptSubmit fires
  → ModeClassifier: classify effort tier → inject [TIER] into prompt
  → RatingCapture: detect explicit/implicit ratings → ratings.jsonl
  → UpdateTabTitle: update Kitty tab title
  → SessionAutoName: auto-name session via Inference.ts (haiku)
  → Claude processes with CLAUDE.md mode format
```

### Pre-Tool Security Flow
```
Claude attempts tool use
  → PreToolUse fires (matched by tool type)
  → SecurityValidator: pattern match → continue/ask/block
  → GitHubWriteGuard: check for write to protected repos
  → AgentExecutionGuard: validate agent Task calls
  → SkillGuard: prevent erroneous Skill() calls
  → Tool executes if all guards pass
```

### Work Tracking Flow
```
Claude writes/edits PRD.md
  → PostToolUse:PRDSync fires
  → Parse frontmatter + criteria checkboxes
  → Write to work.json (dashboard source)
  → Dashboard/algorithm.ts reads work.json
```

### Session End Flow
```
Session ends
  → SessionEnd fires
  → WorkCompletionLearning: analyze work → LEARNING/
  → SessionCleanup: temp files, state reset
  → RelationshipMemory: update people notes
  → UpdateCounts.ts: runtime counts → settings.json counts section
  → IntegrityCheck: doc drift detection
```

---

## 5. Large File Analysis

Files over 400 lines are candidates for decomposition:

| File | Lines | Top Concern | Recommended Split |
|------|-------|-------------|-------------------|
| `PAI/Tools/algorithm.ts` | 1,515 | Monolith: CLI + loop + PRD + dashboard + state | 5 modules (see §7.1) |
| `hooks/handlers/IntegrityMaintenance.ts` | 926 | Scan + report + fix all in one | 3 modules (see §7.2) |
| `PAI/Tools/Banner.ts` | 866 | One of 7 duplicate-purpose banner files | Consolidate to banners/ (see §7.3) |
| `PAI/Tools/pai.ts` | 808 | CLI router + MCP manager + launcher combined | 3 modules (see §7.4) |
| `PAI/Tools/BannerRetro.ts` | 728 | Banner variant | → banners/ subdir |
| `PAI/Tools/NeofetchBanner.ts` | 727 | Banner variant | → banners/ subdir |
| `PAI/Tools/BannerMatrix.ts` | 693 | Banner variant | → banners/ subdir |
| `PAI/Tools/ActivityParser.ts` | 688 | Reasonable size | Low priority |
| `hooks/lib/change-detection.ts` | 612 | Three concerns: watch/diff/analyze | 2-3 modules (see §7.5) |
| `hooks/SecurityValidator.hook.ts` | 618 | Pattern loading + decision engine inline | Extract to lib (see §7.6) |
| `PAI/Tools/PipelineMonitor.ts` | 602 | Large UI monitor | Low priority |
| `PAI/Tools/BannerNeofetch.ts` | 598 | Banner variant | → banners/ subdir |
| `PAI/Tools/FailureCapture.ts` | 554 | Reasonable | Low priority |
| `hooks/RatingCapture.hook.ts` | 553 | Explicit + implicit + sentiment combined | Extract to lib (see §7.7) |
| `hooks/LoadContext.hook.ts` | 536 | 4 memory sources + output building | Extract loaders to lib (see §7.8) |
| `PAI/Tools/RelationshipReflect.ts` | 536 | Reasonable | Low priority |
| `hooks/SessionAutoName.hook.ts` | 524 | Inference calls inline | Extract inference to lib |
| `hooks/lib/tab-setter.ts` | 363 | Kitty API could be separate | Low priority |
| `hooks/lib/prd-utils.ts` | 284 | Reasonable | Low priority |
| `hooks/lib/learning-readback.ts` | 222 | Reasonable | Low priority |

---

## 6. Design Flaws

These are **architectural issues** — not bugs, but decisions that create friction, confusion, or maintenance burden.

### F1. CLAUDE.md Version String is Wrong [CRITICAL]
`CLAUDE.md` line 1 says `# PAI 4.3.0` but we're in the v4.4.0 release and v4.4.1-dev branch. The most important file in the system has a stale version.

**Fix:** Update to `# PAI 4.4.1` when releasing, or make version dynamic via BuildCLAUDE.ts template injection.

### F2. TerminalState Hook Spans 4 Lifecycle Events [HIGH]
`TerminalState.hook.ts` is registered in SessionStart, UserPromptSubmit (as match for AskUserQuestion), PreToolUse, and Stop. It does different things in each event. This violates single-responsibility and makes the hook hard to reason about.

**Fix:** Split into `TerminalState-SessionStart.hook.ts`, `TerminalState-PreToolUse.hook.ts`, `TerminalState-Stop.hook.ts`. Or document explicitly why one file handles all events (stateful resource pattern).

### F3. Two Active Action Runners [HIGH]
`PAI/ACTIONS/Actions.ts` (v1) and `PAI/ACTIONS/ActionsV2.ts` (v2) both exist and are both imported by different parts of the system. This creates dual maintenance burden and potential behavioral divergence.

**Fix:** Migrate pai.ts to use v2, then delete v1.

### F4. settings.json Mixes Static Config + Runtime State [MEDIUM]
`settings.json` has both static configuration (hooks, permissions, identity) and dynamic runtime state (counts, which are reset to zero by BuildSettings.ts and populated by UpdateCounts.hook.ts at runtime). On SessionStart, runtime state is wiped.

**Fix:** Split into `settings.json` (static, generated from config/) and `state.json` (runtime, never rebuilt). Prevents count loss.

### F5. BuildCLAUDE.ts Exists in Two Places [MEDIUM]
The handler is at `hooks/handlers/BuildCLAUDE.ts` AND `PAI/Tools/BuildCLAUDE.ts`. Unclear if they're in sync.

**Fix:** Audit both files. Keep one canonical version, make the other a symlink or remove it.

### F6. No Unified Skill Discovery [MEDIUM]
47 skills across 12 categories with inconsistent nesting. No programmatic skill registry. `LoadSkillConfig.ts` exists but isn't wired to skill discovery. Finding what skills exist requires reading 12+ directories.

**Fix:** Build a skill index (see §7.9). `pai skills list` command.

### F7. Banner Proliferation Without Selection UX [MEDIUM]
7 banner tools (866 + 728 + 727 + 693 + 598 + ~400 + ~300 lines = ~4,400 lines). No clear mechanism for selecting which banner runs. `pai.ts` hardcodes `Banner.ts`. The others are manual invocations.

**Fix:** Consolidate to `banners/` subdirectory with theme enum. `pai banner --theme matrix`.

### F8. PAI-Install Ships in Main Repo [LOW-MEDIUM]
`PAI-Install/` is a 3.6MB Electron+Next.js app with its own package.json, bun.lock, and build artifacts. It's a distribution/installation tool, not runtime. It inflates the repo and adds unrelated complexity.

**Fix:** Move to separate repo `pai-install` or `.gitignore` the `node_modules` and dist artifacts.

### F9. Missing Hooks for Real Lifecycle Events [LOW]
These Claude Code lifecycle events fire but have no hooks:
- `PreCompact` — fires before context window compaction (was a hook, removed)
- `WorktreeCreate` / `WorktreeRemove` — worktree events (hooks removed)
- `TaskCompleted` / `TeammateIdle` — task system events (hooks removed)

The events are real. Removing hooks is correct if the events aren't useful. But they should be explicitly documented as "unused lifecycle events" so future contributors don't wonder if hooks are missing.

**Fix:** Add a `hooks/README.md` section "Unused Lifecycle Events" explaining which events fire but aren't hooked and why.

### F10. Test Coverage is 7 Files for 90+ Components [LOW]
Only 7 test files cover: AtomicWrite, BuildSettings, ModeClassifier, PayloadSchema, PostCompactRecovery, Upgrade, Integration. Untested: 23 hooks, 42 tools, 47 skills, 14 agents.

**Fix:** Prioritize security-critical: SecurityValidator, AgentExecutionGuard, GitHubWriteGuard. Then algorithm.ts (most complex). See §7.10.

### F11. Algorithm.ts is a 1,515-Line Monolith [HIGH]
`algorithm.ts` combines: CLI argument parsing, PRD frontmatter parsing, loop execution engine (spawn/iterate), dashboard state sync, session name registration, notification routing, pause/resume/stop state machine, ISC criteria extraction. Any change to one concern requires understanding all concerns.

**Fix:** Decompose (see §7.1).

### F12. No Memory TTL or Archival [LOW]
`MEMORY/WISDOM/`, `MEMORY/LEARNING/`, and `MEMORY/RELATIONSHIP/` grow unbounded. No archival, pruning, or TTL system exists. Over time, LoadContext.hook.ts will inject increasingly large context.

**Fix:** Add archival strategy. `SessionEnd`: if LEARNING file > X entries, move old ones to `LEARNING/archive/`. Add `pai memory stats` command.

---

## 7. Improvement Checklist — v4.4.1

Priority: **P1** = do first (broken/critical), **P2** = high (impactful), **P3** = medium (quality), **P4** = low (nice-to-have)

---

### §7.1 Decompose algorithm.ts [P2]

**Current:** 1,515-line monolith
**Goal:** 5 focused modules (~200-400 lines each)

```
PAI/Tools/algorithm/
├── index.ts          ← thin CLI router (was: algorithm.ts)
├── cli.ts            ← arg parsing, help, command dispatch
├── loop.ts           ← loop execution engine (spawn, iterate, pause/resume/stop)
├── prd.ts            ← PRD creation, frontmatter parsing, criteria extraction
├── dashboard.ts      ← state sync to algorithms/, session-names.json
└── notifications.ts  ← notification routing at key moments
```

- [ ] Create `PAI/Tools/algorithm/` directory
- [ ] Extract CLI parsing and command dispatch → `cli.ts`
- [ ] Extract loop execution (spawn + iterate + state machine) → `loop.ts`
- [ ] Extract PRD management (create, parse frontmatter, extract criteria) → `prd.ts`
- [ ] Extract dashboard state sync → `dashboard.ts`
- [ ] Extract notification routing → `notifications.ts`
- [ ] Update `algorithm.ts` → thin orchestrator that imports from above
- [ ] Update `pai.ts` import path
- [ ] Run existing tests to verify no regressions

---

### §7.2 Decompose IntegrityMaintenance.ts [P3]

**Current:** 926-line file mixing scan, report generation, and fix application
**Goal:** 3 focused modules

```
PAI/Tools/integrity/
├── scan.ts       ← detect issues (file existence, cross-refs, checksums)
├── report.ts     ← format and output integrity reports
└── fix.ts        ← apply automated fixes
```

- [ ] Create `PAI/Tools/integrity/` directory
- [ ] Extract issue detection logic → `scan.ts`
- [ ] Extract report formatting → `report.ts`
- [ ] Extract fix application → `fix.ts`
- [ ] Update `IntegrityMaintenance.ts` to import from above or replace entirely

---

### §7.3 Consolidate Banner Tools [P3]

**Current:** 7 standalone banner files (~4,400 lines total) with no unified interface
**Goal:** Single `banners/` directory with theme system

```
PAI/Tools/banners/
├── index.ts      ← exports renderBanner(theme: BannerTheme)
├── types.ts      ← BannerTheme enum, shared interfaces
├── default.ts    ← main PAI banner (was: Banner.ts)
├── matrix.ts     ← matrix theme (was: BannerMatrix.ts)
├── retro.ts      ← retro theme (was: BannerRetro.ts)
├── neofetch.ts   ← neofetch theme (was: BannerNeofetch.ts, NeofetchBanner.ts → merge)
├── tokyo.ts      ← tokyo theme (was: BannerTokyo.ts)
└── prototypes.ts ← prototypes (was: BannerPrototypes.ts)
```

- [ ] Create `PAI/Tools/banners/` directory
- [ ] Create `types.ts` with `BannerTheme` enum
- [ ] Move and rename each banner file
- [ ] Merge `BannerNeofetch.ts` and `NeofetchBanner.ts` (two neofetch implementations — pick better one)
- [ ] Create `index.ts` with unified `renderBanner(theme)` export
- [ ] Update `pai.ts` to use `banners/index.ts`
- [ ] Add `pai banner --theme <name>` CLI command
- [ ] Remove old banner files from PAI/Tools/ root

---

### §7.4 Decompose pai.ts [P2]

**Current:** 808-line CLI file combining MCP management, launch, profile management, upgrade routing
**Goal:** Clear module separation

```
PAI/Tools/pai/
├── index.ts      ← thin CLI entry (was: pai.ts)
├── mcp.ts        ← MCP shortcuts, loading, profile management
├── launch.ts     ← Claude launch, wallpaper, banner invocation
└── commands.ts   ← update, version, profiles, mcp-list commands
```

- [ ] Create `PAI/Tools/pai/` directory
- [ ] Extract MCP loading logic → `mcp.ts`
- [ ] Extract Claude launch + banner → `launch.ts`
- [ ] Extract subcommands (update, version, profiles) → `commands.ts`
- [ ] `index.ts` becomes thin dispatcher
- [ ] Update symlinks/aliases that point to `pai.ts`

---

### §7.5 Decompose change-detection.ts [P3]

**Current:** 612-line lib combining file watching, diff computation, code analysis
**Goal:** Focused modules

```
hooks/lib/change-detection/
├── index.ts      ← re-exports (backward compatible)
├── watcher.ts    ← file system watching utilities
├── diff.ts       ← diff computation
└── analyzer.ts   ← code change analysis (AST-level)
```

- [ ] Audit what each exported function does
- [ ] Group by concern (watch vs diff vs analyze)
- [ ] Split into 3 files
- [ ] Create backward-compatible `index.ts` that re-exports everything
- [ ] Verify no hook breaks

---

### §7.6 Extract SecurityValidator Pattern Engine [P2]

**Current:** 618-line hook with pattern definitions, loading, and decision engine all inline
**Goal:** Reusable security library

```
hooks/lib/security-patterns.ts  ← pattern definitions + loading
hooks/lib/security-decision.ts  ← decision engine (continue/ask/block)
hooks/SecurityValidator.hook.ts ← thin orchestrator (target: ~150 lines)
```

- [ ] Extract pattern definitions to `security-patterns.ts`
- [ ] Extract decision logic (scoring, thresholds, output) to `security-decision.ts`
- [ ] Reduce hook to: load payload → load patterns → call decision → output result
- [ ] Add tests for security-decision.ts (the most critical untested module)

---

### §7.7 Extract RatingCapture Logic [P3]

**Current:** 553-line hook with explicit detection, implicit detection, and sentiment all inline
**Goal:** Testable rating library

```
hooks/lib/rating-capture.ts   ← explicit + implicit + sentiment (tested)
hooks/RatingCapture.hook.ts   ← thin orchestrator (~100 lines)
```

- [ ] Move detection logic to `lib/rating-capture.ts`
- [ ] Write tests for rating detection edge cases
- [ ] Reduce hook to: load payload → call lib → write to ratings.jsonl

---

### §7.8 Extract LoadContext Loaders [P3]

**Current:** 536-line hook loading from 4+ memory sources and building output inline
**Goal:** Composable context loaders

```
hooks/lib/context-loaders/
├── wisdom.ts     ← load from MEMORY/WISDOM/
├── work.ts       ← load from MEMORY/WORK/ (active PRD)
├── state.ts      ← load from MEMORY/STATE/
└── learning.ts   ← load from MEMORY/LEARNING/
```

- [ ] Identify the 4 memory source loaders in LoadContext.hook.ts
- [ ] Extract each to a focused loader function in lib/context-loaders/
- [ ] Keep hook as compositor: load all sources → merge → inject to stdout
- [ ] Makes individual loaders testable and swappable

---

### §7.9 Build Skill Discovery System [P2]

**Current:** 47 skills in 12 categories with no programmatic index
**Goal:** `pai skills list` and queryable skill registry

- [ ] Create `PAI/Tools/SkillIndex.ts` — scans skills/ directory recursively
- [ ] Parse each skill file for: name, category, description (first 2 lines), invocation pattern
- [ ] Output as JSON to `MEMORY/STATE/skill-index.json` on SessionStart
- [ ] Add `pai skills list [--category <cat>]` command
- [ ] Add `pai skills search <query>` command
- [ ] Standardize skill file header format (first line = name, second = one-line description)

---

### §7.10 Expand Test Coverage [P2]

**Priority order for new tests:**

- [ ] `SecurityValidator.test.ts` — test pattern matching, decision thresholds, block/ask/allow paths
- [ ] `AgentExecutionGuard.test.ts` — test guard logic
- [ ] `GitHubWriteGuard.test.ts` — test write protection
- [ ] `algorithm-prd.test.ts` — test PRD frontmatter parsing (when algorithm.ts is split)
- [ ] `algorithm-loop.test.ts` — test loop state machine (pause/resume/stop)
- [ ] `RatingCapture.test.ts` — test explicit and implicit detection (after §7.7)
- [ ] `LoadContext.test.ts` — test context loader outputs (after §7.8)
- [ ] `Inference.test.ts` — test Anthropic API wrapper (mock API)
- [ ] `IntegrityMaintenance.test.ts` — test scan logic
- [ ] Integration test: full SessionStart → SessionEnd cycle

---

### §11 Immediate Fixes [P1]

- [ ] **F1: Fix CLAUDE.md version** — Line 1 says `PAI 4.3.0`, update to `4.4.1` or make version injected via `BuildCLAUDE.ts` template
- [ ] **F5: Audit BuildCLAUDE.ts duplication** — `hooks/handlers/BuildCLAUDE.ts` vs `PAI/Tools/BuildCLAUDE.ts` — are they in sync?
- [ ] **F3: Document Actions v1/v2 migration path** — Document which callers use v1 and the specific steps to migrate them to v2 before deleting v1

---

### §12 Architecture Improvements [P2-P3]

- [ ] **F2: Document TerminalState multi-event pattern** — Add comment block in TerminalState.hook.ts explaining why it handles multiple events, or split it
- [ ] **F4: Split settings.json runtime state** — Create `state.json` for runtime counts; BuildSettings.ts only generates static `settings.json`
- [ ] **F6: Implement skill discovery** — See §7.9
- [ ] **F7: Unify banner system** — See §7.3
- [ ] **F8: Decision on PAI-Install** — Move to separate repo OR add build artifacts to .gitignore
- [ ] **F9: Document unused lifecycle events** — Add section in hooks/README.md for PreCompact, WorktreeCreate/Remove, TaskCompleted, TeammateIdle
- [ ] **F10: Security hook tests** — See §7.10
- [ ] **F11: Decompose algorithm.ts** — See §7.1
- [ ] **F12: Memory archival strategy** — Add `SessionEnd` pruning for LEARNING/ and add `pai memory stats` command

---

### §13 Quality & Cleanup [P3]

- [ ] **Agents: Add canonical output format to BrowserAgent, Pentester, UIReviewer** — 3 agents still have inline output format instead of using `partials/output-format.md`
- [ ] **Skill category nesting standardization** — Audit all 12 categories; flatten or consistently nest
- [ ] **Spinner verbs curation** — 426 verbs; audit for duplicates/stale themes; target ~200 curated
- [ ] **Spinner tips curation** — 198 tips; remove stale/duplicate; target ~100
- [ ] **Pipeline monitor UI decision** — Move to separate repo or gitignore build artifacts
- [ ] **ARCHITECTURAL_REVIEW.md cleanup** — Outdated prior review; either update to reference this doc or archive
- [ ] **Stale top-level docs** — `PAI-v4.1.0-plan.md`, `PAI-v4.1.0-summary.md` → move to `docs/archive/`
- [ ] **Version centralization** — One authoritative version string; BuildSettings.ts injects everywhere
- [ ] **Add `pai memory stats` command** — Show MEMORY/ directory sizes, entry counts, oldest entries
- [ ] **Add `pai hooks list`** — Show all 23 hooks, their events, blocking status

---

## 8. Future Vision

These are architectural directions worth considering for v4.5.0+. Not tasks yet — possibilities.

### 8.1 Structured Agent Orchestration
Currently agents are standalone files with no composition framework. Future: `algorithm.ts loop` mode could auto-select agents based on task type (Architect for design, Engineer for impl, QATester for verify), creating a genuine multi-agent pipeline rather than one agent doing all phases.

### 8.2 Skill Composition Pipeline
Skills are invoked individually. Future: a "pipeline" primitive that chains skills (`research → synthesize → report`). `PipelineOrchestrator.ts` already exists but isn't wired.

### 8.3 Memory with Relevance Scoring
Currently LoadContext injects all active memory. Future: semantic relevance scoring — inject only memory relevant to the current task. Prevents context pollution as MEMORY/ grows.

### 8.4 Dashboard as First-Class Component
`PipelineMonitor.ts` + `pipeline-monitor-ui/` exist but aren't integrated into the main session experience. Future: persistent dashboard (electron or tmux pane) that shows active algorithm state, ISC progress, session stats in real-time.

### 8.5 PAI Algorithm v4.0
Current algorithm (v3.9.0) is spec-only — Claude reads it and follows it. Future: `algorithm.ts` enforces phase transitions programmatically, validates ISC format before proceeding, and prevents phase-skipping at the execution level (not just at the instruction level).

### 8.6 Version Central Registry
Single `PAI/version.ts` exports `PAI_VERSION`. BuildSettings.ts, BuildCLAUDE.ts, install.sh, manifest.json all import/read it. No more version string sprawl.

### 8.7 Typed Skill Manifests
Each skill file gets a YAML frontmatter header:
```yaml
---
skill: research/multi-agent
description: Multi-agent research synthesis
effort: Standard+
requires: [ClaudeResearcher, PerplexityResearcher]
outputs: [markdown-report]
---
```
Enables programmatic skill discovery, composition, and validation.

---

## Quick Reference — Key File Locations

| What | Where |
|------|-------|
| Mode routing (NATIVE/ALGORITHM/MINIMAL) | `Releases/v4.4.0/.claude/CLAUDE.md` |
| All hook registrations (source) | `Releases/v4.4.0/.claude/config/hooks.jsonc` |
| Generated settings (never edit) | `Releases/v4.4.0/.claude/settings.json` |
| Algorithm specification | `Releases/v4.4.0/.claude/PAI/Algorithm/v3.9.0.md` |
| DA identity config | `Releases/v4.4.0/.claude/config/identity.jsonc` |
| Hook shared libraries | `Releases/v4.4.0/.claude/hooks/lib/` |
| Skill index (all 47 skills) | `Releases/v4.4.0/.claude/skills/` |
| PRD template | `Releases/v4.4.0/.claude/hooks/lib/prd-template.ts` |
| Integrity manifest | `Releases/v4.4.0/.claude/manifest.json` |
| Test suite | `Releases/v4.4.0/.claude/tests/` |
| Prior improvement work | `IMPROVEMENT-INDEX.md` |
