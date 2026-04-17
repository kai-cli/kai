---
name: NPITracker
description: NPI (New Product Introduction) risk tracker and status generator for Your Company Pinnacle product line. Reads active project state and generates risk matrices, gate checklists, and status tables for Pinnacle 2.0/2.1/2.2/3.0. USE WHEN NPI, NPI status, NPI risk, Pinnacle status, Pinnacle risk, release risk, RTM risk, RTW risk, BOM status, manufacturing risk, shipping risk, NPI checklist, release gates.
---

## MANDATORY TRIGGER

| User Says | Action |
|-----------|--------|
| "NPI status" / "NPI risk" | → NPIStatus workflow |
| "Pinnacle status" / "Pinnacle risk" | → NPIStatus workflow |
| "release risk" / "RTM risk" / "RTW risk" | → ReleaseRisk workflow |
| "NPI checklist" / "release gates" | → GateChecklist workflow |

## Customization

Check `~/.claude/PAI/USER/SKILLCUSTOMIZATIONS/NPITracker/` for overrides before executing.

