# ReviewDecisions Workflow

## Purpose
Review decisions made in a time period. Useful for retrospectives and status updates.

## Trigger
"Decisions this week" / "decisions this month" / "review decisions [period]"

## Step 1 — Load and Filter
Read `~/.claude/MEMORY/WORK/decisions/DECISIONS.md`.
Filter by date range extracted from prompt (this week = last 7 days, this month = last 30 days).

## Step 2 — Output Summary

```
DECISIONS — [Period]
[N] decisions logged

| Date | Decision | Area | Owner |
|------|----------|------|-------|
| [date] | [title] | [area] | [owner] |
```

## Step 3 — Pattern Flag (weekly mode)
If "weekly" in trigger: surface any decisions that may conflict with each other,
or decisions without a stated revisit trigger.

## Step 4 — Offer
Ask: "Want to add any decisions from this period that aren't logged yet?"
