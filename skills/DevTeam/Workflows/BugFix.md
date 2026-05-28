# BugFix Workflow

Coordinated PM → Dev → QA pipeline with Bedrock review and orchestrator-managed GitHub ops.

## Execution

**In Claude Code sessions:** Use Agent tool calls directly (see SKILL.md Step 3).

**In standalone terminal:** Run the dev-team script:

```bash
bun ~/.claude/scripts/dev-team.ts --preset bug-fix --issue "<description>" --cwd "<project-path>" --verbose
bun ~/.claude/scripts/dev-team.ts --preset bug-fix --github "owner/repo#123" --verbose
bun ~/.claude/scripts/dev-team.ts --preset bug-fix --no-review --issue "<description>"
```

## Phase Details

### Phase 0: Target Resolution

Before any agent work:
1. Resolve the target repo path (must be a git repo with the affected code)
2. If cwd ≠ target, warn user and get direction (switch / patch-only / abort)
3. Detect CI availability: `ls <target>/.github/workflows/ 2>/dev/null`
4. Load resource context from `Context/` if available

### Phase 1: PM Scoping

PM agent receives the bug description and must produce:
- Reproduction steps (if determinable from code/issue)
- Root cause hypothesis
- Acceptance criteria (checkable conditions that prove the fix works)
- Scope boundary (what NOT to change)

PM prompt must include:
- Target directory path
- Available resources (wiki, MCP, etc.)
- CI availability status

### Phase 2: Dev Implementation

Dev agent receives PM's criteria and:
- Works in the target project directory (explicit path in prompt)
- Creates a feature branch from the correct base branch
- Implements the minimum fix
- Commits locally — does NOT push or create PRs
- Reports: branch name, commit hash, files changed, summary of fix

Dev prompt must include:
- `"Working directory: <path>. All file operations happen here."`
- `"Create a feature branch. Commit locally. Do NOT push or create PRs."`
- Resource context (wiki, MCP tools for verification)
- Base branch to branch from (may not be `main` — check repo default)

### Phase 3: QA Verification

QA agent receives the committed code and PM's criteria.

**If CI exists:**
- Run test suite, verify each acceptance criterion
- Check for regressions
- Report pass/fail with evidence

**If NO CI exists:**
- Perform grep audits (all instances of pattern handled?)
- Static analysis (buffer sizes, type consistency, missing guards)
- Logic review against each acceptance criterion
- Use MCP tools for live verification if available
- Report clearly what was checked and how

QA prompt must include:
- `"This repo has no automated CI."` (if true)
- `"Verify using: grep audits, static analysis, MCP tools. Do NOT claim tests pass if no tests exist."`

### Retry Loop

If QA fails (max 2 retries):
1. QA's failure report sent to Dev
2. Dev addresses specific failures only (same branch)
3. QA re-verifies
4. After 2 failures: escalate to user with full context

### Phase 4: Review

If review enabled and available:
- Bedrock: `deliberate.ts --mode doc-review --doc <diff-file>`
- Claude-only: 3 adversarial agents (security, correctness, pragmatist)
- Review findings feed back — if must-fix items found, loop Dev once more before push

### Phase 5: Push & PR (Orchestrator Only)

**Agents do not push.** The orchestrator:
1. Collects Dev's commit (branch, hash, summary)
2. Confirms review passed (or must-fix items resolved)
3. Presents to user: "Ready to push branch X and create PR against Y. Approve?"
4. After user approval, pushes branch and creates PR
5. Updates the source issue with PR link (if issue was provided)
