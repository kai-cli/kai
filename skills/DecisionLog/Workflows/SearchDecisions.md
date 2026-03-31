# SearchDecisions Workflow

## Purpose
Find a past decision by topic, product, date, or keyword.

## Trigger
"Why did we decide [X]" / "what did we decide about [topic]" / "decisions on [product/area]"

## Step 1 — Load Log
Read `~/.claude/MEMORY/WORK/decisions/DECISIONS.md`.

## Step 2 — Search
Match query against: decision titles, product/area tags, decision text, rationale.
Return all matching entries, most recent first.

## Step 3 — Output
Show matching decisions in condensed format:

```
DECISION SEARCH — "[query]"

[Date] — [Title]
Decision: [one sentence]
Rationale: [one sentence]
Owner: [name]
[Link to full entry if multiple results]
```

If no match: "No decisions found matching '[query]'. Want to log one now?"
