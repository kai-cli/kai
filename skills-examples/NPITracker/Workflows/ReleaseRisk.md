# ReleaseRisk Workflow

## Purpose
Generate a risk matrix for a specific Pinnacle release.

## Trigger
"Risk for Pinnacle [2.0/2.1/2.2/3.0]" / "release risk [release]" / "RTM risk [release]"

## Step 1 — Identify Release
Extract release from prompt (2.0, 2.1, 2.2, or 3.0).
Load definition from DEFINITIONS.md.

## Step 2 — Collect Risk Data
Ask: "What are the current risks? Give me anything — I'll structure it."
Also pull from any MEMORY/WORK PRDs related to this release.

## Step 3 — Build Risk Matrix

```
RISK MATRIX — Pinnacle [X.X] — [Date]

| Risk | Category | Likelihood | Impact | Owner | Mitigation |
|------|----------|-----------|--------|-------|------------|
| [risk] | Schedule/Quality/Cost/Supply | High/Med/Low | High/Med/Low | [name] | [action] |
```

Categories: Schedule | Quality | Supply Chain | Firmware | Regulatory | CBT/Manufacturing

## Step 4 — Top 3 Call-Out
Surface the top 3 risks with recommended immediate actions.

## Step 5 — Output
Table + top-3 narrative. Paste-ready for leadership update.
