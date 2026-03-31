# CaptureNotes Workflow

## Purpose
Structure and save notes from a 1:1 meeting with a direct report.

## Trigger
"Note from meeting with [name]" or "capture my 1:1 with [name]"

## Storage Location
`~/.claude/MEMORY/WORK/1on1/[name]/YYYY-MM-DD.md`

## Step 1 — Identify Person
Extract name from prompt. Match to CONTACTS.md for role context.
If name not found in CONTACTS.md, ask for role before proceeding.

## Step 2 — Collect Notes
Ask: "What came up in this 1:1? Paste notes, transcript, or just tell me."
Accept: raw bullets, prose, Granola transcript dump, or spoken summary.

## Step 3 — Structure Output

```markdown
# 1:1 — [Name] — [Date]

## Current State
[What they're working on, how it's going]

## Wins
[Things going well, progress made]

## Concerns / Blockers
[What they raised as problems, frustrations, or asks]

## Growth / Development
[Anything related to their growth, skills, career]

## Action Items
- [ ] [Owner]: [Action]
- [ ] [Owner]: [Action]

## Themes (for pattern tracking)
[1-3 word tags: communication, scope-creep, recognition, burnout, career-growth, etc.]
```

## Step 4 — Save and Confirm
Write to `MEMORY/WORK/1on1/[name]/YYYY-MM-DD.md`.
Confirm: "Saved. Want me to surface any patterns from past notes with [name]?"
