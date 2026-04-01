# PAI v4.4.0 — Improvement Index

> Master index of all cleanup, streamlining, and architectural improvements identified during the full system review. Created 2026-03-11.
>
> **Scope:** `Releases/v4.4.0/.claude/` — 1,156 files, 47 skills, 23 hooks, 14 agents.
> **Companion doc:** `SYSTEM-ATLAS.md` (structural map of the full system)

---

# PRIORITY 0 — RUNTIME BUGS (Pre-existing in v4.4.0)

Discovered during architecture review 2026-03-11. These bugs existed before our cleanup work.
See `HOOK-SYSTEM-AUDIT.md` for full evidence and `ARCHITECTURE-REVIEW-v4.4.1.md` for context.

## 0.1 StopOrchestrator Phantom Imports — ✅ FIXED

`hooks/StopOrchestrator.hook.ts` imported two handler files that didn't exist (`AlgorithmEnrichment`, `RebuildSkill`). Removed phantom imports, reduced handler array to TabState + DocCrossRefIntegrity. Orchestrator now compiles and runs cleanly.

## 0.2 StopOrchestrator Wrong TranscriptParser Path — ✅ FIXED

Fixed `../skills/PAI/Tools/TranscriptParser` to `../PAI/Tools/TranscriptParser`.

## 0.3 DocCrossRefIntegrity Double Registration — ✅ FIXED

DocIntegrity.hook.ts deleted. StopOrchestrator now owns DocCrossRefIntegrity as sole caller. No more duplicate execution on Stop.

## 0.4 IntegrityMaintenance Missing Tool Reference — ✅ FIXED

Fixed stale `skills/_SYSTEM/Tools/CreateUpdate.ts` path. Added existence guard to skip gracefully if file not found.

## 0.5 Voice Remnants in DocCrossRefIntegrity — ✅ FIXED

`hooks/handlers/DocCrossRefIntegrity.ts` lines 870-885 contain a 3-second delay + voice notification code. Voice system was removed in v4.3.2-dev cleanup.

**Fix:** Remove the voice notification block and unnecessary delay.

---

# PRIORITY 1 — CRITICAL (Broken / Runtime Errors)

These issues will cause failures at runtime.

## 1.1 Phantom Hook References in settings.json — ✅ FIXED

**10 hooks were registered in settings.json but had NO corresponding .ts file.** Removed all phantom entries.

Missing hooks:
- `VoiceGate.hook.ts` — voice cleanup leftover, still in PreToolUse/Bash matcher (settings.json:170)
- `PromptAnalysis.hook.ts` — referenced in UserPromptSubmit (settings.json:297)
- `SetQuestionTab.hook.ts` — referenced in PreToolUse/AskUserQuestion (settings.json:209)
- `CheckVersion.hook.ts` — referenced in SessionStart (settings.json:331)
- `StartupGreeting.hook.ts` — referenced in SessionStart (settings.json:335)
- `WorktreeSetup.hook.ts` — referenced in WorktreeCreate (settings.json:380)
- `WorktreeRemove.hook.ts` — referenced in WorktreeRemove (settings.json:390)
- `TaskCompleted.hook.ts` — referenced in TaskCompleted (settings.json:400)
- `TeammateIdle.hook.ts` — referenced in TeammateIdle (settings.json:410)
- `PreCompact.hook.ts` — referenced in PreCompact (settings.json:360)

**Fix:** Remove phantom entries from settings.json AND from config/hooks.jsonc (since BuildSettings.ts generates settings.json from config/). Alternatively, create stub implementations for hooks that should exist.

## 1.2 config/hooks.jsonc Out of Sync with settings.json — ✅ FIXED

BuildSettings.ts does a full rebuild (not merge). hooks.jsonc was missing 5 real hooks (GitHubWriteGuard, UpdateTabTitle, AlgorithmTracker, StopOrchestrator, ConfigChange). Added them. Both files now reference exactly 23 hooks matching the 23 .ts files.

## 1.3 MEMORY/README.md Still References VOICE/ — ✅ FIXED

Removed VOICE/ line, replaced with WISDOM/ directory listing.

---

# PRIORITY 2 — HIGH (Stale Data / Misleading Docs)

These won't crash but will confuse both the AI and users.

## 2.1 Version String Sprawl — ✅ FIXED

Updated all stale version strings to 4.4.0:
- `config/preferences.jsonc:pai.version` → 4.4.0
- `install.sh` banner → v4.4.0 / Algo v3.9.1
- `config/spinner-tips.json` → v4.4.0

Future: centralize to ONE source with dynamic injection.

## 2.2 DOCUMENTATIONINDEX.md References 5 Missing Files — ✅ FIXED

Removed all 5 missing doc references from DOCUMENTATIONINDEX.md. Also removed voice ref from agents description.

## 2.3 hooks/README.md Documents Non-Existent Hooks — ✅ FIXED

Rewrote architecture diagram, hook registry, lifecycle events, configuration section, and tab state flow. Removed 4 phantom hooks, added all missing real hooks. README now matches the actual 23 .ts files + 2 handlers.

## 2.4 Incorrect Counts in Documentation — ✅ FIXED

PAI/README.md updated to 11 categories, 47 skills, 23 hooks. spinner-tips.json hook count updated (21→23).

Remaining: settings.json `counts` section still has all zeros (populated at runtime by UpdateCounts.hook.ts).

## 2.5 config/README.md References Voice Section — ✅ FIXED

Removed `voices`, `voice clone`, and `voice` references from config/README.md.

---

# PRIORITY 3 — MEDIUM (Bloat / Streamlining)

These increase repo size, context consumption, and maintenance burden.

## 3.1 Releases Directory: 336MB of Historical Releases — ✅ FIXED

Removed 11 old release directories (v2.3 through v4.3.1), saving ~314MB. Only v4.4.0 remains. All history preserved in git.

## 3.2 Spinner Verb Bloat: 430+ Lines — 📦 NEEDS CURATION

`config/spinner-verbs.json` contains 426 custom spinner verbs grouped by theme (Kingkiller, gaming, cyberpunk, Dune, Star Trek, Foundation, etc.). These are highly personalized and loaded every session via BuildSettings.ts.

**Options:** (a) Keep as-is — it's config, not code. (b) Trim to ~100 curated favorites. (c) Move to lazy-loaded file. Already separated into `config/spinner-verbs.json`, so bloat is contained.

## 3.3 Spinner Tips: 200+ Lines — 📦 NEEDS CURATION

`config/spinner-tips.json` contains 198 tips. Version/count references already fixed in P2. Remaining issue is bulk — all tips load every session.

**Options:** (a) Keep as-is. (b) Trim duplicates/stale tips. (c) Rotate a random subset per session.

## 3.4 Algorithm Version Accumulation — ✅ FIXED

Removed v3.5.0.md, v3.7.0.md, v3.8.0.md (~64KB). Only v3.9.1.md + LATEST pointer + supporting docs remain.

## 3.5 Banner Tool Proliferation — 📦 NEEDS DESIGN

7 banner tools totaling ~167KB: Banner.ts (39KB), BannerMatrix.ts (22KB), BannerNeofetch.ts (26KB), BannerPrototypes.ts (11KB), BannerRetro.ts (28KB), BannerTokyo.ts (12KB), NeofetchBanner.ts (29KB).

**Options:** (a) Consolidate to Banner.ts with theme enum. (b) Move variants to `PAI/Tools/banners/` subdir. (c) Keep as-is — they're tools, not loaded automatically.

## 3.6 Duplicate Action Runner/Types Files — ⏳ DEFERRED

Both versions are actively imported: v1 by `pai.ts` (CLI entry), v2 by action files and `pipeline-runner.ts`. Requires code migration, not simple deletion. Moved to P4 backlog.

## 3.7 Loose Transcription Artifacts in PAI/Tools/ — ✅ FIXED

Removed `Transcribe-bun.lock` and `Transcribe-package.json`. Not imported by any code.

## 3.8 Pipeline Monitor UI Shipped in Repo — 📦 NEEDS DECISION

`PAI/Tools/pipeline-monitor-ui/` is a full React+Vite app (~15 files incl. bun.lock, eslint, tsconfig). It's a development tool, not a runtime dependency.

**Options:** (a) Move to separate repo. (b) Add `pipeline-monitor-ui/` to .gitignore. (c) Keep — it's small relative to now-deleted releases.

## 3.9 manifest.json is 204KB — ⏳ KEPT

Needed by the upgrade/integrity system at install time. Removing would require users to run `GenerateManifest.ts` post-clone. Kept in git as-is.

---

# PRIORITY 4 — LOW (Architecture / Design Improvements)

Longer-term improvements for maintainability and consistency.

## 4.1 Hook Architecture: TerminalState Handles Too Many Events

`TerminalState.hook.ts` is registered for SessionStart, UserPromptSubmit (via PromptAnalysis reference), PreToolUse/AskUserQuestion, AND Stop. It's doing multiple jobs across the lifecycle.

**Fix:** Consider splitting TerminalState into event-specific handlers or documenting why the single-hook-many-events pattern is intentional.

## 4.2 Test Coverage Gap

Only 7 test files for 23 hooks + 47 skills + 14 agents + ~40 tools:
- AtomicWrite.test.ts
- BuildSettings.test.ts
- Integration.test.ts
- ModeClassifier.test.ts
- PayloadSchema.test.ts
- PostCompactRecovery.test.ts
- Upgrade.test.ts

No tests for: SecurityValidator, LoadContext, RatingCapture, SessionAutoName, RelationshipMemory, any skills, any agents, any PAI Tools.

**Fix:** Prioritize tests for security-critical hooks (SecurityValidator, AgentExecutionGuard) and the most-used Tools (algorithm.ts, Inference.ts, BuildCLAUDE.ts).

## 4.3 Agent Template Consistency — ✅ FIXED

Extracted shared output format block to `agents/partials/output-format.md`. Replaced inline copies in 11 agents with canonical reference. 3 agents (BrowserAgent, Pentester, UIReviewer) don't use this format.

## 4.4 Skills Category Inconsistency

Some categories are deeply nested (Security has Recon/Tools/, PromptInjection/Workflows/) while others are flat (USMetrics, ContentAnalysis). The Agents skill category doubles as both a skill AND the agent system docs.

**Fix:** Standardize nesting depth. Consider separating agent system docs from the Agents skill.

## 4.5 lib/migration/ Purpose Unclear — ✅ FIXED

Added `lib/migration/README.md` documenting: 4-module pipeline (scanner → extractor → merger → validator), usage by install.sh/upgrade.ts, and active status.

## 4.6 USER/ Directory in Public Release — ✅ AUDITED

Scanned all USER/ template files for personal data (names, emails, phone, API keys, SSN patterns). Clean — no personal data found. All content is template-only.

## 4.7 Settings.json Has Both Static and Dynamic Sections — ✅ DOCUMENTED

Updated `config/README.md` to accurately document the full-rebuild behavior: BuildSettings.ts does a complete spread-merge replacement, counts initialized to zeros (populated by UpdateCounts.hook.ts at runtime), manual edits overwritten on SessionStart.

Future consideration: split runtime state into separate `state.json`.

## 4.8 extract-transcript.py is the Only Python File — ✅ DOCUMENTED

Added inline justification: `faster-whisper` is a Python-only library (CTranslate2 bindings for Whisper). No equivalent Bun/Node binding with comparable performance exists. Kept as Python with PEP 723 uv script.

## 4.9 CLAUDE.md Version String is Wrong — ✅ FIXED

Synced CLAUDE.md.template with actual CLAUDE.md content (effort tier pre-classification, Micro mode, simplified MINIMAL). Rebuilt CLAUDE.md (now shows 4.4.0). Added PAI version drift detection to needsRebuild() so future version bumps trigger automatic rebuild.

## 4.10 BuildCLAUDE.ts Exists in Two Places — ✅ NOT AN ISSUE

`hooks/handlers/BuildCLAUDE.ts` is a 22-line thin wrapper that imports `needsRebuild()` and `build()` from `PAI/Tools/BuildCLAUDE.ts`. This is the correct handler extraction pattern (same as DocIntegrity → DocCrossRefIntegrity). No duplication.

## 4.11 No Memory TTL or Archival Strategy

`MEMORY/WISDOM/`, `MEMORY/LEARNING/`, and `MEMORY/RELATIONSHIP/` grow unbounded. No archival, pruning, or TTL system exists. Over time, `LoadContext.hook.ts` will inject increasingly large context, eventually hitting context window limits.

**Fix:** Add archival strategy. On SessionEnd: if LEARNING file exceeds N entries, move old ones to `LEARNING/archive/`. Add `pai memory stats` command to show directory sizes and entry counts.

---

# PRIORITY 5 — REPO-LEVEL (Outside .claude/)

Improvements to the repo structure itself.

## 5.1 Top-Level Docs Are Stale

- `ARCHITECTURAL_REVIEW.md` (20KB) — from a prior review, needs updating
- `PAI-v4.1.0-plan.md` and `PAI-v4.1.0-summary.md` — specific to v4.1.0, historical
- `PLATFORM.md` and `SECURITY.md` — need freshness check

**Fix:** Update or archive stale docs. ARCHITECTURAL_REVIEW.md should reference this index.

## 5.2 .github/ Directory

Needs review for CI/CD relevance, especially if workflows reference features that no longer exist.

## 5.3 Tools/ at Repo Root

Contains `BackupRestore.ts`, `validate-protected.ts`, `README.md`, and a PNG. These are repo-level utilities separate from PAI Tools.

**Fix:** Clarify distinction from PAI/Tools/. Consider merging or renaming.

---

# SUMMARY — Action Priority Matrix

**Urgent (P0 — runtime bugs):**
- [x] Fix StopOrchestrator phantom imports (AlgorithmEnrichment, RebuildSkill)
- [x] Fix StopOrchestrator TranscriptParser path
- [x] Resolve DocCrossRefIntegrity double registration (DocIntegrity.hook.ts deleted, StopOrchestrator owns it)
- [x] Fix IntegrityMaintenance missing tool reference
- [x] Remove voice remnants from DocCrossRefIntegrity

**Immediate (P1 — fix now):**
- [x] Remove 10 phantom hook registrations from settings.json
- [x] Reconcile config/hooks.jsonc with actual hook files
- [x] Remove VOICE/ from MEMORY/README.md

**Next session (P2 — fix soon):**
- [x] Update all version strings to 4.4.0
- [x] Remove 5 missing doc references from DOCUMENTATIONINDEX.md
- [x] Rewrite hooks/README.md to match reality
- [x] Fix documentation counts
- [x] Remove voice ref from config/README.md

**Planned work (P3 — reduce bloat):**
- [x] Delete old releases (saved ~314MB)
- [x] Archive old Algorithm versions (removed v3.5.0, v3.7.0, v3.8.0)
- [ ] Consolidate Banner tools (167KB across 7 files — needs design)
- [x] Clean up Transcribe artifacts
- [ ] Trim spinner verbs (426 lines) and tips (198 lines) — personalized, needs curation
- [ ] Pipeline monitor UI — consider separate repo or .gitignore

**Backlog (P4/P5 — design improvements):**
- [x] Extract shared agent output format (11 agents → partial)
- [x] Add lib/migration/ README
- [x] Document BuildSettings.ts merge strategy
- [x] Audit USER/ templates (clean)
- [x] Document extract-transcript.py Python justification
- [ ] Migrate ACTIONS runner v1→v2 (both actively imported)
- [ ] Expand test coverage
- [ ] Standardize skill category nesting
- [ ] Split settings.json runtime state to separate file
