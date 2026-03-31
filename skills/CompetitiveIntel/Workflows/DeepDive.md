# DeepDive Workflow

**Trigger:** "deep dive on [competitor]", "analyze [product]", "what is [competitor] doing"

## Purpose

Focused analysis on a single competitor or product category. Produces a detailed competitive profile rather than a broad scan.

## Process

### 1. Identify Target

Parse the user's request to determine:
- **Competitor:** Netgear, TP-Link, Asus, Eero, etc.
- **Product line:** Specific (Orbi, Deco) or all wireless products
- **Time frame:** Recent (default 90 days) or specified

### 2. Research

Fetch from all sources with competitor-specific queries:

**WebFetch prompt:**
> "Find all information about [Competitor] wireless/WiFi/router/mesh products from the last 90 days. Include: product announcements, reviews, pricing, firmware updates, market positioning, leadership statements, partnerships, certifications."

Also check:
- Competitor's own website for current product lineup and pricing
- Amazon for current pricing, ratings, and bestseller rank
- FCC database for upcoming filings (if applicable)

### 3. Generate Profile

```markdown
# Competitive Deep Dive: [Competitor]
**Date:** [timestamp]
**Product Line:** [specific line or "Full wireless portfolio"]
**Period:** Last [X] days

---

## Current Product Lineup
| Product | Segment | MSRP | Wi-Fi Gen | Key Feature | Amazon Rating |
|---------|---------|------|-----------|-------------|---------------|
| [product] | [consumer/SMB] | [$XXX] | [6E/7] | [differentiator] | [X.X/5] |

---

## Recent Moves (Last 90 Days)
1. **[Date: Event]** - [What happened, 2-3 sentences with context]
...

---

## Strengths
- [Strength 1 with evidence]
- [Strength 2 with evidence]

## Weaknesses
- [Weakness 1 with evidence]
- [Weakness 2 with evidence]

---

## vs. Your Company Pinnacle
| Dimension | [Competitor] | Your Company Pinnacle | Advantage |
|-----------|-------------|-----------------|-----------|
| Price (comparable SKU) | [$XXX] | [$XXX] | [who] |
| Wi-Fi Performance | [assessment] | [assessment] | [who] |
| Mesh Capability | [assessment] | [assessment] | [who] |
| Smart Home Integration | [assessment] | [assessment] | [who] |
| Device Management | [TR-069/369 status] | [status] | [who] |
| Security Features | [assessment] | [assessment] | [who] |
| App Experience | [assessment] | [assessment] | [who] |

---

## Implications for Pinnacle
1. **[Insight]** — [What to do about it]
2. **[Insight]** — [What to do about it]
3. **[Insight]** — [What to do about it]

---

**Bottom Line:** [1 sentence — the single most important competitive takeaway]
```
