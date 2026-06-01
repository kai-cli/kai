# Background Feature Workflow

Coordinated PM (foreground) → Dev(s) (background) → QA (background) pipeline for building new features with Agent View isolation.

## When to Use This Workflow

**Use BackgroundFeature when:**
- Feature will take >15 minutes per dev (compile time, large codebase, extensive tests)
- Multiple features can be parallelized (don't block the terminal)
- User wants to monitor/interact with other work while devs run

**Use standard Feature when:**
- Quick iterations (<15 min total)
- User wants real-time agent output in one session
- No worktree overhead needed

## Execution

**From Claude Code session:**
```typescript
// Orchestrator uses Agent tool with --bg flag
Agent("Engineer", {
  background: true,
  task: "Implement X in ~/Projects/Y",
  goal: "feature-x-core-logic"
});
```

**From terminal:**
```bash
bun ~/.claude/scripts/dev-team.ts --preset feature --background --issue "<description>" --cwd "<project-path>"
```

Monitor with: `claude agents` TUI or peek `~/.claude/roster.json`

## Phase Details

### Phase 0: Target Resolution (FOREGROUND — Orchestrator)

Before any agent work:
1. Resolve target repo path (must be a git repo)
2. If cwd ≠ target, warn user and get direction (switch / abort)
3. Detect CI availability: `ls <target>/.github/workflows/ 2>/dev/null`
4. Load resource context from `Context/` if available
5. Identify correct base branch (check repo default — may not be `main`)
6. Create agent roster slots:
   - PM (foreground)
   - dev-1 (background, worktree TBD)
   - dev-2 (background, worktree TBD)
   - QA (background after devs complete, worktree TBD)

### Phase 1: PM Scoping (FOREGROUND — Interactive)

PM agent runs in same session as orchestrator for user interaction:
- Feature requirements (what it does, user-facing behavior)
- Acceptance criteria (checkable conditions)
- Edge cases to test
- Scope boundary (what's out of scope)

**PM output must include:**
- Requirements.md (artifact saved to orchestrator cwd)
- Acceptance criteria checklist
- Resource recommendations (which MCP tools, wiki pages, etc.)

**Orchestrator waits for user approval** of PM scope before dispatching devs.

### Phase 2: Dev Implementation (BACKGROUND — Parallel)

Dispatch two Dev agents as background sessions:

```bash
claude --agent dev-1 --bg "Implement core logic for <feature> per Requirements.md" --goal feature-x-core
claude --agent dev-2 --bg "Implement tests and integration for <feature> per Requirements.md" --goal feature-x-tests
```

Each Dev gets:
- **Automatic worktree isolation** (Agent View creates `~/.claude-worktrees/<agent-id>/`)
- **Own feature branch** (no conflicts, dev-1 doesn't see dev-2's commits live)
- **Resource context** passed via --task (wiki paths, MCP tool names)
- **Base branch** to branch from (passed in task description)

**Dev Instructions (passed in task prompt):**
```
Working directory: <target-path> (your worktree is isolated).
Create feature branch from <base-branch>.
Implement <feature-aspect>.
Commit locally when done.
Push your branch and create a DRAFT PR with:
- Title: "[DevTeam] <feature-aspect>"
- Body: Requirements.md checklist + commit hash
Mark DONE when PR created.
```

**Orchestrator monitors progress:**
- Poll `~/.claude/roster.json` every 30s for status changes
- Use `claude peek dev-1` for recent output (optional, non-blocking)
- Dev sessions mark themselves DONE when PR created
- If Dev session FAILED: notify user, offer respawn with refined task

### Phase 3: QA Verification (BACKGROUND — After Devs Complete)

When **both** dev-1 and dev-2 are DONE:

1. Orchestrator parses draft PR URLs/commit hashes from dev outputs
2. Fetches combined diff: `gh pr diff <pr-1>` + `gh pr diff <pr-2>`
3. Dispatches QA agent as background session:

```bash
claude --agent qa-1 --bg "Verify feature <X> against acceptance criteria. PRs: <url1>, <url2>" --goal feature-x-qa
```

**QA Instructions:**
- Worktree contains target repo at latest base branch
- Fetch and merge both dev branches locally (no push)
- If CI exists: run test suite, check acceptance criteria
- If NO CI: grep audits, static analysis, MCP tool verification
- Post findings as PR review comments on both draft PRs
- Mark DONE with pass/fail status

**Orchestrator monitors QA:**
- Poll roster.json for QA DONE or FAILED
- If QA FAILED: parse failure reason, respawn Devs with fixes (max 2 retries)
- If QA PASSED: proceed to Phase 4

### Retry Loop (BACKGROUND — Automated)

On QA failure (max 2 retries):
1. Orchestrator extracts QA failure report from PR comments
2. Respawns Dev agents with refined task:
   ```bash
   claude --agent dev-1-retry1 --bg "Fix QA failures: <failure-list>. Work on existing branch <branch-name>" --goal feature-x-core-fix1
   ```
3. Devs amend commits or add new commits, push, update PRs
4. QA re-verifies (new background session on updated PRs)
5. After 2 failures: escalate to user with full context (all PR links, QA reports)

### Phase 4: Review (FOREGROUND — Bedrock or Adversarial)

If review enabled (orchestrator decision based on user config):

**Option A: Bedrock multi-model deliberation** (if available)
```bash
bun ~/.claude/scripts/deliberate.ts --mode doc-review --doc <combined-diff-file>
```

**Option B: Claude adversarial agents** (foreground, parallel)
- Security agent (injection, DoS, auth bypass)
- Correctness agent (logic bugs, edge cases)
- Pragmatist agent (maintainability, over-engineering)

Review outputs: must-fix vs nice-to-have. Must-fix → respawn Devs (counts as retry).

### Phase 5: Push & PR Merge (FOREGROUND — User Approval)

**Orchestrator collects results:**
- dev-1 PR URL + commit hash
- dev-2 PR URL + commit hash
- QA pass status + evidence
- Review pass status (if ran)

**Present to user:**
```
Feature <X> complete:
- Core logic: <PR-1> (<hash>)
- Tests: <PR-2> (<hash>)
- QA: PASSED (<evidence-link>)
- Review: PASSED (3/3 agents, 0 must-fix)

Ready to mark PRs ready-for-review and merge?
```

**On approval:**
1. `gh pr ready <pr-1> <pr-2>` (unmark draft)
2. Merge PRs (orchestrator decides order: tests first or core first based on dependencies)
3. Delete feature branches
4. Update source issue if one was provided

**Orchestrator does NOT auto-merge.** Always wait for explicit user confirmation.

## Coordination Mechanisms

### How Orchestrator Monitors Progress

1. **roster.json polling** (authoritative state):
   ```typescript
   const roster = JSON.parse(fs.readFileSync("~/.claude/roster.json"));
   const devStatus = roster.agents.find(a => a.name === "dev-1").status;
   // status: "running" | "done" | "failed"
   ```

2. **PR metadata as result channel**:
   - Devs write commit hash + checklist status in PR body
   - QA writes pass/fail in PR review comments
   - Orchestrator parses these (don't rely on agent return values)

3. **Optional peek for diagnostics**:
   ```bash
   claude peek dev-1 --lines 50  # last 50 lines of output
   ```

### How Results Flow Back

- **Dev → Orchestrator**: Draft PR URL in roster.json metadata field `result_url`
- **QA → Orchestrator**: PR review comment + roster.json status=done/failed
- **Orchestrator → User**: Summary message with all PR links and status badges

### Failure Handling

**Dev session fails (status=failed in roster.json):**
1. Orchestrator reads failure reason from roster metadata or last output
2. Notify user: "dev-1 failed: <reason>. Respawn with refined task?"
3. User can:
   - Respawn with same task (maybe transient issue)
   - Refine task manually and respawn
   - Abort feature workflow

**QA session fails:**
- Same as dev failure handling
- Orchestrator can auto-respawn QA once (maybe PR fetch race condition)

**Worktree cleanup on failure:**
- Agent View auto-cleans worktrees on session exit
- Orchestrator can force-clean: `claude agents remove dev-1` (also deletes worktree)

## /goal Recommendations

For background agents, set clear goals for roster visibility:

- **dev-1**: `feature-x-core-logic` or `feature-x-component-y`
- **dev-2**: `feature-x-tests` or `feature-x-integration`
- **QA**: `feature-x-qa-verification`
- **Retry devs**: `feature-x-core-fix1`, `feature-x-core-fix2`

Goals appear in `claude agents` TUI and help user track parallel work.

## Example Full Flow

```typescript
// Phase 0: Orchestrator setup
const target = resolveTargetRepo("~/Projects/my-project");
const ciExists = fs.existsSync(`${target}/.github/workflows/`);

// Phase 1: PM scoping (foreground, interactive)
const pmAgent = Agent("ProductManager", {
  task: `Scope feature: <user-description>. Target: ${target}. CI: ${ciExists}`,
  foreground: true
});
const requirements = await pmAgent.run();
console.log("📋 PM Scope:", requirements);
const approved = await askUser("Approve scope? (y/n)");
if (!approved) return;

// Phase 2: Dispatch devs (background, parallel)
const dev1 = Agent("Engineer", {
  background: true,
  task: `Implement core logic per Requirements.md at ${target}`,
  goal: "feature-x-core"
});
const dev2 = Agent("Engineer", {
  background: true,
  task: `Implement tests per Requirements.md at ${target}`,
  goal: "feature-x-tests"
});

// Monitor until both done
await pollUntilDone([dev1.id, dev2.id]);

// Phase 3: QA (background)
const prUrls = [dev1.result_url, dev2.result_url];
const qa = Agent("QA", {
  background: true,
  task: `Verify PRs: ${prUrls.join(", ")}. Check acceptance criteria.`,
  goal: "feature-x-qa"
});
await pollUntilDone([qa.id]);

if (qa.status === "failed") {
  // Retry loop (omitted for brevity)
}

// Phase 4: Review (foreground, if enabled)
const diff = getCombinedDiff(prUrls);
const reviewResult = await runReview(diff);

// Phase 5: User approval (foreground)
const summary = formatSummary({ prUrls, qa: qa.result, review: reviewResult });
console.log(summary);
const mergePlan = await askUser("Merge plan OK? (y/n)");
if (mergePlan) {
  await mergePRs(prUrls);
  console.log("✅ Feature merged.");
}
```

## Resource Context

Pass resource hints in task descriptions:
- `"Check ~/Projects/YourCompany-Wiki/firmware/build-system.md for build commands"`
- `"Use mcp__router__router_exec for live device testing"`
- `"CI workflow at .github/workflows/test.yml"`

Devs and QA load these on-demand via Read or MCP tools.

## Notes

- **No inter-agent Agent calls**: Background agents can't spawn sub-agents. Orchestrator spawns all agents.
- **Worktree isolation is automatic**: Agent View creates/destroys worktrees. Orchestrator doesn't manage them.
- **Draft PRs are the handoff**: Not commit messages, not return values. PRs are the contract.
- **Orchestrator is thin**: It's a state machine that dispatches, polls, and reports. No implementation logic.
