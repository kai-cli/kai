---
name: Curate
description: Review and promote pending memory drafts, check staleness, run weekly memory curation. USE WHEN curate, curate memory, review drafts, promote insights, stale memories, memory curation, pai curate.
---

# Curate

Review pending memory drafts and take action (approve, reject, archive stale).

## Invocation

When `/curate` is invoked:

### Step 1: Show Pending Drafts

Run: `bun PAI/Tools/MemoryCurate.ts drafts`

This lists all pending drafts in MEMORY/STAGING/ with previews.

### Step 2: Present Actions via AskUserQuestion

For each draft, present:
- **Title** and preview (first 100 chars of content)
- **Confidence** score and target file
- **Age** (days since created)

Ask the user which action to take for each:
- **Approve** — promotes to permanent memory (target path in draft metadata)
- **Reject** — archives the draft (won't be shown again)
- **Skip** — leave for next time

### Step 3: Execute Actions

For approved drafts: `bun PAI/Tools/MemoryCurate.ts approve <n>`
For rejected drafts: `bun PAI/Tools/MemoryCurate.ts reject <n>`

### Step 4: Quick Health Check

After processing drafts, report:
- Number of stale memories (type: project, >30 days unchanged)
- Knowledge domain health (run `bun PAI/Tools/MemoryCurate.ts domains`)
- Suggest archiving stale project memories that are clearly obsolete

## Notes

- Drafts are generated automatically by ReflectionHarvester and LearningPatternSynthesis
- Approved drafts become permanent feedback/wisdom that loads at session start
- The status line shows pending draft count — this skill clears that indicator
- Weekly cron also nudges about pending curations in its output log
