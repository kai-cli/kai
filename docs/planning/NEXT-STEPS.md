# PAI — Next Steps

> Canonical repo: `kai-cli/pai-config`
> Current: v4.5.0 shipped (2026-03-26)
> In progress: v4.6.0

---

## Completed (v4.6.0 work so far)

- [x] Hook hardening — all 38 hooks through run-hook.sh wrapper, async flags on 13
- [x] Install safety — settings migration, preferences.local.jsonc for machine-specific overrides
- [x] Deployment docs — WHATS-DIFFERENT.md, README rewrite, install.sh version bump
- [x] Gitignore runtime state — learning, security, sessions, tasks, settings.json
- [x] Tracked files audit — 3,347 → 1,941 files (removed archives, duplicates, old Algorithm versions)
- [x] Board v2: session tracking (active/recent split, first column)
- [x] Deployment packager (`scripts/deploy.ts`) — 19MB tarball, personal data stripped
- [x] Personal data removed from git (PAI/USER/, skills/PAI/USER/ gitignored, 73 files)
- [x] Docs consolidated from fork into pai-config
- [x] Fork (Personal_AI_Infrastructure) archived

---

## v4.6.0 — Work Queue (Prioritized)

Work items in execution order. Start at the top, finish each before moving to the next.

### NOW: Intelligence Layer
- [ ] Research index (`MEMORY/RESEARCH/index.json`) — searchable catalog of prior research across sessions
- [ ] Agent context seeding — auto-inject relevant prior research into spawned agent prompts
- [ ] Research deduplication — detect when a topic was already researched, surface prior findings

### NEXT: Dead Skill Trim
- [ ] Audit Fabric patterns — extract the 10-15 actually used, remove the other ~300
- [ ] Remove stale skills — WorldThreatModelHarness, Aphorisms, Sales, AnnualReports, others unused
- [ ] Remove old Algorithm versions from PAI/Algorithm/ (keep only v3.9.0 + supporting files)

### THEN: Ralph Loop Budget Fix (P0)
- [ ] Sonnet fallback — use Sonnet for routine iterations, Opus only for deep work
- [ ] Algorithm overhead reduction — compress OBSERVE/THINK for Standard tier
- [ ] Context-per-task bundling — PRD `### Context Bundle` listing required files

### THEN: Algorithm Improvements (P1)
- [ ] Phase-locked tool access — read-only in OBSERVE/THINK, full write in BUILD/EXECUTE, read+test in VERIFY
- [ ] Triangulation verification — VERIFY cross-references ISC criteria, actual output, and original request
- [ ] Session handoff protocol — structured continuation state at session end/compaction

### THEN: Security & Quality Gates (P1)
- [ ] WebFetch/WebSearch PreToolUse guard — outbound request validation
- [ ] PostToolUse code quality gate — error detection after tool execution

### THEN: Team Deployment
- [ ] Coworker onboarding guide — getting-started tutorial
- [ ] Org-config patterns — shared team settings vs personal overrides
- [ ] `pai setup --team` mode (stretch)

### LATER: Board & Memory (P2)
- [ ] Board new PRD creation — create work items directly from the UI
- [ ] Architectural Decision Records — `MEMORY/DECISIONS/`
- [ ] Project state snapshots — periodic `MEMORY/SNAPSHOTS/` at version releases
- [ ] Skill collections additions — Trail of Bits, command suites, DevOps (deferred from 4.5.0)

---

## Backlog (Beyond 4.6.0)

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
