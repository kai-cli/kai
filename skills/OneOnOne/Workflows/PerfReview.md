# PerfReview Workflow

## Purpose
Draft a performance review for a direct report based on 1:1 notes, themes, and observed work.

## Trigger
"Performance review for [name]" or "perf review draft [name]"

## Step 1 — Load Full History
Read ALL files in `~/.claude/MEMORY/WORK/1on1/[name]/`.
Extract: wins, growth areas, themes, action item completion rate, concerns raised.

## Step 2 — Load Work Record
Scan MEMORY/WORK PRDs for contributions by or involving this person.
Check TELOS/PROJECTS.md for their role in active projects.

## Step 3 — Draft Review

```
PERFORMANCE REVIEW DRAFT — [Name] — [Period]

━━━ STRENGTHS
[2-4 paragraphs: specific behaviors, outcomes, impact. Name the work.]

━━━ GROWTH AREAS
[1-2 paragraphs: patterns observed, constructive framing, development suggestions]

━━━ NOTABLE CONTRIBUTIONS
• [Specific project/outcome]
• [Specific project/outcome]

━━━ DEVELOPMENT FOR NEXT PERIOD
• [Goal 1]
• [Goal 2]

━━━ OVERALL ASSESSMENT
[1 paragraph summary — honest, evidence-based]
```

## Step 4 — Calibrate
Ask: "What am I missing? Any context I don't have from notes?"
Revise as needed. Output: plain text ready to paste into HR system or email.
