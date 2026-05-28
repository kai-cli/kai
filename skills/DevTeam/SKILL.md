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

### Step 1b: Classify Goal Ancestry

Before proposing the team, infer goal ancestry from the user's input:

- **userIntent**: Restate the user's request in one clear sentence (their words, not yours)
- **priority**: Infer from signal words:
  - `critical` — "production", "blocking", "urgent", "down", "security", "CVE", "PSIRT"
  - `exploratory` — "cleanup", "experiment", "explore", "nice to have", "when you get a chance"
  - `standard` — everything else
- **whyThisMatters**: One sentence on the consequence of NOT doing this (infer from context)

These values are presented for user validation in Step 2 and injected into all agent prompts via `goalAncestry`.

### Step 2: Propose Team

Run a dry-run to show the team composition:

```bash
bun ~/.claude/scripts/dev-team.ts --preset <detected-preset> --issue "$ARGUMENTS" --dry-run
```

Present the output to the user and ask via AskUserQuestion. Include your inferred goal ancestry for validation:

```
Team: Bug Fix — PM (sonnet) → Dev (sonnet) → QA (sonnet)
Priority: standard
Why: [your inferred whyThisMatters]

Does this look right?
```

- Options: "Yes, launch it", "Change priority" (with description showing critical/standard/exploratory), "Change preset", "Adjust options"

If the user changes priority, update the `goalAncestry.priority` and `goalAncestry.whyThisMatters` accordingly before launching.

### Step 3: Launch

After confirmation, orchestrate the team **using Agent tool calls directly** (not the script — the script is for standalone terminal use outside Claude Code).

**IMPORTANT: Always use `subagent_type: "general-purpose"` for all agents.** Other types (Architect, Plan, Engineer) trigger worktree hooks that interfere. Control behavior via the prompt content instead.

---

#### Pre-Launch: Target Directory Resolution

**Before spawning any agents, resolve the correct working directory for the target code:**

1. Read `~/.claude/PAI/USER/PROJECTS/REGISTRY.md` to look up the target repo by name, package, or GitHub URL
2. Use the registry's `path`, `default_branch`, `ci`, and `resources` fields for all downstream decisions
3. If the current working directory (`$CWD`) is NOT the target repo, **warn the user**:
   - "The target code is in `<path>`. I'm currently in `<cwd>`. Dev agents need the target directory to work effectively."
   - Ask: "Switch to target project?" / "Continue from here (investigation only)" / "Output patch for manual apply"
4. For investigation/review presets: working from a different directory is acceptable (read-only)
5. For bug-fix/feature presets: the Dev agent MUST have the correct cwd. Include explicit path in the agent prompt: `"Working directory: <resolved-path>. All file edits, git operations, and tests must happen here."`
6. Use the registry's `default_branch` for PR targets — **do not assume `main`**

**Never silently work on code in a different repo from the current directory for fix/feature presets.**

---

#### Pre-Launch: Resource Injection

**Two sources of context for agents:**

1. **Registry** (`~/.claude/PAI/USER/PROJECTS/REGISTRY.md`): Provides path, branch, CI status, and `resources` field (wiki paths, MCP server names). Always inject relevant registry entry into agent prompts.
2. **Context/ directory** (project-specific deep context): Check `Context/` for supplemental files matching the target project. These provide architecture details, daemon internals, and domain knowledge beyond what the registry covers.

Both should be injected into agent prompts. Registry = operational facts. Context/ = domain knowledge.

---

#### Pre-Launch: GitHub Write Awareness

**Agents cannot self-approve GitHub write operations** (push, PR create, issue comment). The orchestrator (you) must:
1. Collect the agent's proposed git operations at the end of their work
2. Present them to the user for approval
3. Execute the push/PR/comment yourself after user confirmation

Include this instruction in every Dev agent prompt: `"Do NOT push or create PRs. Commit locally and report what you've done. The orchestrator will handle GitHub operations after your work is verified."`

---

#### Preset Execution

**For investigation preset:**
1. Spawn Lead agent (general-purpose, sonnet or opus) with full issue context, investigation questions, AND available resources
2. When lead returns, synthesize findings into a structured report

**For bug-fix preset:**
1. Spawn PM agent (general-purpose, sonnet) — role defined in prompt, scopes and defines criteria
2. After PM returns, spawn Dev agent (general-purpose, sonnet) with PM's criteria + target directory + resource context
3. After Dev returns, spawn QA agent (general-purpose, sonnet) to verify
4. If QA fails and retries < 2, loop Dev with QA feedback
5. Run review via `bun ~/.claude/scripts/deliberate.ts --mode doc-review`
6. **Orchestrator handles push/PR** — collect Dev's commit, present to user, execute after approval

**For feature preset:**
Same as bug-fix but with parallel Dev agents.

**For investigate-then-fix compound flow:**
1. Spawn Investigation Lead agent (general-purpose, sonnet) with full analysis prompt
2. When lead returns with findings, run Bedrock review on findings if substantive
3. **Immediately** spawn bug-fix PM with findings + review output pre-loaded:
   - PM prompt includes: "Investigation already completed. Findings: {findings}. Review panel feedback: {review}. Your job is ONLY to define acceptance criteria based on these findings — do NOT re-investigate."
4. Continue standard bug-fix flow (Dev → QA → Review → Push)

---

#### QA Without CI

**If the target repo has no CI pipeline** (no test workflows, no build gates), the QA agent must verify using available means:
- `grep` audits (confirm all instances of a pattern are handled)
- Static analysis (type consistency, missing includes, buffer sizes)
- Logic review against acceptance criteria
- Check compilation prerequisites (correct includes, no undefined symbols)
- If MCP tools are available (e.g., `router_exec`), use them for live verification
- Report clearly: "No CI available. Verified via: [list of checks performed]"

Include this in QA agent prompt when no CI detected: `"This repo has no automated CI. Verify the fix using grep audits, static analysis, and any available MCP tools. Do NOT claim 'tests pass' if no tests exist."`

---

#### Agent Orchestration Rules

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

# Critical priority with custom timeout
bun ~/.claude/scripts/dev-team.ts --preset bug-fix --issue "Prod down" --priority critical --why "Blocking all deploys" --timeout 600

# Model mixing: Opus for scoping, Sonnet for implementation
bun ~/.claude/scripts/dev-team.ts --preset bug-fix --issue "Complex auth bug" --model-override "scope:opus"

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
