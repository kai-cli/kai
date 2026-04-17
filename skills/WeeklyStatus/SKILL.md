---
name: WeeklyStatus
description: Weekly status report generator for Engineering Manager + PLM Director. Pulls from active PRDs, TELOS PROJECTS.md, and CONTACTS.md to draft a {PRINCIPAL.ORG} leadership status update. USE WHEN weekly status, status update, weekly report, status draft, what did we do this week, update for leadership, weekly update, write status.
---

## MANDATORY TRIGGER

| User Says | Action |
|-----------|--------|
| "weekly status" / "/weekly-status" | → WeeklyStatus workflow |
| "status update" / "write status" | → WeeklyStatus workflow |
| "update for leadership" / "what did we do this week" | → WeeklyStatus workflow |

## Customization

Check `~/.claude/PAI/USER/SKILLCUSTOMIZATIONS/WeeklyStatus/` for overrides before executing.

