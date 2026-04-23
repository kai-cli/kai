# NPIStatus Workflow

## Purpose
Generate a full NPI status table across all active [Your Product] releases.

## Trigger
"NPI status" / "[Your Product] status" / "where are we on NPI"

## Step 1 — Load Context
Read `~/.claude/PAI/USER/TELOS/PROJECTS.md` for current project state.
Read `~/.claude/PAI/USER/DEFINITIONS.md` for [Your Product] product definitions.
Scan `MEMORY/WORK/` for any [Your Product]-related PRDs.
Ask {PRINCIPAL.NAME} if current state isn't captured: "What's the current status on each [Your Product] release?"

## Step 2 — Build Status Table

```
NPI STATUS — [Your Product] Line — [Date]

| Release | Ethernet | Phase | BOM | QSG | RTM | RTW | Key Risk |
|---------|----------|-------|-----|-----|-----|-----|----------|
| [Your Product] 2.0 | 1G | [phase] | ✅/⚠️/❌ | ✅/⚠️/❌ | ✅/⚠️/❌ | ✅/⚠️/❌ | [risk] |
| [Your Product] 2.1 | 2.5G | [phase] | ✅/⚠️/❌ | ✅/⚠️/❌ | ✅/⚠️/❌ | ✅/⚠️/❌ | [risk] |
| [Your Product] 2.2 | 10G | [phase] | ✅/⚠️/❌ | ✅/⚠️/❌ | ✅/⚠️/❌ | ✅/⚠️/❌ | [risk] |
| [Your Product] 3.0 | TBD | Spec | — | — | — | — | [risk] |
```

Legend: ✅ Done | ⚠️ At Risk | ❌ Blocked | — Not applicable yet

## Step 3 — Narrative Summary
One paragraph per release with current phase, momentum, and top risk.

## Step 4 — Output Format
Plain text table + narrative. Ready to paste into Teams or status email.
