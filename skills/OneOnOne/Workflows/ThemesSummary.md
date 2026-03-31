# ThemesSummary Workflow

## Purpose
Surface recurring themes and patterns from 1:1 notes with a specific person.

## Trigger
"Themes for [name]" / "patterns for [name]" / "what keeps coming up with [name]"

## Step 1 — Load History
Read all 1:1 notes for the person in `MEMORY/WORK/1on1/[name]/`.

## Step 2 — Extract Themes
Count tag frequency from `## Themes` sections.
Also scan free text for repeated keywords (frustration, blocked, unclear, excited, etc.).

## Step 3 — Output

```
THEMES — [Name] — Last [N] sessions

━━━ RECURRING (3+ times)
• [Theme]: [count] times — [brief pattern description]

━━━ EMERGING (2 times)
• [Theme]: [count] times

━━━ NOTABLE ONE-OFFS
• [Theme]: [context]

━━━ OPEN ACTION ITEMS (never resolved)
• [Item from date still unchecked]
```
