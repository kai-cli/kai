# PrepOneOnOne Workflow

## Purpose
Prepare Deven for an upcoming 1:1 with a direct report.
Surfaces themes, open action items, and suggested talking points.

## Trigger
"Prep for 1:1 with [name]" or "what should I cover with [name]"

## Step 1 — Load History
Read all files in `~/.claude/MEMORY/WORK/1on1/[name]/` — most recent 4 sessions.
Extract: recurring themes, open action items (unchecked `- [ ]`), last stated concerns.

## Step 2 — Check Active Work
Read TELOS/PROJECTS.md for any work the person is tied to.
Check if they have any open items in MEMORY/WORK PRDs.

## Step 3 — Generate Prep Sheet

```
1:1 PREP — [Name] ([Role]) — [Date]

━━━ OPEN ACTION ITEMS (from past notes)
• [Item] — from [date]

━━━ RECURRING THEMES
• [Theme] — seen [N] times

━━━ SUGGESTED TALKING POINTS
• [Point based on themes + active work]

━━━ OPEN QUESTIONS
• [Things to ask or check in on]
```

## Step 4 — Calibrate
Ask: "Anything specific you want to cover that's not here?"
