# Feature Workflow

Coordinated PM → Dev(s) → QA pipeline for building new features.

## Execution

**In Claude Code sessions:** Use Agent tool calls directly (see SKILL.md Step 3).

**In standalone terminal:**
```bash
bun ~/.claude/scripts/dev-team.ts --preset feature --issue "<description>" --cwd "<project-path>" --verbose
```

## Phase Details

### Phase 0: Target Resolution

Before any agent work:
1. Resolve the target repo path (must be a git repo)
2. If cwd ≠ target, warn user and get direction (switch / abort)
3. Detect CI availability: `ls <target>/.github/workflows/ 2>/dev/null`
4. Load resource context from `Context/` if available
5. Identify correct base branch (check repo default — may not be `main`)

### Phase 1: PM Scoping

PM agent receives the feature description and must produce:
- Feature requirements (what it does, user-facing behavior)
- Acceptance criteria (checkable conditions)
- Edge cases to test
- Scope boundary (what's out of scope for this iteration)

PM prompt must include:
- Target directory path
- Available resources (wiki, MCP, etc.)
- CI availability status

### Phase 2: Dev Implementation

Two Dev agents work in parallel:
- **dev-1**: Core feature logic
- **dev-2**: Tests and integration points

Both work in the target project directory. Each creates their own branch.
If work conflicts, dev-1's branch is primary, dev-2 rebases onto it.

Dev prompts must include:
- `"Working directory: <path>. All file operations happen here."`
- `"Create a feature branch. Commit locally. Do NOT push or create PRs."`
- Resource context (wiki, MCP tools)
- Base branch to branch from

### Phase 3: QA Verification

**If CI exists:**
- Run test suite, verify each acceptance criterion
- Check edge cases, verify no regressions
- Report pass/fail with evidence

**If NO CI exists:**
- Grep audits, static analysis, logic review
- Use MCP tools for live verification if available
- Report what was checked and how

### Retry Loop

If QA fails (max 2 retries):
1. QA's failure report sent to Dev agents
2. Devs address specific failures (same branches)
3. QA re-verifies
4. After 2 failures: escalate to user with full context

### Phase 4: Review

If review enabled:
- Bedrock: `deliberate.ts --mode doc-review --doc <diff-file>`
- Claude-only: 3 adversarial agents (security, correctness, pragmatist)
- Must-fix items loop back to Dev before proceeding

### Phase 5: Push & PR (Orchestrator Only)

**Agents do not push.** The orchestrator:
1. Collects Dev commits (branches, hashes, summaries)
2. Confirms review passed
3. Presents to user for approval
4. Pushes and creates PR after confirmation
5. Updates source issue if one was provided
