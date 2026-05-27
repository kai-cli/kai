# Feature Workflow

Coordinated PM → Dev(s) → QA pipeline for building new features.

## Execution

```bash
bun ~/.claude/scripts/dev-team.ts --preset feature --issue "<description>" --cwd "<project-path>" --verbose
```

## Phase Details

### Phase 1: PM Scoping

PM agent receives the feature description and must produce:
- Feature requirements (what it does, user-facing behavior)
- Acceptance criteria (checkable conditions)
- Edge cases to test
- Scope boundary (what's out of scope for this iteration)

### Phase 2: Dev Implementation

Two Dev agents work in parallel worktrees:
- **dev-1**: Core feature logic
- **dev-2**: Tests and integration points

Both merge when complete. If worktrees conflict, dev-1 merges first, dev-2 rebases.

### Phase 3: QA Verification

QA verifies:
- All acceptance criteria met
- Edge cases handled
- Tests pass
- No regressions

### Phase 4: Review

Same as BugFix — Bedrock panel or Claude adversarial on the combined diff.
