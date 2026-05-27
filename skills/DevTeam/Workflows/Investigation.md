# Investigation Workflow

Deep-dive debugging with parallel researchers coordinated by a lead.

## Execution

```bash
bun ~/.claude/scripts/dev-team.ts --preset investigation --issue "<description>" --cwd "<project-path>" --verbose
```

## Phase Details

### Phase 1: Lead Scoping

Lead (Architect, opus) receives the issue and:
- Formulates hypotheses about root cause
- Assigns specific investigation tasks to researchers
- Defines what evidence would confirm/refute each hypothesis

### Phase 2: Parallel Research

Two researchers work simultaneously:
- **researcher-1**: Codebase search, execution path tracing, suspect code identification
- **researcher-2**: Log analysis, reproduction, evidence gathering

Both report findings back to lead.

### Phase 3: Synthesis

Lead synthesizes researcher findings into:
- Confirmed root cause (with evidence)
- Affected scope (what else might be impacted)
- Recommended fix approach
- Risk assessment

### No Review Phase

Investigation preset has `review.enabled: false` — the output is a report, not code changes. User decides next steps (may spawn a bug-fix team).

## Output

The investigation produces a structured report, not a code fix. The user can then:
- Spawn a bug-fix team with the findings as context
- Fix it manually with clear understanding
- Decide it's not worth fixing
