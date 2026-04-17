# Update Workflow

**Trigger:** "competitive update", "competitor news", "/competitive", "what are competitors doing"

## Process

### 1. Load State

```bash
cat ~/.claude/skills/CompetitiveIntel/State/last-check.json
```

Determine the last check timestamp to filter for new content.

### 2. Fetch Sources (Parallel)

Launch parallel WebFetch requests:

| Agent | Source | Focus |
|-------|--------|-------|
| Agent 1 | theverge.com | Search for: router, mesh, WiFi, wireless product reviews/news |
| Agent 2 | arstechnica.com | Search for: networking, WiFi, router reviews and news |
| Agent 3 | cnet.com | Search for: best routers, mesh WiFi, wireless networking |
| Agent 4 | smallnetbuilder.com | Recent reviews, benchmark articles |
| Agent 5 | wifinowglobal.com | Industry news, Wi-Fi technology developments |

**WebFetch prompt for each:**
> "Extract all articles about consumer/SMB wireless routers, mesh WiFi systems, and networking products. Focus on: Netgear, TP-Link, Asus, Eero, Google Nest WiFi, Ubiquiti, [Your Company], and any new entrants. For each item: title, competitor name, 1-2 sentence summary, date. Last 14 days."

### 3. Categorize Items

| Category | Criteria |
|----------|----------|
| **Launches** | New products, SKUs, hardware announcements |
| **Features** | Firmware updates, new capabilities, ecosystem changes |
| **Pricing** | Price changes, deals, bundle offers, subscription models |
| **Reviews** | Product reviews, benchmarks, customer reception |

### 4. Filter by Relevance

Drop items that are:
- About enterprise/carrier-grade equipment (not consumer/SMB)
- About non-wireless products (cable modems, switches unless bundled)
- Duplicate coverage of the same announcement
- Older than 14 days (unless major launch)

### 5. Assess [Your Company] Impact

For each item:
- **Signal:** What happened (1 sentence)
- **Competitor:** Who did it
- **Affects [Your Product]:** Which release or roadmap area
- **Action:** RESPOND / MONITOR / IGNORE

### 6. Generate Output

Use SKILL.md format with all four category sections plus [Your Company] Implications table.

### 7. Update State

Write to `State/last-check.json`:
- Update `last_check_timestamp`
- Update per-source `last_checked`

---

## First Run Behavior

If `last_check_timestamp` is null:
- Fetch last 30 days of content for broader baseline
- Focus on establishing current competitive landscape
- Set period as "Last 30 days (first run)"
