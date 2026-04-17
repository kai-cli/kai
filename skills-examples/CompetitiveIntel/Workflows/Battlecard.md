# Battlecard Workflow

**Trigger:** "battlecard", "competitive positioning for [Your Product]", "how do we compare", "[Your Product] vs competitors"

## Purpose

Generate a competitive positioning battlecard for a specific [Your Product] release. Designed for internal use — sales enablement, product planning, or leadership presentations.

## Process

### 1. Identify Release

Determine which [Your Product] release to position:
- [Your Product] 2.0 / 2.1 / 2.2 (shipping or releasing)
- [Your Product] 3.0 (speccing)
- Or "general" for the full [Your Product] line

### 2. Load Context

- Read [Your Product] project context from `~/.claude/PAI/USER/PROJECTS/`
- Load latest competitive state from `State/last-check.json`
- If state is stale (>14 days), run a quick Update first

### 3. Identify Comparison Set

Select the 3-4 most relevant competitor products to compare against:

| [Your Product] Segment | Compare Against |
|-----------------|----------------|
| Premium mesh | Netgear Orbi, Asus ZenWiFi, Eero Max |
| Mid-range mesh | TP-Link Deco, Google Nest WiFi |
| Single router | Netgear Nighthawk, Asus RT-series |

### 4. Generate Battlecard

```markdown
# Competitive Battlecard: [Your Product] [Release]
**Date:** [timestamp]
**Positioning:** [One sentence — where [Your Product] sits in market]

---

## Quick Reference

| | [Your Product] [X] | [Comp 1] | [Comp 2] | [Comp 3] |
|---|---|---|---|---|
| **MSRP** | | | | |
| **Wi-Fi Standard** | | | | |
| **Coverage** | | | | |
| **Max Devices** | | | | |
| **Mesh Nodes** | | | | |
| **Security** | | | | |
| **Device Mgmt** | | | | |
| **Open Standards** | | | | |

---

## Why [Your Product] Wins

1. **[Differentiator]** — [1-2 sentences with proof point]
2. **[Differentiator]** — [1-2 sentences with proof point]
3. **[Differentiator]** — [1-2 sentences with proof point]

---

## Where We're Vulnerable

1. **[Gap]** — [Honest assessment + mitigation or roadmap answer]
2. **[Gap]** — [Honest assessment + mitigation or roadmap answer]

---

## Objection Handling

| Objection | Response |
|-----------|----------|
| "[Competitor] is cheaper" | [Response with value framing] |
| "[Competitor] has better reviews" | [Response with context] |
| "[Feature] is missing" | [Response with roadmap or alternative] |
| "Why not just use ISP equipment?" | [Response with differentiation] |

---

## Key Messaging

**Elevator Pitch (30 sec):**
> [2-3 sentences positioning [Your Product]]

**For Technical Buyers:**
> [2-3 sentences emphasizing specs, standards, security]

**For Simplicity Buyers:**
> [2-3 sentences emphasizing ease of use, reliability]

---

**Internal Only — Do Not Distribute**
```

---

## Key Principles

1. **Honest** — Never overstate [Your Product] advantages or dismiss real competitor strengths
2. **Specific** — Use actual specs, prices, and features, not vague claims
3. **Actionable** — Objection handling should give real answers, not deflections
4. **Current** — Flag anything that might be outdated
