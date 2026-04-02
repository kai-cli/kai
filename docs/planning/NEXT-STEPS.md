# PAI — Next Steps

> Canonical repo: `kai-cli/pai-config`
> Current: v4.6.0 shipping (2026-04-02)

---

## v4.6.0 — Shipped

- [x] Hook hardening — all 38 hooks through run-hook.sh wrapper, async flags on 13
- [x] Install safety — settings migration, preferences.local.jsonc for machine-specific overrides
- [x] Deployment docs — WHATS-DIFFERENT.md, README rewrite, install.sh version bump
- [x] Gitignore runtime state — learning, security, sessions, tasks, settings.json
- [x] Tracked files audit — 3,347 → 1,587 files
- [x] Board v2: session tracking (active/recent split, first column)
- [x] Deployment packager (`scripts/deploy.ts`) — 19MB tarball, personal data stripped
- [x] Personal data removed from git (PAI/USER/, skills/PAI/USER/ gitignored)
- [x] Docs consolidated from fork into pai-config, fork archived
- [x] Intelligence Layer — ResearchIndex.ts with query, dedup, save, context seeding
- [x] Dead Skill Trim — removed 354 files (Fabric patterns, stale skills, old Algorithm versions)
- [x] Algorithm v3.9.1 — pre-flight validation, parallelization check, capability audit
- [x] Ralph Loop Budget Fix — model tiering, weighted budget, lightweight prompts, context bundles
- [x] Coworker onboarding guide — getting-started tutorial for team deployment
- [x] Installation cleanup — coworker-ready install flow

---

## v4.7.0 — Next Release

### Algorithm Improvements (P1) — DONE (v3.10.0)
- [x] Phase-locked tool access — read-only in OBSERVE/THINK, full write in BUILD/EXECUTE, read+test in VERIFY
- [x] Triangulation verification — VERIFY cross-references ISC criteria, actual output, and original request
- [x] Session handoff protocol — structured continuation state at session end/compaction (LEARN + PreCompact + SessionEnd)

### Security & Quality Gates (P1)
- [ ] WebFetch/WebSearch PreToolUse guard — outbound request validation
- [ ] PostToolUse code quality gate — error detection after tool execution

### Team Features
- [ ] Org-config patterns — shared team settings vs personal overrides
- [ ] `pai setup --team` mode (stretch)

### Board & Memory (P2)
- [ ] Board new PRD creation — create work items directly from the UI
- [ ] Architectural Decision Records — `MEMORY/DECISIONS/`
- [ ] Project state snapshots — periodic `MEMORY/SNAPSHOTS/` at version releases
- [ ] Skill collections additions — Trail of Bits, command suites, DevOps

---

## Backlog (Beyond 4.7.0)

### Infrastructure
- [ ] Memory TTL/archival — WISDOM/, LEARNING/, RELATIONSHIP/ grow unbounded
- [ ] Hook timeout guards — no protection against hung hooks
- [ ] Split settings.json: static config vs runtime state
- [ ] Test coverage expansion — 7 test files covering 38 hooks + 51 skills + 18 agents

### Product Direction
- [ ] Local model support — Ollama/llama.cpp for privacy and cost control
- [ ] Remote access — PAI from mobile/web/other machines
- [ ] External notifications — Discord/Slack/email for long-running task completion
- [ ] Model routing — route tasks to different models by complexity

### Deferred EM/PLM Work (Tier 5)
- [ ] NPI Dashboard — needs product thinking: gates, milestones, risk roll-ups
- [ ] Release Notes Generator — needs audience definition, format, source mapping
- [ ] Team Health Tracker — needs privacy design, review cycle integration
