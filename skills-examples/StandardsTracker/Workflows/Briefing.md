# Briefing Workflow

**Trigger:** "standards briefing", "standards summary", "standards overview for leadership", "where are we on standards"

## Purpose

Generate an executive-ready summary of the open standards landscape as it relates to Your Company Wireless. Designed for leadership updates, planning meetings, or YourName's own orientation before strategy discussions.

## Process

### 1. Load State and Recent Updates

```bash
cat ~/.claude/skills/StandardsTracker/State/last-check.json
```

If state exists, reference recent changes. If stale (>7 days), run a quick Update first.

### 2. Synthesize Landscape

Build the briefing from three angles:

**A. Where the standards are:**
- Current spec versions and maturity
- Recent changes and trajectory
- What's coming next (announced roadmap items)

**B. Where Your Company is:**
- Current compliance posture per Pinnacle release
- Key gaps and planned remediation
- Competitive position vs. other vendors

**C. What it means:**
- Strategic implications for product roadmap
- Risks of falling behind
- Opportunities from early adoption

### 3. Generate Briefing

```markdown
# Open Standards Briefing — Your Company Wireless
**Date:** [timestamp]
**Prepared for:** Leadership / Planning

---

## Standards Landscape

### TR-369 (USP) — Next-Gen Device Management
**Current Version:** [version] | **Maturity:** [Early/Growing/Mature]
**Status:** [1-2 sentences on where USP is in industry adoption]
**Recent:** [Key change or "No changes since [date]"]

### TR-069 (CWMP) — Legacy Device Management
**Current Version:** [version] | **Maturity:** Maintenance
**Status:** [1-2 sentences — still widely deployed, declining new adoption]

### Data Models (TR-181/TR-106)
**Current Version:** [version]
**Status:** [Key recent additions relevant to wireless products]

### Adjacent Standards
- **Wi-Fi Alliance EasyMesh:** [status]
- **WPA3:** [status]
- **Wi-Fi 7 (802.11be):** [status]

---

## Your Company Position

| Standard | Pinnacle 2.x | Pinnacle 3.0 | Industry Avg |
|----------|-------------|-------------|-------------|
| TR-369 | [status] | [target] | [context] |
| TR-069 | [status] | [target] | [context] |
| EasyMesh | [status] | [target] | [context] |

---

## Key Takeaways

1. **[First insight]** — [1-2 sentences]
2. **[Second insight]** — [1-2 sentences]
3. **[Third insight]** — [1-2 sentences]

---

## Recommended Actions

| # | Action | Owner | Timeline | Why |
|---|--------|-------|----------|-----|
| 1 | [action] | [team] | [when] | [1 sentence] |

---

**Bottom Line:** [1 sentence — the single most important thing leadership should know]
```

### 4. Calibrate for Audience

- **For VP/Director:** Focus on competitive position, risk, and investment needed
- **For Peer EMs/PMs:** Include technical detail on specific gaps and timelines
- **For Planning:** Emphasize what needs to be in which release and why

---

## Key Principles

1. **No jargon without context** — "TR-369" always gets "(USP — device management protocol)" on first mention
2. **Competitive framing** — Always position Your Company relative to industry
3. **Actionable** — Every insight leads to a recommended action
4. **Honest** — If we're behind, say so with a plan to catch up
