# ShippingWindow Workflow

## Purpose
Calculate the RTM → RTW window based on shipping method from CBT (Taiwan).

## Trigger
"Shipping window for [release]" / "when is RTW if RTM is [date]"

## Context
CBT (Cybertan) is in Taiwan. Your Company products ship either:
- **Air freight:** ~5-10 days Taiwan → US distribution
- **Ocean freight:** ~20-35 days Taiwan → US distribution

RTW timing = RTM date + manufacturing lead time + shipping window.

## Step 1 — Inputs
Ask for:
- RTM target date (or actual date if cut)
- Manufacturing lead time at CBT (ask if unknown — typically 2-4 weeks)
- Shipping method: Air or Ocean

## Step 2 — Calculate

```
RTM DATE: [date]
+ CBT manufacturing lead time: [N weeks] → [date]
+ Shipping ([Air/Ocean]): [N days] → Arrival [date]
+ Receiving + QA buffer: ~5 days → [date]
= EARLIEST RTW DATE: [date]
```

## Step 3 — Output
Single clear table with dates and a plain-language summary.
Flag if the window creates a holiday/quarter-end conflict.
