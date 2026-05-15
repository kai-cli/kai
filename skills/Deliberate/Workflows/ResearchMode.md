# Research Mode Workflow

## Overview

Scatter-Gather-Synthesize: multiple models answer a research question in parallel with web grounding enabled, then Claude synthesizes with cross-source verification.

## How It Differs From Debate

| Aspect | Debate | Research |
|--------|--------|----------|
| Rounds | 2-3 (with revision) | 1 (single scatter) |
| Goal | Find best position via adversarial challenge | Find factual answer via multi-source agreement |
| Grounding | No web search | Web search enabled (Gemini, Grok) |
| Synthesis | Convergence analysis | Cross-check verification + citations |

## Execution

```bash
bun ~/.claude/scripts/deliberate.ts --mode research "Your research question"
```

### Scatter Phase
All models answer in parallel. Models with web grounding (Gemini, Grok) perform live web searches. Others contribute from training knowledge.

### Gather Phase
Responses are collected. Citations from web-grounded models are extracted.

### Synthesize Phase
Claude Opus produces a final synthesis applying these rules:
- Claims in ≥2 sources → HIGH confidence
- Single-source claims → flagged with attribution
- Contradictions → noted explicitly
- Web citations → included where available

## Output Structure

```markdown
## Synthesis

**Answer** — Direct answer
**Key Facts** — Verified claims (2+ sources)
**Additional Context** — Single-source claims
**Sources** — URLs from grounded models
```

## Web Grounding Support

| Model | Grounding Method | Citation Format |
|-------|-----------------|----------------|
| Gemini | `tools: [{ google_search: {} }]` | `groundingMetadata.groundingChunks[].web.uri` |
| Grok | `search_parameters: { mode: "auto" }` | `citations[]` in response |
| Claude | None (training knowledge) | N/A |
| GPT | Deferred (needs Responses API) | N/A |

## When to Use

- Factual questions about current state of technology
- "What's the latest on X?"
- Verifying claims across multiple sources
- Time-sensitive information where training cutoffs matter
- Any question where web search adds value over pure reasoning
