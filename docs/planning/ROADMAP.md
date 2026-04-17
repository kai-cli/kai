# PAI Roadmap

> Canonical repo: `kai-cli/kai`
> This file maps what PAI is building toward. [NEXT-STEPS.md](NEXT-STEPS.md) has the tactical checklist.

---

## What's Shipped

| Release | Date | Highlights |
|---------|------|-----------|
| **v4.5.0** | 2026-03-26 | Ralph Loop autonomous execution, multi-agent orchestrator, Board v2 (kanban + sessions + library), SecretScanner, SecurityValidator, patterns.yaml, deploy packager, personal data removed from git, fork archived |
| **v4.4.1** | 2026-03-23 | 5 runtime bug fixes, phantom hook removal, doc accuracy pass, CLAUDE.md drift detection |
| **v4.4.0** | 2026-03-10 | EM/PLM workflows (OneOnOne, WeeklyStatus, DecisionLog, NPITracker), 3 named agents, CompetitiveIntel, StandardsTracker, FormatReminder hook, voice TTS removed, BuildSettings env-var expansion |
| **v4.1.0** | 2026-03-06 | Atomic writes, payload schema validation, settings split, `pai upgrade` CLI |

[Full release history](../releases/)

---

## Current: v4.6.0 — Intelligence + Reliability

**Theme:** Make the agent system smarter, trim dead weight, then make autonomous execution reliable.

**Completed:**
- Hook hardening (run-hook.sh wrapper, async flags)
- Install safety (settings migration, local overrides)
- Deployment docs (WHATS-DIFFERENT.md, README, installer versioning)
- Tracked files audit (3,347 → 1,941 files)

**In Progress:**

### 1. Intelligence Layer (NOW)
- Research index — searchable catalog of prior research across sessions
- Agent context seeding — auto-inject relevant research into spawned agents
- Research deduplication — detect already-researched topics

### 2. Dead Skill Trim
- Audit and prune Fabric patterns (~300 unused)
- Remove stale/unused skills
- Clean old Algorithm versions

### 3. Ralph Loop Budget Fix (P0)
- Sonnet fallback for routine iterations
- Algorithm overhead reduction
- Context-per-task bundling

### 4. Algorithm Improvements (P1)
- Phase-locked tool access (read-only in OBSERVE/THINK)
- Triangulation verification in VERIFY phase
- Session handoff protocol for compaction/continuation

### 5. Security & Quality Gates (P1)
- WebFetch/WebSearch outbound request guard
- PostToolUse code quality gate

### 6. Team Deployment
- Coworker onboarding guide
- Org-config patterns
- Board PRD creation from UI

### 7. Memory & Knowledge (P2)
- Architectural Decision Records
- Project state snapshots at releases

---

## Future Direction

### Model Flexibility
- **Local model support** — Ollama/llama.cpp for privacy and cost control
- **Model routing** — route by task complexity (cheap for lookups, best for deep work)

### Connectivity
- **Remote access** — PAI from mobile, web, other machines
- **External notifications** — Discord/Slack/email for long-running tasks

### Infrastructure
- Memory TTL/archival (unbounded growth)
- Hook timeout guards
- Settings split (static config vs runtime state)
- Test coverage expansion

---

## Out of Scope

- **Voice TTS** — Removed in v4.4.0, no plans to reintroduce
- **Upstream fork sync** — Fork (danielmiessler/Personal_AI_Infrastructure) archived; PAI has diverged completely
