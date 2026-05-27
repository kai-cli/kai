---
name: DevTeam
description: Autonomous development teams — spin up coordinated PM/Dev/QA agents to fix bugs, build features, or investigate issues. USE WHEN dev team, fix bug with team, agent team for development, spin up dev team, QA team, debug team, investigation team, devteam.
argument-hint: "[preset] description of issue"
---

## Invocation

When `/devteam` is invoked, follow this flow:

### Step 1: Parse Input

The user provides `$ARGUMENTS` — typically a description like "fix the login bug on Safari" or "investigate memory leak in worker pool".

Determine the flow from the input using this priority order:

**Compound flows (auto-chain, fully autonomous):**
- Contains BOTH investigate/review AND fix/patch → `investigate-then-fix` (run investigation, feed findings directly into bug-fix pipeline — no pause between)
- "review and fix", "investigate a fix", "look into and fix" → `investigate-then-fix`

**Single presets:**
- Contains "just fix", "fix this", "bug", "broken", "patch" (without "investigate") → `bug-fix`
- Contains "build", "feature", "implement", "add" → `feature`
- Contains "investigate", "figure out", "why", "root cause", "look into" (without "fix") → `investigation`
- Contains "review", "check code" (without "fix") → `code-review`
- If unclear, ask the user via AskUserQuestion

**Compound flow execution:**
When `investigate-then-fix` is detected:
1. Run the investigation (Lead + Researchers)
2. Present findings briefly to user (no pause/confirmation)
3. Immediately launch bug-fix team with investigation findings injected into the PM prompt as pre-existing context (PM skips re-investigation, goes straight to criteria)

### Step 2: Propose Team

Run a dry-run to show the team composition:

```bash
bun ~/.claude/scripts/dev-team.ts --preset <detected-preset> --issue "$ARGUMENTS" --dry-run
```

Present the output to the user and ask via AskUserQuestion:
- "Does this team composition look right?"
- Options: "Yes, launch it", "Change preset", "Adjust options"

### Step 3: Launch

After confirmation, orchestrate the team **using Agent tool calls directly** (not the script — the script is for standalone terminal use outside Claude Code).

**IMPORTANT: Always use `subagent_type: "general-purpose"` for all agents.** Other types (Architect, Plan, Engineer) trigger worktree hooks that interfere. Control behavior via the prompt content instead.

**For investigation preset:**
1. Spawn Lead agent (general-purpose, sonnet or opus) with full issue context and investigation questions
2. When lead returns, synthesize findings into a structured report

**For bug-fix preset:**
1. Spawn PM agent (general-purpose, sonnet) — role defined in prompt, scopes and defines criteria
2. After PM returns, spawn Dev agent (general-purpose, sonnet) with PM's criteria + worktree instructions in prompt
3. After Dev returns, spawn QA agent (general-purpose, sonnet) to verify
4. If QA fails and retries < 2, loop Dev with QA feedback
5. Optionally run review via `bun ~/.claude/scripts/deliberate.ts --mode doc-review`

**For feature preset:**
Same as bug-fix but with parallel Dev agents.

**For investigate-then-fix compound flow:**
1. Spawn Investigation Lead agent (general-purpose, sonnet) with full analysis prompt
2. When lead returns with findings, **immediately** spawn bug-fix PM with findings pre-loaded:
   - PM prompt includes: "Investigation already completed. Findings: {findings}. Your job is ONLY to define acceptance criteria based on these findings — do NOT re-investigate."
3. Continue standard bug-fix flow (Dev → QA → Review)

Use `run_in_background: false` for sequential agents (PM before Dev, Dev before QA).
Use `run_in_background: true` only when you have independent parallel work to do while waiting.

Example invocation pattern:
```
Agent({
  description: "Lead: Investigate PSIRT issue",
  subagent_type: "general-purpose",
  model: "sonnet",
  prompt: "<investigation prompt with full context>"
})
```

### Step 4: Report

After all agents complete, synthesize their outputs into a final report. Present to user.
If the user wants it saved: write to `~/.claude/teams/{team-name}/report.md`.

---

## Customization

**Before executing, check for user customizations at:**
`~/.claude/skills/PAI/USER/SKILLCUSTOMIZATIONS/DevTeam/`

If this directory exists, load and apply any PREFERENCES.md, configurations, or resources found there.

# DevTeam — Autonomous Development Team Orchestration

Spins up coordinated AI agent teams (PM, Dev, QA) to autonomously investigate, fix, and verify bugs or build features. Supports Bedrock multi-model review (KAI) or Claude-only adversarial review (KAI).

## Workflow Routing

| Trigger | Workflow |
|---------|----------|
| Bug fix, fix this bug, debug and fix | `Workflows/BugFix.md` |
| Build feature, implement this | `Workflows/Feature.md` |
| Investigate, debug, figure out why | `Workflows/Investigation.md` |
| Investigate AND fix (compound) | Investigation → BugFix (autonomous chain) |
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
