# Quick Workflow

Fast single-round multi-model check. Use for sanity checks and quick feedback.

## Execution

1. Determine the question from the user's request
2. Run single-round deliberation:

```bash
bun ~/.claude/scripts/deliberate.ts --rounds 1 --verbose "<question>"
```

3. Present using the Quick format from `OutputFormat.md`
