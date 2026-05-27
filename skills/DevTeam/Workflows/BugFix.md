# BugFix Workflow

Coordinated PM → Dev → QA pipeline with optional Bedrock review.

## Execution

1. Run the dev-team script with bug-fix preset:

```bash
bun ~/.claude/scripts/dev-team.ts --preset bug-fix --issue "<description>" --cwd "<project-path>" --verbose
```

2. If user provided a GitHub issue URL:

```bash
bun ~/.claude/scripts/dev-team.ts --preset bug-fix --github "owner/repo#123" --verbose
```

3. To skip review phase:

```bash
bun ~/.claude/scripts/dev-team.ts --preset bug-fix --no-review --issue "<description>"
```

## Phase Details

### Phase 1: PM Scoping

PM agent receives the bug description and must produce:
- Reproduction steps (if determinable from code/issue)
- Root cause hypothesis
- Acceptance criteria (checkable conditions that prove the fix works)
- Scope boundary (what NOT to change)

### Phase 2: Dev Implementation

Dev agent receives PM's criteria and:
- Works in a git worktree (isolated from main)
- Implements the minimum fix
- Runs relevant tests
- Merges worktree when satisfied

### Phase 3: QA Verification

QA agent receives the merged code and PM's criteria:
- Verifies each acceptance criterion
- Runs test suite
- Checks for regressions
- Reports pass/fail with evidence

### Retry Loop

If QA fails (max 2 retries):
1. QA's failure report sent to Dev
2. Dev gets a new worktree, addresses specific failures only
3. QA re-verifies
4. After 2 failures: escalate to user with full context

### Phase 4: Review

If review enabled and available:
- Bedrock: `deliberate.ts --mode doc-review --doc <diff-file>`
- Claude-only: 3 adversarial agents (security, correctness, pragmatist)
