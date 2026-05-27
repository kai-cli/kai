# DocReview Workflow

Two-phase architecture/design document review: Claude extracts review criteria, then the multi-model panel evaluates independently.

## Execution

1. Determine the document path from the user's request
2. Run the doc-review mode:

```bash
bun ~/.claude/scripts/deliberate.ts --mode doc-review --doc "<path>" --verbose
```

3. If the user wants specific focus areas, append them as the positional argument:

```bash
bun ~/.claude/scripts/deliberate.ts --mode doc-review --doc "./design.md" --verbose "Focus on scalability and failure modes"
```

4. If the user wants a saved report: add `--output review-report.md`
5. Present the output using the format from `OutputFormat.md`

## Pipeline

```
┌─────────────────────────────────────────────────────┐
│ Phase 1: Claude Extraction (smart)                  │
│ - Architectural patterns & decisions                │
│ - Risks & failure modes                             │
│ - Missing considerations                            │
│ - Dependency analysis                               │
│ - Review questions for the panel                    │
└───────────────────────┬─────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│ Phase 2: Multi-Model Panel Review (parallel)        │
│ Each model receives: original doc + extracted       │
│ criteria + specific review questions                │
│ Each reviews independently from their persona       │
└───────────────────────┬─────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│ Phase 3: Synthesis (Claude smart)                   │
│ Cross-model findings → structured report            │
└─────────────────────────────────────────────────────┘
```

## Options

- Default panel: all available Bedrock models + Claude
- Use `--models` to restrict (e.g., `--models claude,deepseek,mistral`)
- Document can be markdown, plain text, or any file readable as UTF-8

## Examples

```
"Review this architecture doc: ./docs/mesh-topology.md"
-> DocReview workflow

"Have the panel review my design doc, focus on security"
-> DocReview with focus positional

"Deliberate doc review on ./RFC-001.md with deepseek and mistral"
-> DocReview with --models deepseek,mistral
```
