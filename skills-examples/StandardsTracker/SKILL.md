---
name: StandardsTracker
description: "TR-369/USP and TR-069/CWMP open standards tracker for [Your Company]. Monitors spec updates, data model changes, compliance gaps, and industry adoption. USE WHEN TR-369, TR-069, USP, CWMP, standards update, standards tracker, Broadband Forum, data model, BBF, open standards status, device management standards, what changed in TR-369, compliance check."
use_when: "User asks about TR-369, TR-069, USP, CWMP, Broadband Forum specs, open standards compliance, device management protocol updates, data model changes, or wants a standards status briefing for [Your Company]/[Your Product] products."
workflows:
  - Update: "Fetch latest from all sources, compare to last check, report changes"
  - ComplianceCheck: "Assess [Your Product] product line compliance against current specs"
  - Briefing: "Executive summary of standards landscape for leadership or planning"
---

## Customization

**Before executing, check for user customizations at:**
`~/.claude/PAI/USER/SKILLCUSTOMIZATIONS/StandardsTracker/`

If this directory exists, load and apply any PREFERENCES.md, configurations, or resources found there. These override default behavior. If the directory does not exist, proceed with skill defaults.

# StandardsTracker Skill

**Purpose:** Track TR-369 (USP), TR-069 (CWMP), and related Broadband Forum standards that affect [Your Company] product development. Surface spec changes, data model updates, industry adoption signals, and compliance gaps.

## Standards Scope

| Standard | Full Name | Relevance |
|----------|-----------|-----------|
| **TR-369** | User Services Platform (USP) | Primary — next-gen device management, active adoption |
| **TR-069** | CPE WAN Management Protocol (CWMP) | Legacy — still deployed, maintenance mode |
| **TR-181** | Device Data Model | Critical — defines the data objects both protocols use |
| **TR-106** | Data Model Template | Foundation — how data models are structured |
| **TR-157** | Component Objects for CWMP | Supporting — reusable object definitions |
| **TR-471** | IP Performance Metrics | Adjacent — speed test and QoE measurement |
| **Wi-Fi Alliance** | EasyMesh, WPA3, Wi-Fi 7 | Adjacent — wireless standards that interact with device management |

---

## Sources

| Source | URL | What to Check |
|--------|-----|---------------|
| **Broadband Forum** | https://www.broadband-forum.org | Spec releases, corrigenda, new TRs |
| **USP Specification** | https://usp.technology | USP spec text, protocol updates |
| **USP Data Models** | https://usp-data-models.broadband-forum.org | Data model object additions/changes |
| **CWMP Data Models** | https://cwmp-data-models.broadband-forum.org | Legacy data model maintenance |
| **BBF GitHub** | https://github.com/BroadbandForum | Reference implementations, tools, OB-USP-Agent |
| **prpl Foundation** | https://prplfoundation.org | Open-source CPE software, USP adoption |
| **Wi-Fi Alliance** | https://www.wi-fi.org | EasyMesh specs, certification programs |

**Custom sources:** Add to `USER/SKILLCUSTOMIZATIONS/StandardsTracker/sources.json`

---

## Output Format

```markdown
# Standards Tracker Update
**Generated:** [timestamp]
**Sources Checked:** [list]
**Period:** Since [last check date]

---

## Spec Updates
*New releases, corrigenda, amendments to tracked standards*

1. **[TR-XXX vX.X]** - [What changed, 1-2 sentences]. [Source]
...

---

## Data Model Changes
*New objects, parameter additions/deprecations in TR-181/TR-106*

1. **[Object/Parameter]** - [What changed and why it matters for implementation]. [Source]
...

---

## Industry Adoption
*Vendor implementations, certification programs, deployment news*

1. **[Headline]** - [1-2 sentence summary]. [Source]
...

---

## [Your Company] Impact Assessment
| Change | Affects | [Your Product] Release | Action |
|--------|---------|-----------------|--------|
| [change] | [subsystem] | [2.x/3.0] | [implement/track/ignore] |

---

## Summary
| Category | Count | Top Item |
|----------|-------|----------|
| Spec Updates | X | [title] |
| Data Model | X | [title] |
| Adoption | X | [title] |

**Total:** X items | **Next check:** Run `/standards` anytime
```

---

## Categories

### Spec Updates
- New TR document releases (TR-369 amendments, new TRs)
- Corrigenda and errata
- Protocol version changes (USP 1.x → 1.y)
- Security advisories related to protocol implementations

### Data Model Changes
- New Device.* objects added to TR-181
- Parameter additions, deprecations, or type changes
- Profile additions (Device:2.x profiles)
- Mapping changes between USP and CWMP models

### Industry Adoption
- Vendor announcements of USP support
- ISP/operator deployment news
- Certification program updates
- Open-source implementation releases (OB-USP-Agent, prpl)
- Test tool releases and interop event results

---

## [Your Company] Impact Assessment Rules

For each change found, assess impact on [Your Product]:

| Impact Level | Criteria | Action |
|-------------|----------|--------|
| **HIGH** | Breaks existing implementation or blocks certification | Immediate — flag for current release |
| **MEDIUM** | New required object/feature in upcoming profile | Plan — scope for next release |
| **LOW** | Optional feature or future profile | Track — add to 3.0 backlog |
| **NONE** | Irrelevant to [Your Company] product line | Ignore — note for completeness |

---

## Workflows

| Workflow | When to Use |
|----------|-------------|
| Update | "standards update", "TR-369 updates", "what's new in USP", "/standards" — fetch and report changes |
| ComplianceCheck | "compliance check", "are we compliant", "TR-369 compliance" — assess [Your Product] against current specs |
| Briefing | "standards briefing", "standards summary for leadership" — executive-ready overview |

---

## State Tracking

**State file:** `State/last-check.json`

```json
{
  "last_check_timestamp": null,
  "sources": {
    "broadband-forum": { "last_checked": null, "last_hash": null },
    "usp-technology": { "last_checked": null, "last_hash": null },
    "usp-data-models": { "last_checked": null, "last_hash": null },
    "bbf-github": { "last_checked": null, "last_hash": null },
    "wifi-alliance": { "last_checked": null, "last_hash": null }
  },
  "known_versions": {
    "TR-369": "1.3",
    "TR-181": "2.17",
    "TR-069": "1.6 Amendment 6",
    "TR-106": "1.12"
  }
}
```

---

## Key Principles

1. **[Your Company]-first** — Every finding assessed for [Your Product] impact
2. **Actionable** — Changes tagged with release and action needed
3. **Crisp** — 1-2 sentences per item, no spec-dumping
4. **Stateful** — Track what's been seen, only surface new changes
5. **Versioned** — Track known spec versions to detect updates
