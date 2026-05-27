---
name: DevTeam
description: Autonomous development teams — spin up coordinated PM/Dev/QA agents to fix bugs, build features, or investigate issues. USE WHEN dev team, fix bug with team, agent team for development, spin up dev team, QA team, debug team, investigation team, devteam.
---

## Customization

**Before executing, check for user customizations at:**
`~/.claude/skills/PAI/USER/SKILLCUSTOMIZATIONS/DevTeam/`

If this directory exists, load and apply any PREFERENCES.md, configurations, or resources found there. These override default behavior. If the directory does not exist, proceed with skill defaults.

**Output text notification**:
```
Running the **WorkflowName** workflow in the **DevTeam** skill to ACTION...
```

# DevTeam — Autonomous Development Team Orchestration

Spins up coordinated AI agent teams (PM, Dev, QA) to autonomously investigate, fix, and verify bugs or build features. Supports Bedrock multi-model review (PAI) or Claude-only adversarial review (KAI).

## Workflow Routing

| Trigger | Workflow |
|---------|----------|
| Bug fix, fix this bug, debug and fix | `Workflows/BugFix.md` |
| Build feature, implement this | `Workflows/Feature.md` |
| Investigate, debug, figure out why | `Workflows/Investigation.md` |
| First-time setup, explain how devteam works | `Workflows/Launch.md` |

## Quick Reference

| Preset | Roles | Purpose |
|--------|-------|---------|
| **bug-fix** | PM + Dev + QA | Scope → fix → verify a bug |
| **feature** | PM + Dev + Dev + QA | Scope → implement → verify a feature |
| **investigation** | Lead + 2 Researchers | Deep-dive debugging, root cause analysis |
| **code-review** | 3 Reviewers | Multi-perspective code review only |

## Script

The orchestration engine is at `~/.claude/scripts/dev-team.ts`.

```bash
# Bug fix
bun ~/.claude/scripts/dev-team.ts --preset bug-fix --issue "Login fails on Safari"

# Feature build
bun ~/.claude/scripts/dev-team.ts --preset feature --issue "Add dark mode toggle"

# Investigation
bun ~/.claude/scripts/dev-team.ts --preset investigation --issue "Memory leak in worker pool"

# With GitHub issue
bun ~/.claude/scripts/dev-team.ts --preset bug-fix --github "owner/repo#123"

# Skip review phase
bun ~/.claude/scripts/dev-team.ts --preset bug-fix --no-review --issue "Typo in error message"

# Specific working directory
bun ~/.claude/scripts/dev-team.ts --preset bug-fix --cwd ~/Projects/myapp --issue "..."
```

## Lifecycle

```
Phase 0: Proposal     → Present team preset, user confirms/adjusts
Phase 1: Scope (PM)   → Define acceptance criteria
Phase 2: Implement    → Dev works in worktree, merges when done
Phase 3: Verify (QA)  → Test against criteria (max 2 retries)
Phase 4: Review       → Bedrock panel or Claude adversarial (optional)
Phase 5: Report       → Synthesis + cleanup
```

Phase gates: each phase only starts after the previous phase's agent signals completion. Orchestrator owns sequencing.

## Review Modes

| Mode | When | Quality |
|------|------|---------|
| Bedrock panel | AWS credentials available | Multi-model (DeepSeek, Mistral, Llama) |
| Claude adversarial | No AWS / KAI users | Single-model, multi-prompt (lighter) |
| Disabled | `--no-review` flag | Skipped entirely |

## Observability

Each run produces `~/.claude/teams/{team-name}/run.jsonl` with phase transitions, durations, and failure reasons. Use for debugging failed runs.

## Integration

- Uses **TeamCreate** for coordination
- Uses **deliberate.ts** doc-review mode for Bedrock panel
- Uses **Agent tool** with worktree isolation for Dev
- Inherits safety patterns from **ralph-loop** (budget caps, stuck detection, cleanup)
