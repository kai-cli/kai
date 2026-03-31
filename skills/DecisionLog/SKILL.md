---
name: DecisionLog
description: Product and engineering decision logging for Engineering Manager. Captures key decisions with context, options considered, rationale, and owner. Searchable log that feeds retrospectives and prevents "why did we do this?" moments. USE WHEN log decision, decision log, record decision, document decision, why did we decide, what did we decide, capture decision, decisions on Pinnacle, architecture decision, product decision.
---

## MANDATORY TRIGGER

| User Says | Action |
|-----------|--------|
| "log decision" / "record decision" / "document decision" | → LogDecision workflow |
| "why did we decide" / "what did we decide" | → SearchDecisions workflow |
| "decisions on [topic/product]" | → SearchDecisions workflow |
| "decisions this week/month" | → ReviewDecisions workflow |

## Customization

Check `~/.claude/PAI/USER/SKILLCUSTOMIZATIONS/DecisionLog/` for overrides before executing.

