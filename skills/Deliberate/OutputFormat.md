# Output Format

Standard formats for deliberation reports.

## Full Deliberation Report

The script outputs a markdown report. When presenting to the user, use this structure:

```markdown
## Deliberation: [Question]

**Models:** [list]  |  **Rounds:** [n]  |  **Duration:** [Xs]

### Round 1: Initial Positions

**Claude (Architect):**
[Position from systems/architecture perspective]

**Gemini (Researcher):**
[Position grounded in evidence and precedent]

**Grok (Contrarian):**
[Position challenging assumptions]

**GPT (Pragmatist):**
[Position focused on practical implementation]

### Round 2: Responses & Revisions

**Claude (Architect):**
[Responds to specific points, revises position]

[...]

### Synthesis

**Recommendation:** [Path forward with confidence level]
**Convergence:** [Where models agreed]
**Key Tensions:** [Unresolved disagreements]
**Dissenting Views:** [Merit-worthy minority positions]
**Blind Spots:** [What the panel may have missed]
**Next Steps:** [Concrete actions]
```

## Quick Deliberation Format

```markdown
## Quick Deliberation: [Question]

**Models:** [list]  |  **Duration:** [Xs]

### Model Positions

**Claude:** [50-100 word take]
**Gemini:** [50-100 word take]
**Grok:** [50-100 word take]
**GPT:** [50-100 word take]

### Quick Synthesis
**Consensus:** [Do they agree?]
**Key Tension:** [Main disagreement]
**Recommendation:** [Proceed / Reconsider / Need full deliberation]
```

## Output Length Guidelines

| Workflow | Per model per round | Synthesis |
|----------|-------------------|-----------|
| Full | 150-300 words | 200-400 words |
| Quick | 50-100 words | 50-100 words |

## Report Files

When `--output` is used, the full markdown report is saved to the specified path. This is useful for:
- Attaching to PRDs as decision evidence
- Sharing with team members
- Feeding into Ralph Loop as ISC context
