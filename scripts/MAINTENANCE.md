# Maintenance Scripts & Schedules

> Scripts that keep the system healthy. Run manually or prompted at session start.
> This file is the single source of truth for "what should I be running periodically."

---

## Weekly (or every few sessions)

| Script | Purpose | Command | Notes |
|--------|---------|---------|-------|
| tools-sync.ts | Check for new tools/services in project CLAUDE.md files | `bun scripts/tools-sync.ts` | Run `--apply` to update TOOLS.md |
| MemoryCurate | Review STAGING memory drafts, promote/discard | `bun PAI/Tools/MemoryCurate.ts` | KnowledgeSync fills STAGING; this empties it |
| LearningPatternSynthesis | Synthesize rating patterns into lessons | `bun PAI/Tools/LearningPatternSynthesis.ts` | Auto-fires via 14-day backstop, but manual is faster |

## Monthly / As-Needed

| Script | Purpose | Command | Notes |
|--------|---------|---------|-------|
| install-hooks.sh | Reinstall git pre-commit/pre-push hooks | `bash scripts/install-hooks.sh` | After git worktree issues |
| KnowledgeHarvester | Full knowledge domain refresh | `bun PAI/Tools/KnowledgeHarvester.ts` | Auto-fires every 7 days via KnowledgeSync hook |
| RoutingAudit | Verify skill routing accuracy | `bun PAI/Tools/RoutingAudit.ts` | After adding/removing skills |
| upgrade.ts | Check for system improvements | `bun PAI/Tools/upgrade.ts` | After Claude Code updates |
| SecretScan | Scan repo for leaked secrets | `bun PAI/Tools/SecretScan.ts` | Before sharing code publicly |

## Build Chain (run in order after config changes)

```bash
bun PAI/Tools/BuildManifest.ts       # Regenerate manifest.json (counts, skills)
bun PAI/Tools/BuildDocs.ts           # Update doc markers from manifest
bun hooks/handlers/BuildSettings.ts  # Rebuild settings.json from config/*.jsonc
bash scripts/verify-release.sh       # Full system validation
```

## Automated (no manual intervention needed)

These fire automatically via hooks — listed for awareness, not action:

| Hook/Tool | Trigger | Cadence |
|-----------|---------|---------|
| KnowledgeSync | SessionEnd | Every session + 7-day full harvest |
| SessionCleanup retention | SessionEnd | Daily-gated (once/24h) |
| LearningPatternSynthesis backstop | SessionEnd | 14-day-gated |
| RatingCapture | UserPromptSubmit | Every prompt |
| RelationshipMemory | SessionEnd | Every session |
| WorkCompletionLearning | SessionEnd | Every session |
| IntegrityCheck | SessionEnd | Every session |

## Quick Health Check

```bash
bun test                                # All tests pass
bash scripts/verify-release.sh --quick  # Fast validation
bun scripts/tools-sync.ts              # Scan for new project tools
```

---

## Release Scripts (maintainer only)

These are used when publishing a new version. Not relevant for end users.

| Script | Purpose | Command |
|--------|---------|---------|
| verify-release.sh | Full system validation (counts, markers, tests) | `bash scripts/verify-release.sh` |
| deploy.ts | Version bump, manifest rebuild | `bun scripts/deploy.ts` |
| sync-to-kai.sh | PII scrub + brand transform → public repo | `bash scripts/sync-to-kai.sh` |
