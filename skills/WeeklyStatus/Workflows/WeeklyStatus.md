# WeeklyStatus Workflow

## Purpose
Draft Deven's weekly status update for Fortinet leadership (Gregor, VP Engineering).
Format: wins, risks, blockers, next week. Concise, no fluff.

## Step 1 — Gather Context

Read these sources in parallel:
1. `~/.claude/PAI/USER/TELOS/PROJECTS.md` — active project state
2. `~/.claude/MEMORY/WORK/` — scan PRD files modified in the last 7 days (`phase`, `progress` fields)
3. `~/.claude/MEMORY/STATE/work.json` — active work registry
4. Ask Deven: "Anything this week not tracked in PAI? (team issues, ad-hoc work, escalations)"

## Step 2 — Classify Items

Sort everything gathered into four buckets:
- **WINS** — shipped, decided, unblocked, completed
- **IN PROGRESS** — active work with clear momentum
- **RISKS** — things that could slip, block, or escalate
- **BLOCKERS** — things stopped waiting on someone/something

## Step 3 — Draft Output

```
WEEKLY STATUS — [Date Range]
Your Name | Engineering Manager & PLM Director

━━━ WINS
• [Bullet per win — specific, past tense, outcome-focused]

━━━ IN PROGRESS
• [Bullet per active workstream — current state + next milestone]

━━━ RISKS
• [Bullet per risk — what it is, likelihood, mitigation if any]

━━━ BLOCKERS
• [Bullet per blocker — what's blocked, who owns the unblock]

━━━ NEXT WEEK
• [Bullet per priority — what Deven is driving next week]
```

## Step 4 — Calibrate

Ask: "Any changes? Anything to add, remove, or reframe before I finalize?"

## Modes

**Brief mode** (user says "quick status"): WINS + NEXT WEEK only, 3 bullets max each.
**Risk mode** (user says "risk-focused"): Expand RISKS section, add impact/likelihood/owner columns.

## Output

Paste-ready for Teams message or email to Gregor. Plain text, no markdown formatting in final output.
