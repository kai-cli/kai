# Update Workflow

**Trigger:** "standards update", "TR-369 updates", "what's new in USP", "/standards", "open standards status"

## Process

### 1. Load State

```bash
cat ~/.claude/skills/StandardsTracker/State/last-check.json
```

Determine the last check timestamp and known spec versions.

### 2. Fetch Sources (Parallel)

Launch parallel WebFetch requests:

| Agent | Source | What to Extract |
|-------|--------|----------------|
| Agent 1 | broadband-forum.org | News, spec releases, event announcements |
| Agent 2 | usp.technology | USP spec version, changelog, protocol updates |
| Agent 3 | usp-data-models.broadband-forum.org | Data model version, new objects/parameters |
| Agent 4 | github.com/BroadbandForum | Recent commits, releases, issues on OB-USP-Agent and related repos |
| Agent 5 | wi-fi.org | EasyMesh updates, certification program changes |

**WebFetch prompt for each:**
> "Extract all news, updates, releases, and changes from this standards/industry site. For each item: title, 1-2 sentence summary, date if available. Focus on content related to TR-369 (USP), TR-069 (CWMP), device data models, CPE management, and wireless standards."

### 3. Detect Version Changes

Compare fetched spec versions against `known_versions` in state:

| Spec | Known Version | Current Version | Changed? |
|------|--------------|-----------------|----------|
| TR-369 | [from state] | [from fetch] | [yes/no] |
| TR-181 | [from state] | [from fetch] | [yes/no] |
| TR-069 | [from state] | [from fetch] | [yes/no] |
| TR-106 | [from state] | [from fetch] | [yes/no] |

**If version changed:** Flag as HIGH priority spec update.

### 4. Categorize Items

For each extracted item:

| Category | Criteria |
|----------|----------|
| **Spec Updates** | New releases, corrigenda, amendments, version bumps |
| **Data Model** | New objects, parameter changes, profile additions |
| **Adoption** | Vendor news, ISP deployments, certifications, tools |

### 5. Assess Your Company Impact

For each item, determine:
- **Affects:** Which subsystem (USP agent, data model, Wi-Fi, security)
- **Pinnacle Release:** 2.x (current) or 3.0 (future)
- **Action:** implement / track / ignore
- **Priority:** HIGH / MEDIUM / LOW / NONE

### 6. Generate Output

Use the format from SKILL.md:
- Header with timestamp and sources
- Three category sections with items
- Your Company Impact Assessment table
- Summary table

### 7. Update State

Write new state to `State/last-check.json`:
- Update `last_check_timestamp`
- Update per-source `last_checked` and `last_hash`
- Update `known_versions` if any changed

---

## First Run Behavior

If `last_check_timestamp` is null:
- Treat as first run
- Fetch current state of all sources
- Establish baseline known_versions
- Report current landscape rather than "changes since last check"
- Set period as "Baseline (first run)"
