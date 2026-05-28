# Investigation Workflow

Deep-dive debugging with parallel researchers coordinated by a lead.

## Execution

**In Claude Code sessions:** Use Agent tool calls directly (see SKILL.md Step 3).

**In standalone terminal:**
```bash
bun ~/.claude/scripts/dev-team.ts --preset investigation --issue "<description>" --cwd "<project-path>" --verbose
```

## Phase Details

### Phase 0: Context Gathering

Before spawning agents:
1. Resolve target repo path (investigation can run from any cwd — read-only)
2. Load resource context: wiki pages, MCP tools, git history
3. If GitHub issue URL provided, fetch issue details for agent prompts

### Phase 1: Lead Scoping

Lead (general-purpose, opus) receives the issue and:
- Formulates hypotheses about root cause
- Assigns specific investigation tasks to researchers
- Defines what evidence would confirm/refute each hypothesis

Lead prompt must include:
- Target directory path
- Available resources (wiki, MCP, git repo structure)
- Full issue context (title, body, labels if available)

### Phase 2: Parallel Research

Two researchers work simultaneously:
- **researcher-1**: Codebase search, execution path tracing, suspect code identification
- **researcher-2**: Log analysis, reproduction, evidence gathering, wiki/docs lookup

Both report findings back to lead.

Researcher prompts must include:
- Resource context (wiki paths, MCP tool availability)
- Instruction to use git history (`git log`, `git blame`) for context
- Target directory path for file reads

### Phase 3: Synthesis

Lead synthesizes researcher findings into:
- Confirmed root cause (with evidence)
- Affected scope (what else might be impacted)
- Recommended fix approach
- Risk assessment
- Specific files and line numbers to change

### Review Phase (Compound Flow Only)

When investigation is part of an `investigate-then-fix` compound flow:
- Run Bedrock review on the findings: `deliberate.ts --mode doc-review --doc <findings-file>`
- Panel validates: Is the root cause correct? Is the proposed fix approach sound?
- Review output feeds into the PM prompt for the bug-fix phase

### No Review Phase (Standalone)

Standalone investigation preset has `review.enabled: false` — the output is a report, not code changes. User decides next steps.

## Output

The investigation produces a structured report:
- Root cause with evidence
- Affected files and line numbers
- Proposed fix approach
- Risk assessment

The user (or compound flow) can then:
- Spawn a bug-fix team with the findings + review as context
- Fix it manually with clear understanding
- Decide it's not worth fixing
