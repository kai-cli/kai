# GateChecklist Workflow

## Purpose
Generate a [Your Company] NPI gate checklist for a specific [Your Product] release.
Tracks BOM, QSG, RTM, RTW readiness with owner and status.

## Trigger
"NPI checklist [release]" / "gate checklist [release]" / "release gates [release]"

## Step 1 — Identify Release
Extract release. Ask for current status of each gate item if not in PAI context.

## Step 2 — Generate Checklist

```
NPI GATE CHECKLIST — [Your Product] [X.X] — [Date]

━━━ PRE-RTM GATES
- [ ] BOM finalized and procurement aligned — Owner: [name]
- [ ] QSG written, reviewed, and print-ready — Owner: [name]
- [ ] Firmware image (RTM) built and validated — Owner: [name/Daniel]
- [ ] CBT manufacturing briefed and scheduled — Owner: [name]
- [ ] Regulatory approvals complete — Owner: [name]
- [ ] TR-069/TR-369 compliance verified (if applicable) — Owner: [name/Daniel]

━━━ RTM → RTW WINDOW
- [ ] Shipping method confirmed: Air / Ocean — Timeline: [N days]
- [ ] RTW image branched from RTM — Owner: [name]
- [ ] OTA infrastructure ready for RTW push — Owner: [name]
- [ ] Support documentation updated — Owner: [name]
- [ ] QSG translated (if applicable) — Owner: [name]

━━━ RTW GATES
- [ ] RTW firmware image signed and staged — Owner: [name]
- [ ] Beta testing complete — Owner: [QA Lead]
- [ ] Press/marketing assets ready — Owner: [name]
- [ ] Launch date confirmed — Owner: [EM] + [Release Owner]
```

## Step 3 — Flag Gaps
Identify any unchecked items with no owner assigned. Surface as blockers.
