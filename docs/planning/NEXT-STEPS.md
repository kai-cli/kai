# PAI — Next Steps

> Canonical repo: `kai-cli/pai-config`
> Current: v4.8.0 in progress (PR #2 open)

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

- [x] Algorithm v3.11.0 — pipeline hop verification, pre-flight enforcement
- [x] KnowledgeSync.hook.ts — incremental SessionEnd re-distillation, 7-day full harvest
- [x] Context routing — DU certification memory, Research-Agent memory, Du_tracking path

---

## v4.8.0 — In Progress (PR #2 open)

### Memory Curation Infrastructure
- [x] Token optimization — CLAUDE.md dedup, conditional TELOS, compressed steering rules (-2,100 tokens/session)
- [x] `inference-budget.ts` — shared SessionEnd LLM cap (max 3 calls/session)
- [x] `staging.ts` — MEMORY/STAGING/ with 14-day draft expiry
- [x] `pai curate` CLI — full interactive weekly review (staleness, domains, drafts, insights, stats)
- [x] Archive/restore — stale files → .archive/ with `pai curate restore`
- [x] Read telemetry — LoadContext logs injected domains to memory-reads.jsonl
- [x] Hard token budget cap — 16k char limit with priority-based truncation

### Self-Learning Loop
- [x] `ReflectionHarvester.ts` (`pai harvest`) — 62 reflections → Jaccard dedup → Haiku synthesis → STAGING
- [x] Rating-triggered drafts — rating 8-10 → success pattern; rating 4-5 → correction (RatingCapture)
- [x] Nudge system — session start reminder when STAGING has unreviewed drafts >14 days
- [x] Auto-harvest trigger — KnowledgeSync fires ReflectionHarvester when ≥10 new reflections

### Security P1 (carried from v4.7.0)
- [x] WebFetch/WebSearch PreToolUse guard — blocks internal network ranges, logs outbound
- [x] PostToolUse secret detection — scans Bash/WebFetch output for 9 credential patterns

### Tests
- [x] 248 tests passing (198 → 248, +50 new across InferenceBudget, Staging, WebFetchGuard, SecretDetector, ReflectionHarvester)

---

## v4.9.0 — Backlog

### Algorithm Improvements
- [ ] Parallelization forcing function — mandatory gate in PLAN when 3+ independent ops
- [ ] Phantom capability elimination — prune unused capabilities in PLAN before EXECUTE
- [ ] Version string centralization — single VERSION source, no more 20-file bumps

### Memory System
- [ ] Learning Pattern Synthesis automation — auto-trigger when >20 new ratings
- [ ] Confidence calibration — track approval rate, adjust draft thresholds over time
- [ ] Batch approve — `pai curate approve-all --confidence 0.8`

### Infrastructure
- [ ] Hook timeout hardening — per-hook timeout overrides in settings.json
- [ ] Test coverage expansion — SecurityValidator, RatingCapture, KnowledgeSync, LoadContext
- [ ] Memory TTL/archival — WISDOM/, LEARNING/, RELATIONSHIP/ grow unbounded

### Product Direction
- [ ] Team features — org-config patterns, `pai setup --team` mode
- [ ] Local model support — Ollama/llama.cpp for privacy and cost control
- [ ] Remote access — PAI from mobile/web/other machines
- [ ] External notifications — Discord/Slack/email for long-running task completion

### Deferred EM/PLM Work (Tier 5)
- [ ] NPI Dashboard — needs product thinking: gates, milestones, risk roll-ups
- [ ] Release Notes Generator — needs audience definition, format, source mapping
- [ ] Team Health Tracker — needs privacy design, review cycle integration
