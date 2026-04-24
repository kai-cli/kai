# PAI v4.4.1 Audit — Status & Next Steps

> Branch: `v4.4.1-dev` | Last updated: 2026-03-12
> Companion docs: `IMPROVEMENT-INDEX.md`, `NEXT-STEPS.md` (repo root)

---

## Completed (This Audit)

### P0 Bug Fixes
- [x] **StopOrchestrator.hook.ts** — Fixed 3 broken imports (phantom `RebuildSkill`, `AlgorithmEnrichment`, wrong `TranscriptParser` path)
- [x] **UpdateTabTitle.hook.ts** — Fixed 2 broken imports (wrong `Inference` path, phantom `PromptAnalysis.hook`)
- [x] **AlgorithmTracker.hook.ts** — Created missing `lib/algorithm-state.ts` shared module
- [x] **IntegrityMaintenance.ts** — Fixed stale `_SYSTEM` path, added existence guard
- [x] **PAI-Install/engine/config-gen.ts** — Fixed stale `skills/PAI/` installer paths
- [x] **payload-schema.ts** — Fixed `prompt` -> `user_prompt` field name mismatch (broke ModeClassifier, FormatReminder, TerminalState)

### Hook Registration (hooks.jsonc)
- [x] Registered 14 new hooks (`5dcd1da`) — total now 34 registrations across 10 lifecycle events
- [x] **GitHubWriteGuard** on PreToolUse/Bash
- [x] **ConfigChange** on ConfigChange event
- [x] **SetQuestionTab** on PreToolUse/AskUserQuestion
- [x] **PromptAnalysis** on UserPromptSubmit
- [x] **FormatReminder** on UserPromptSubmit
- [x] **SessionSummary** on SessionEnd
- [x] **CheckVersion** on SessionStart
- [x] **StartupGreeting** on SessionStart
- [x] **PreCompact** on PreCompact
- [x] **WorktreeSetup** on WorktreeCreate
- [x] **WorktreeRemove** on WorktreeRemove
- [x] **TaskCompleted** on TaskCompleted
- [x] **TeammateIdle** on TeammateIdle
- [x] **AlgorithmTracker** + **StopOrchestrator** + **DocIntegrity** on Stop

### Sync & Version Fixes
- [x] Synced 27 hook files from local `~/.claude/` to repo (`9eb3829`)
- [x] CLAUDE.md version corrected (4.3.0 -> 4.4.0)
- [x] CLAUDE.md.template updated (effort tier table, Micro/Standard+ routing, `{{ALGO_PATH}}`)
- [x] config/preferences.jsonc version corrected (4.3.1 -> 4.4.0)

### Documentation
- [x] THEHOOKSYSTEM-Reference.md — Complete rewrite (1255 stale -> 256 accurate lines)
- [x] Architecture docs moved to `Releases/Architectural Planning and Understanding/`
- [x] ARCHITECTURAL-UNDERSTANDING.md consolidated into canonical docs

---

## Next Steps

### P0 — Stop Event Deduplication (Bug)

**Problem:** DocCrossRefIntegrity now runs TWICE per Stop event:
1. `DocIntegrity.hook.ts` calls it directly
2. `StopOrchestrator.hook.ts` calls it via its handler array

Both are registered in hooks.jsonc Stop event. This creates race conditions on shared state files.

**Fix:** Remove `DocIntegrity.hook.ts` from hooks.jsonc Stop registration. StopOrchestrator owns it now. Then delete the orphaned `DocIntegrity.hook.ts` file.

### P1 — Statusline Context Feature

**Problem:** Multiple PAI tabs are indistinguishable. Tab titles show current action but not which project/domain.

**Approach TBD:**
- [ ] Investigate `statusline-command.sh` and Claude Code statusline API
- [ ] Detect `cwd` or project name from session
- [ ] Prepend domain to tab title: `release-notes | Fixing auth bug.`

### P2 — Non-Hook Local Drift Audit

**Problem:** Hooks are synced, but `~/.claude/` may have diverged from repo in other areas.

**Areas to diff:**
- [ ] Skills (48 locally vs 47 in repo)
- [ ] PAI Tools (Inference, TranscriptParser, BuildCLAUDE, etc.)
- [ ] Agent definitions (`custom-agents/`, `Agents/`)
- [ ] Algorithm versions
- [ ] Config files beyond hooks.jsonc

### P3 — Local Registration Gap

**Problem:** Repo hooks.jsonc has 34 registrations. Local `~/.claude/settings.json` was built from an older hooks.jsonc. Until `BuildSettings.ts` regenerates from the updated hooks.jsonc, these hooks won't fire locally:
- [ ] AutoWorkCreation.hook.ts (not registered anywhere — even in repo hooks.jsonc)
- [ ] New registrations from `5dcd1da` that haven't been installed locally

**Fix:** Run `bun ~/.claude/hooks/handlers/BuildSettings.ts` to regenerate local settings.json from the updated config.

### P4 — Documentation Consolidation

- [ ] Update IMPROVEMENT-INDEX.md — mark P0 items 0.1-0.5 as FIXED
- [ ] Update THEHOOKSYSTEM-Reference.md — now stale again (was written with 23 hooks, now 34 registrations across 10 events)
- [ ] Merge or cross-reference AUDIT-STATUS.md, NEXT-STEPS.md, and IMPROVEMENT-INDEX.md (3 overlapping tracking docs)

### P5 — Architecture Improvements (Backlog)

- [ ] **Hook deduplication** — TerminalState registered on 3+ events; evaluate if intentional
- [ ] **Hook timeout guards** — No protection against hung hooks blocking the session
- [ ] **Test coverage** — 7 test files for 35 hooks + 47 skills + 14 agents
- [ ] **Banner tool consolidation** — 7 files, 167KB (consider theme enum)
- [ ] **Spinner curation** — 426 verbs + 198 tips loaded every session
- [ ] **Memory TTL/archival** — WISDOM, LEARNING, RELATIONSHIP grow unbounded
- [ ] **ACTIONS runner v1->v2 migration** — Both actively imported, needs code migration
- [ ] **Skill category nesting** — Inconsistent depth across categories
- [ ] **Split settings.json runtime state** — Separate static config from dynamic counters

---

## Reference

| Commit | Description |
|--------|-------------|
| `9eb3829` | fix: sync 27 hooks — payload-schema bug fix, voice cleanup, new hooks |
| `5dcd1da` | chore: register 14 new hooks in hooks.jsonc config |
| `50f1a18` | docs: rewrite THEHOOKSYSTEM-Reference.md |
| `3d9d838` | docs: add AUDIT-STATUS.md |
| `baedeac` | docs: consolidate ARCHITECTURAL-UNDERSTANDING into canonical docs |

---

## Current Hook Registry (10 events, 34 registrations)

| Event | Hooks |
|-------|-------|
| **PreToolUse** | SecurityValidator (x4: Bash/Edit/Write/Read), GitHubWriteGuard (Bash), TerminalState (AskUserQuestion), SetQuestionTab (AskUserQuestion), AgentExecutionGuard (Task), SkillGuard (Skill) |
| **PostToolUse** | QuestionAnswered (AskUserQuestion), PRDSync (x2: Write/Edit) |
| **UserPromptSubmit** | PromptAnalysis, ModeClassifier, FormatReminder, RatingCapture, TerminalState, UpdateTabTitle, SessionAutoName |
| **SessionStart** | TerminalState, LoadContext, CheckVersion, StartupGreeting, BuildCLAUDE, BuildSettings |
| **SessionStart/compact** | PostCompactRecovery |
| **Stop** | LastResponseCache, TerminalState, DocIntegrity*, StopOrchestrator, AlgorithmTracker |
| **SessionEnd** | WorkCompletionLearning, SessionCleanup, SessionSummary, RelationshipMemory, UpdateCounts, IntegrityCheck |
| **PreCompact** | PreCompact |
| **ConfigChange** | ConfigChange |
| **WorktreeCreate** | WorktreeSetup |
| **WorktreeRemove** | WorktreeRemove |
| **TaskCompleted** | TaskCompleted |
| **TeammateIdle** | TeammateIdle |

*DocIntegrity marked for removal (P0 dedup fix)
