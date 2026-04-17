# PAI — Next Steps

> Canonical repo: `kai-cli/kai`
> Current: v4.9.0 in progress (PR #3 open) | v5.0.0 planned (fork)

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

## v4.7.0 — Shipped (PR #1 merged 2026-04-16)

- [x] Algorithm v3.11.0 — pipeline hop verification, pre-flight target file reading enforcement
- [x] KnowledgeSync.hook.ts — incremental SessionEnd re-distillation, 7-day full harvest auto-trigger
- [x] Context routing — DU certification memory, Research-Agent memory, Du_tracking path

---

## v4.8.0 — In Progress (PR #2 open)

### Memory Curation Infrastructure
- [x] Token optimization — CLAUDE.md dedup, conditional TELOS, compressed steering rules (~2,100 tokens/session)
- [x] `inference-budget.ts` — shared SessionEnd LLM cap (max 3 calls/session)
- [x] `staging.ts` — MEMORY/STAGING/ with 14-day draft expiry
- [x] `pai curate` CLI — full interactive weekly review (staleness, domains, drafts, insights, stats)
- [x] Archive/restore — stale files → .archive/ with `pai curate restore`
- [x] Read telemetry — LoadContext logs injected domains to memory-reads.jsonl
- [x] Hard token budget cap — 16k char limit with priority-based truncation (`applyTokenBudget`)

### Self-Learning Loop
- [x] `ReflectionHarvester.ts` (`pai harvest`) — Jaccard dedup → Haiku synthesis → STAGING
- [x] Rating-triggered drafts — 8-10 → success pattern; 4-5 → correction (RatingCapture)
- [x] Nudge system — session start reminder when STAGING has unreviewed drafts >14 days
- [x] Auto-harvest trigger — KnowledgeSync fires ReflectionHarvester when ≥10 new reflections

### Security P1
- [x] WebFetch/WebSearch PreToolUse guard — blocks internal network ranges, logs outbound
- [x] PostToolUse secret detection — scans Bash/WebFetch output for 9 credential patterns

### Tests: 169 → 248 passing

---

## v4.9.0 — In Progress (PR #3 open)

### Algorithm v3.12.0
- [x] Parallelization gate (QG8) — mandatory `📐 PARALLEL PLAN` when 3+ independent ops
- [x] Capability prune — PLAN phase KEEP/DROP review prevents phantom selections reaching VERIFY
- [x] Version centralization — CLAUDE.md reads PAI/Algorithm/LATEST; future bumps need 3 files only

### Infrastructure
- [x] Hook timeout hardening — `run-hook.sh` enforces per-hook timeouts (KnowledgeSync 180s, others 30s)
- [x] Memory TTL/archival — SessionCleanup caps ratings.jsonl (500), reflections (200), archives LEARNING/RELATIONSHIP
- [x] LearningPatternSynthesis auto-trigger — KnowledgeSync fires when ≥20 new ratings

### Security
- [x] Remove personal AWS credentials from config/preferences.jsonc and bedrock-known-good.jsonc
- [x] SecretScanner + git pre-commit: add AWS account ID and profile name patterns
- [x] BuildSettings parseJSONC: add trailing comma stripping (standard JSONC)

### Quality & Testing
- [x] RatingCapture tests (28) — parseExplicitRating regex, detectCorrections patterns
- [x] CriticalPath integration tests (14) — RatingCapture → STAGING → LoadContext → pai curate
- [x] SecurityValidator tests (17) — hard blocks, zero-access paths, confirm ops, fail-open
- [x] TokenBudget tests (12) — priority truncation, drop order, edge cases
- [x] rating-parser.ts extraction — zero-dependency module
- [x] SKILL.md — Memory Management CLI section (pai curate/harvest commands)
- [x] RebuildPAI.ts — fix broken Components and Algorithm path references

### Tests: 248 → ~240 (your refactor) + new tests

---

## v5.0.0 — Planned (fork: public release)

### Goals
- Public GitHub repo, MIT/Apache license, installable by any developer
- `curl | bash` installer → `git clone ~/pai` → `ln -s ~/pai ~/.claude`
- Zero personal/company content in tracked files
- Generic config layer replacing all Your Company-specific hardcoding

### Council Synthesis (2026-04-17)
- [x] Repo structure & install architecture designed (Agent 1)
- [x] Config layer design completed — `config/domains.jsonc` spec (Agent 2)
- [x] Full codebase audit — 20 RED items, 6 YELLOW, 13 GREEN, 4 dead code (Agent 3)

### Work Required
- [ ] Strip 20 RED audit items (personal refs, dead banner files, Plans/archive)
- [ ] Extract domains to `config/domains.jsonc` + `config-loader.ts` + refactor 3 hooks
- [ ] Build `pai setup` wizard (Agent 2 spec complete)
- [ ] Add LICENSE, CONTRIBUTING.md, CHANGELOG.md
- [ ] Update installer for curl|bash + symlink pattern
- [ ] Decide: fork repo name and GitHub org

---

## Deferred / Won't Do (this version)

- Confidence calibration — needs weeks of approval/rejection data first
- Batch approve (`pai curate approve-all`) — depends on confidence calibration
- Hook timeout per-hook config in settings.json — env var override sufficient for now
- Team features, local model support, remote access, external notifications — v6+ territory
- NPI Dashboard, Release Notes Generator, Team Health Tracker — needs product design
