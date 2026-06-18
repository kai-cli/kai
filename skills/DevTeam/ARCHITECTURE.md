# DevTeam Orchestrator — Architecture Design v1

## Problem Statement

A system that takes a bug report, issue, or feature request and autonomously spins up a coordinated development team of AI agents (PM, Dev, QA) to investigate, fix, and verify. Works with Bedrock multi-model review (PAI) or Claude-only agents (KAI).

## Architecture

### Orchestration Model: Hybrid

- **TeamCreate** for coordination — team with shared task list, message coordination via SendMessage
- **Orchestrator = team-lead** — not external, explicitly the team lead agent that owns sequencing
- **Bedrock panel** for independent review (optional) — fan out to DeepSeek, Mistral, Llama via deliberate.ts
- **Claude-adversarial fallback** — when Bedrock unavailable, Claude agents with adversarial prompts (documented as lighter than Bedrock panel)

### Triggering

1. **CLI**: `bun scripts/dev-team.ts --preset bug-fix --issue "description"`
2. **Skill**: `/devteam fix this bug...` (interactive, with confirmation)

### Lifecycle & Phase Gating

```
Phase 0: Team Proposal
  → Load preset (bug-fix, feature, investigation, code-review)
  → Present team to user, confirm/adjust
  → User approves

Phase 1: Scope (PM)
  → TeamCreate with approved roles (orchestrator = team-lead)
  → PM agent scopes work, writes acceptance criteria as tasks
  → GATE: PM marks scoping task complete → orchestrator spawns Dev

Phase 2: Implement (Dev)
  → Dev works in git worktree
  → Dev completes fix, merges worktree
  → GATE: Dev marks implementation task complete + merge confirmed
    → orchestrator spawns QA

Phase 3: Verify (QA)
  → QA runs tests against merged code
  → IF QA passes → proceed to Phase 4
  → IF QA fails → retry loop (max 2 attempts)
    → Dev gets QA findings, tries again
    → After 2 failures → escalate to user
  → GATE: QA marks verification task complete

Phase 4: Review (optional, auto-detected)
  → IF Bedrock available: deliberate.ts --mode doc-review on diff
  → IF Claude-only: adversarial Claude agents (lighter, documented as such)
  → Produces structured findings

Phase 5: Report
  → Synthesize: what changed, verification results, review findings
  → Clean up worktree (if not already merged)
  → Team dissolves
```

### Retry Policy

- Max 2 Dev→QA cycles per task
- Decreasing scope: retry 2 focuses only on QA's specific failures
- After 2 failures: escalate to user with full context (what was tried, what failed)
- Budget continues to decrement during retries
- QA Priority Signal determines urgency: Critical Blocker forces retry, Minor Concern can be deferred

### Three-Tier Recovery

Every phase execution goes through `executePhaseWithRecovery()`:

1. **Auto-Retry** — Timeouts and transient errors (rate limits, overloaded) trigger automatic retry with a 2s backoff. No user involvement.
2. **Explicit Recovery** — Non-transient failures augment the prompt with failure context ("Previous attempt failed because X. Adjust your approach.") and retry with the enriched prompt.
3. **Escalate** — After exhausting recovery attempts, surfaces the failure to the user with full context. Never silently swallows failures.

### Liveness & Timeout

Each phase has a configurable timeout (default: 300s, override via `--timeout`):
- Agent process is SIGTERM'd on timeout, SIGKILL'd after 3s grace
- Timeout failures enter recovery pipeline as auto-retry tier
- Prevents indefinitely stuck agents from blocking the pipeline

### Failure & Cleanup

On ANY failure (budget exhaustion, stuck agent, unrecoverable error):
1. Clean up git worktree if it exists
2. Write run log with what happened
3. Report to user with last known state
4. Team dissolves

No partial states left behind. No orphaned worktrees.

### Model Mixing

Roles define default models in preset YAML, but can be overridden:
- CLI: `--model-override "scope:opus,implement:opus"` upgrades specific phases
- Interactive: orchestrator applies overrides before spawning agents
- Use cases: Opus for complex scoping, Sonnet for implementation grunt work, Haiku for simple QA checks

### Atomic File Scope (Parallel Devs)

When multiple dev agents run in parallel, `assignFileScopes()` divides PM-identified files between them:
- Extracts file paths from PM findings via regex
- Round-robin assigns to dev agents
- Each dev prompt includes a `## File Scope Assignment` section listing their owned files
- Instruction: "Do NOT modify files outside your assignment to avoid conflicts"
- Prevents merge conflicts without heavyweight locking infrastructure

### Run Log (Observability)

Each team run produces `~/.claude/teams/{team-name}/run.jsonl`:

```jsonl
{"ts":"...","phase":"scope","event":"start","agent":"pm"}
{"ts":"...","phase":"scope","event":"complete","agent":"pm","duration_ms":45000}
{"ts":"...","phase":"implement","event":"start","agent":"dev","worktree":"/tmp/wt-abc"}
{"ts":"...","phase":"implement","event":"complete","agent":"dev","duration_ms":120000}
{"ts":"...","phase":"verify","event":"start","agent":"qa"}
{"ts":"...","phase":"verify","event":"fail","agent":"qa","reason":"2 tests failing","attempt":1}
{"ts":"...","phase":"verify","event":"retry","agent":"dev","attempt":2}
{"ts":"...","phase":"verify","event":"complete","agent":"qa","attempt":2}
{"ts":"...","phase":"review","event":"start","mode":"bedrock"}
{"ts":"...","phase":"review","event":"complete","models":6,"duration_ms":98000}
{"ts":"...","phase":"report","event":"complete","total_ms":380000}
```

### KAI Compatibility Note

KAI users without Bedrock get the same team structure and coordination. Phase 4 (Review) uses Claude agents with adversarial system prompts. This provides multi-perspective review but is explicitly **single-model, multi-prompt** — lighter than Bedrock's genuine model diversity. Both are useful; they're not equivalent.

### Preset Format (YAML)

```yaml
name: Bug Fix
description: Coordinated team to diagnose, fix, and verify a bug
retry_max: 2
roles:
  - id: pm
    agent_type: Plan
    model: sonnet
    purpose: Scope the bug, reproduce, define acceptance criteria
    worktree: false
  - id: dev
    agent_type: Engineer
    model: sonnet
    purpose: Implement the fix
    worktree: true
  - id: qa
    agent_type: QATester
    model: sonnet
    purpose: Verify fix passes criteria, check for regressions
    worktree: false
review:
  enabled: true
  bedrock_models: [deepseek, mistral, llama-researcher]
  fallback: claude-adversarial
```

### File Layout

```
scripts/dev-team.ts              — CLI entrypoint + orchestration logic
skills/DevTeam/SKILL.md          — Skill definition and workflow routing
skills/DevTeam/Workflows/
  Launch.md                      — Proposal + confirmation flow
  BugFix.md                      — Bug fix team workflow
  Feature.md                     — Feature build team workflow
  Investigation.md               — Debug/investigation workflow
skills/DevTeam/Presets/
  bug-fix.yaml
  feature.yaml
  investigation.yaml
  code-review.yaml
```

### Bedrock Detection

```typescript
async function detectReviewCapability(): Promise<"bedrock" | "claude-adversarial"> {
  const proc = Bun.spawn(["aws", "sts", "get-caller-identity"], { stdout: "pipe", stderr: "pipe" });
  const exitCode = await proc.exited;
  return exitCode === 0 ? "bedrock" : "claude-adversarial";
}
```

---

## v2 Roadmap (remaining)

- Concurrency isolation for parallel `/devteam` runs
- Real-time cost streaming to user during execution
- `/devteam status` command for mid-run monitoring
- Preset schema versioning
- Per-phase budget accounting (currently: single total budget, fail-and-cleanup on exhaustion)
- Adversarial-vs-panel eval suite proving coverage parity
- Dynamic role addition mid-task (e.g., security specialist if QA finds vulnerability)
- Adaptive retry limits based on QA priority signal (Critical → always retry, Minor → skip)
