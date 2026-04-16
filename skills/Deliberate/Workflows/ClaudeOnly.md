# Claude-Only Workflow

Multi-round deliberation using only Claude. No external API keys needed.
Uses PAI Inference subscription auth.

## When to Use

- No external API keys available
- Want to test the deliberation format before adding models
- Claude-specific question where other models add noise

## Execution

1. Determine the question from the user's request
2. Run Claude-only deliberation:

```bash
bun ~/.claude/scripts/deliberate.ts --rounds 2 --models claude --verbose "<question>"
```

3. Present using the Full format from `OutputFormat.md`

## Note

With only one model, this is structurally similar to Council but uses the deliberation prompt format (position → revision → synthesis) rather than Council's persona-based debate. For genuine multi-perspective single-model debate, use Council instead.
