# LogDecision Workflow

## Purpose
Capture a product or engineering decision with full context for future reference.

## Trigger
"Log decision" / "record decision" / "document this decision"

## Storage
All decisions append to: `~/.claude/MEMORY/WORK/decisions/DECISIONS.md`

## Step 1 — Collect Input
Ask (or extract from context):
- What was decided?
- What were the other options considered?
- Why was this option chosen?
- Who made/owns this decision?
- What does this affect? (product, release, team, architecture)

## Step 2 — Format Entry

```markdown
---
## [YYYY-MM-DD] — [Decision Title]

**Product/Area:** [Your Product / Your Service / Frontend / Backend / Team / Process]
**Decision:** [One sentence — what was decided]
**Owner:** [Who made or owns this decision]

**Context:**
[Why this decision came up — what triggered it]

**Options Considered:**
1. [Option A] — [why considered, why not chosen]
2. [Option B] — [why considered, why not chosen]
3. **[Chosen option]** ← selected because [reason]

**Rationale:**
[The core reasoning — what factors drove the choice]

**Implications:**
[What this affects going forward — what it closes off, what it opens up]

**Revisit Trigger:**
[Condition under which this decision should be reconsidered — e.g., "if EasyMesh adoption exceeds 50% market share"]

---
```

## Step 3 — Confirm and Append
Show draft to {PRINCIPAL.NAME}. On approval, append to DECISIONS.md.
Confirm: "Logged. Decision #[N] in the log."
