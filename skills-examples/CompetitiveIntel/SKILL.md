---
name: CompetitiveIntel
description: "Competitive intelligence tracker for Your Company Wireless. Monitors competitor product launches, feature announcements, pricing changes, reviews, and market positioning. USE WHEN competitive intel, competitor analysis, what is Netgear doing, TP-Link news, Asus wireless, Eero updates, competitor products, market landscape, competitive positioning, what are competitors shipping."
use_when: "User asks about competitor wireless products, market positioning, competitive landscape, or wants to know what Netgear/TP-Link/Asus/Eero/other wireless vendors are doing."
workflows:
  - Update: "Fetch latest competitor news, product launches, and market signals"
  - DeepDive: "Focused analysis on a specific competitor or product category"
  - Battlecard: "Generate competitive positioning summary for a specific Pinnacle release"
---

## Customization

**Before executing, check for user customizations at:**
`~/.claude/PAI/USER/SKILLCUSTOMIZATIONS/CompetitiveIntel/`

If this directory exists, load and apply any PREFERENCES.md, configurations, or resources found there. These override default behavior. If the directory does not exist, proceed with skill defaults.

## Notification (REQUIRED)

**Send this notification BEFORE doing anything else:**

---

# CompetitiveIntel Skill

**Purpose:** Track competitors in the consumer/SMB wireless market to inform Your Company Pinnacle product decisions. Surface product launches, feature gaps, pricing moves, and positioning shifts.

## Competitor Landscape

### Tier 1 — Direct Competitors (always track)

| Competitor | Focus | Why They Matter |
|-----------|-------|----------------|
| **Netgear** (Orbi, Nighthawk) | Premium mesh, gaming | Closest competitor in premium consumer segment |
| **TP-Link** (Deco, Archer) | Value mesh, broad SKU range | Price pressure from below, massive volume |
| **Asus** (ZenWiFi, ROG Rapture) | Enthusiast, gaming, mesh | Feature-rich, strong community, open firmware |
| **Eero** (Amazon) | Simple mesh, smart home | Ecosystem play, aggressive pricing with Prime |

### Tier 2 — Adjacent Competitors (track major moves)

| Competitor | Focus | Why They Matter |
|-----------|-------|----------------|
| **Google Nest WiFi** | Smart home integration | Ecosystem bundling, simplicity positioning |
| **Ubiquiti** (UniFi) | Prosumer/SMB | Growing consumer crossover, strong brand loyalty |
| **Arris/Surfboard** | ISP-supplied CPE | Channel competition, TR-069/TR-369 adoption |
| **Plume** | Software-defined WiFi | SaaS model, adaptive WiFi, ISP partnerships |

---

## Sources

| Source | URL | What to Check |
|--------|-----|---------------|
| **The Verge** | https://www.theverge.com | Product reviews, announcements |
| **Ars Technica** | https://arstechnica.com | Technical reviews, networking coverage |
| **CNET** | https://www.cnet.com | Product reviews, buyer's guides, pricing |
| **SmallNetBuilder** | https://www.smallnetbuilder.com | Deep technical wireless reviews, benchmarks |
| **Wi-Fi NOW** | https://wifinowglobal.com | Industry news, Wi-Fi technology trends |
| **Light Reading** | https://www.lightreading.com | ISP/operator news, CPE market |
| **Amazon Best Sellers** | https://www.amazon.com/best-sellers-electronics | Pricing signals, ranking shifts |

**Custom sources:** Add to `USER/SKILLCUSTOMIZATIONS/CompetitiveIntel/sources.json`

---

## Output Format

```markdown
# Competitive Intel Update
**Generated:** [timestamp]
**Sources Checked:** [list]
**Period:** Since [last check date]

---

## Product Launches & Announcements
*New products, SKUs, hardware refreshes*

1. **[Competitor: Product]** - [What it is, key specs, 1-2 sentences]. [Source]
...

---

## Feature & Software Updates
*Firmware updates, new features, app changes, ecosystem moves*

1. **[Competitor: Feature]** - [What changed and why it matters]. [Source]
...

---

## Pricing & Positioning
*Price changes, bundle deals, channel moves, market positioning shifts*

1. **[Competitor: Move]** - [What happened, 1-2 sentences]. [Source]
...

---

## Reviews & Reception
*Notable reviews, benchmarks, customer sentiment shifts*

1. **[Product: Verdict]** - [Key takeaway, 1-2 sentences]. [Source]
...

---

## Your Company Implications
| Signal | Competitor | Affects Pinnacle | Action |
|--------|-----------|-----------------|--------|
| [signal] | [who] | [2.x/3.0/roadmap] | [respond/monitor/ignore] |

---

## Summary
| Category | Count | Top Signal |
|----------|-------|-----------|
| Launches | X | [headline] |
| Features | X | [headline] |
| Pricing | X | [headline] |
| Reviews | X | [headline] |

**Total:** X items | **Next check:** Run `/competitive` anytime
```

---

## Categories

### Product Launches & Announcements
- New router/mesh product releases
- Hardware refreshes and new SKUs
- CES/trade show announcements
- FCC filings (early signal of upcoming products)

### Feature & Software Updates
- Firmware updates with new capabilities
- App redesigns or major feature additions
- Smart home integration changes
- Security feature additions
- Wi-Fi 7/EasyMesh/WPA3 adoption

### Pricing & Positioning
- MSRP changes and promotional pricing
- Bundle deals (especially Amazon/Eero)
- Channel strategy shifts (retail vs. ISP)
- Subscription/SaaS model launches
- Market segment repositioning

### Reviews & Reception
- Major publication reviews (Verge, Ars, CNET, SmallNetBuilder)
- Benchmark comparisons
- Customer satisfaction signals
- Return/complaint patterns

---

## Your Company Impact Assessment

For each competitive signal:

| Impact Level | Criteria | Action |
|-------------|----------|--------|
| **RESPOND** | Direct threat to Pinnacle positioning or pricing | Flag for product/leadership discussion |
| **MONITOR** | Trend that could affect future releases | Track, revisit at next planning cycle |
| **IGNORE** | Irrelevant segment or non-threatening | Note for completeness |

---

## Workflows

| Workflow | When to Use |
|----------|-------------|
| Update | "competitive update", "competitor news", "/competitive" — scan all sources |
| DeepDive | "deep dive on Netgear", "analyze TP-Link Deco" — focused single-competitor analysis |
| Battlecard | "battlecard for Pinnacle 2.2", "competitive positioning" — Pinnacle vs. competitors |

---

## State Tracking

**State file:** `State/last-check.json`

---

## Key Principles

1. **So what?** — Every signal assessed for Your Company impact
2. **Signal over noise** — Minor firmware patches aren't interesting; Wi-Fi 7 launches are
3. **Pricing matters** — Track MSRPs and deals; pricing pressure is the #1 competitive threat
4. **Features, not specs** — "Parental controls added" matters more than "new chipset"
5. **Honest assessment** — If a competitor shipped something better, say so
