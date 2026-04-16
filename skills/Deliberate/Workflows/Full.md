# Full Workflow

Full multi-model deliberation with 2-3 rounds and synthesis report.

## Execution

1. Determine the question from the user's request
2. Check model availability: `bun ~/.claude/scripts/deliberate.ts --list-models`
3. Run deliberation:

```bash
bun ~/.claude/scripts/deliberate.ts --rounds 2 --verbose "<question>"
```

4. If the user specified particular models: `--models claude,gemini`
5. If the user wants a saved report: `--output <path>`
6. Present the output using the format from `OutputFormat.md`

## Options

- For high-stakes decisions, use `--rounds 3`
- Default is `--rounds 2` (good balance of depth vs cost)
- Always use `--verbose` so the user sees per-model timing
