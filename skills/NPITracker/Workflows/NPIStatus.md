# NPIStatus Workflow

## Purpose
Generate a full NPI status table across all active Pinnacle releases.

## Trigger
"NPI status" / "Pinnacle status" / "where are we on NPI"

## Step 1 — Load Context
Read `~/.claude/PAI/USER/TELOS/PROJECTS.md` for current project state.
Read `~/.claude/PAI/USER/DEFINITIONS.md` for Pinnacle product definitions.
Scan `MEMORY/WORK/` for any Pinnacle-related PRDs.
Ask Deven if current state isn't captured: "What's the current status on each Pinnacle release?"

## Step 2 — Build Status Table

```
NPI STATUS — Pinnacle Line — [Date]

| Release | Ethernet | Phase | BOM | QSG | RTM | RTW | Key Risk |
|---------|----------|-------|-----|-----|-----|-----|----------|
| Pinnacle 2.0 | 1G | [phase] | ✅/⚠️/❌ | ✅/⚠️/❌ | ✅/⚠️/❌ | ✅/⚠️/❌ | [risk] |
| Pinnacle 2.1 | 2.5G | [phase] | ✅/⚠️/❌ | ✅/⚠️/❌ | ✅/⚠️/❌ | ✅/⚠️/❌ | [risk] |
| Pinnacle 2.2 | 10G | [phase] | ✅/⚠️/❌ | ✅/⚠️/❌ | ✅/⚠️/❌ | ✅/⚠️/❌ | [risk] |
| Pinnacle 3.0 | TBD | Spec | — | — | — | — | [risk] |
```

Legend: ✅ Done | ⚠️ At Risk | ❌ Blocked | — Not applicable yet

## Step 3 — Narrative Summary
One paragraph per release with current phase, momentum, and top risk.

## Step 4 — Output Format
Plain text table + narrative. Ready to paste into Teams or status email.
