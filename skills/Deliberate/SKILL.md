---
name: Deliberate
description: Multi-model deliberation and research. USE WHEN deliberate, multi-model, cross-model, real models debate, genuine AI diversity, different LLMs weigh in, research, web search, multi-source research, grounded research.
implements: Science
science_cycle_time: meso
---

## Customization

**Before executing, check for user customizations at:**
`~/.claude/skills/PAI/USER/SKILLCUSTOMIZATIONS/Deliberate/`

If this directory exists, load and apply any PREFERENCES.md, configurations, or resources found there. These override default behavior. If the directory does not exist, proceed with skill defaults.

**Output text notification**:
```
Running the **WorkflowName** workflow in the **Deliberate** skill to ACTION...
```

# Deliberate Skill

Multi-model deliberation system where **different AI models** (Claude, Gemini, Grok, GPT) debate a question across multiple rounds. Each model brings its own training data, reasoning biases, and blind spots — genuine epistemic diversity, not simulated perspectives.

**Key Differentiator from Council:** Council uses one model simulating multiple personas. Deliberate uses actual different models with fundamentally different reasoning. Use Council for fast internal debate; use Deliberate when you need real model diversity on high-stakes decisions.

## Workflow Routing

Route to the appropriate workflow based on the request.

**When executing a workflow, output this notification directly:**

```
Running the **WorkflowName** workflow in the **Deliberate** skill to ACTION...
```

| Trigger | Workflow |
|---------|----------|
| Full multi-model deliberation (2-3 rounds, all models) | `Workflows/Full.md` |
| Quick multi-model check (1 round, fast) | `Workflows/Quick.md` |
| Claude-only deliberation (no external keys needed) | `Workflows/ClaudeOnly.md` |
| Multi-source web-grounded research | `Workflows/ResearchMode.md` |
| Simulated perspectives from one model | Council skill |

## Quick Reference

| Workflow | Purpose | Rounds | Models | Output |
|----------|---------|--------|--------|--------|
| **FULL** | Deep multi-model debate | 2-3 | All available | Transcript + synthesis report |
| **QUICK** | Fast model spot-check | 1 | All available | Positions only |
| **CLAUDE-ONLY** | No external keys needed | 2 | Claude (Opus) only | Single-model multi-perspective |
| **RESEARCH** | Web-grounded multi-source research | 1 (scatter) | All available | Citations + synthesis |

## Context Files

| File | Content |
|------|---------|
| `ModelPanel.md` | Default model roster, personas, API details |
| `OutputFormat.md` | Report format templates |

## Script

The deliberation engine is at `~/.claude/scripts/deliberate.ts`. All workflows invoke it via Bash.

```bash
# Full deliberation
bun ~/.claude/scripts/deliberate.ts --rounds 2 --verbose "Question here"

# Quick check (1 round)
bun ~/.claude/scripts/deliberate.ts --rounds 1 "Question here"

# Claude only
bun ~/.claude/scripts/deliberate.ts --rounds 2 --models claude "Question here"

# Specific models
bun ~/.claude/scripts/deliberate.ts --models claude,gemini --rounds 3 "Question here"

# Research mode (web-grounded, single scatter round)
bun ~/.claude/scripts/deliberate.ts --mode research "What are the latest Claude Code features?"

# Research with specific models
bun ~/.claude/scripts/deliberate.ts --mode research --models gemini,grok "Current state of X?"

# Save report
bun ~/.claude/scripts/deliberate.ts --output report.md "Question here"
```

## Environment Requirements

| Variable | Provider | Required? |
|----------|----------|-----------|
| *(none)* | Claude (via PAI Inference) | Always available |
| `GEMINI_API_KEY` | Google Gemini | Optional |
| `GROK_API_KEY` | xAI Grok | Optional |
| `OPENAI_API_KEY` | OpenAI GPT | Optional |
| `DEEPSEEK_API_KEY` | DeepSeek | Optional |
| `MISTRAL_API_KEY` | Mistral AI | Optional |

Check availability: `bun ~/.claude/scripts/deliberate.ts --list-models`

## Default Model Panel

| Model | Persona | Perspective |
|-------|---------|-------------|
| Claude (Opus) | Architect | Systems thinking, long-term design, trade-offs |
| Gemini (Pro) | Researcher | Evidence, data, real-world precedent |
| Grok | Contrarian | Challenge assumptions, stress-test positions |
| GPT-4o | Pragmatist | Practical implementation, shipping, user impact |
| DeepSeek (Reasoner) | Reasoner | Step-by-step chain-of-thought, expose reasoning |
| Mistral Large | Strategist | Strategic analysis, multi-dimensional evaluation |

## Examples

```
"Deliberate: Should we use USP or CWMP for new deployments?"
-> Invokes FULL workflow -> 2-round multi-model debate

"Quick deliberation: Is this migration plan reasonable?"
-> Invokes QUICK workflow -> 1-round model positions

"Deliberate with just claude and gemini: Monorepo vs polyrepo?"
-> FULL with --models claude,gemini

"Have the models debate this architecture"
-> Invokes FULL workflow
```

## Integration

**Works well with:**
- **Council** — Use Council first for fast internal debate, then Deliberate for cross-model validation
- **Research** — Gather context before deliberation
- **Ralph Loop** — Deliberation output can feed ISC criteria for autonomous execution

## When to Use Deliberate vs Council

| Scenario | Use |
|----------|-----|
| Quick architectural sanity check | Council |
| High-stakes technical decision | Deliberate |
| Need fast answer (< 30s) | Council |
| Want genuine model diversity | Deliberate |
| Exploring a design space | Council first, then Deliberate |
| Validating a Council conclusion | Deliberate |

---

**Last Updated:** 2026-04-02
