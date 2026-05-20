# /evolve — Instinct Evolution Dashboard

**Purpose:** Review, promote, and prune behavioral instincts captured during sessions.
**Trigger:** User types `/evolve` (user-invoked only, never auto-run)

---

## Invocation Forms

```
/evolve              → Show instinct dashboard + cluster candidates
/evolve --promote    → Promote a cluster to CLAUDE.md rule or skill
/evolve --prune      → Review low-value instincts for manual archival
/evolve --stats      → Instinct metrics (count, confidence distribution, age)
```

---

## Workflow

### /evolve (Dashboard)

1. Load active instincts from `MEMORY/LEARNING/INSTINCTS/instincts.jsonl`
2. Display summary table grouped by confidence tier:
   - 🔥 High (0.8+): eligible for promotion
   - ✅ Active (0.5–0.79): surfacing at session start
   - 💤 Building (0.3–0.49): accumulating confidence
3. Identify cluster candidates (≥2 instincts with ≥2 shared tags, confidence ≥0.8, trigger_count ≥3)
4. Display: "Found N cluster(s) eligible for promotion. Run `/evolve --promote` to review."

**Output format:**
```
## Instinct Dashboard

Active: N | Eligible (surfacing): N | Archive-eligible (decayed): N

### High Confidence (ready for promotion)
• [95%] [kai, hooks, bun] Use bun test --bail for faster feedback  ×7
• [82%] [kai, hooks] Never modify hook input schema directly         ×4

### Active
• [65%] [testing] Always run tests before reporting done                    ×3

### Building
• [35%] [git] Check remote before push                                      ×2

### Cluster Candidates
Cluster A: [bun, testing, hooks] — 2 instincts with 85%+ confidence
  → Run /evolve --promote to convert to CLAUDE.md rule
```

---

### /evolve --promote

1. Show cluster candidates with their instincts
2. Ask user: "Which cluster to promote?" (AskUserQuestion)
3. Ask user: "Promote as: CLAUDE.md rule | skill file | global rule" (AskUserQuestion)
4. Draft the rule/skill based on cluster instincts:
   - CLAUDE.md rule: one-line behavioral rule added to project or global CLAUDE.md
   - Skill: new skill file scaffolded in `skills/` directory
5. Show drafted content and ask: "Approve as-is, edit, or skip?" (AskUserQuestion)
6. On approval: write to target file, archive source instincts
7. Confirm: "Promoted to [target]. N instincts archived."

**Target resolution:**
- Default: project-level `.claude/CLAUDE.md` or nearest CLAUDE.md
- `--target global` → `~/.claude/CLAUDE.md`
- `--target skill` → new file in `~/.claude/skills/[ClusterName]/SKILL.md`
- **Always confirm target before writing** — no silent promotions

---

### /evolve --prune

1. Show instincts below 0.5 confidence (building tier)
2. For each, show: text, confidence, trigger_count, age, tags
3. Ask user to select which to archive manually
4. Archive selected instincts → `instincts-archived.jsonl`
5. Confirm: "N instincts archived."

---

### /evolve --stats

Display metrics:
```
## Instinct Statistics

Active instincts: N
  Eligible for surfacing (≥0.5): N
  Eligible for promotion (≥0.8): N
Average confidence: X.XX
Oldest active instinct: X days ago
Sources: correction: N | repetition: N | rating: N
Archived total: N

Decay schedule: -0.1 per 30 days | Archive at 0.0
Cap: 100 active (auto-archive lowest on overflow)
```

---

## Implementation Notes

- Uses `hooks/lib/instinct-store.ts` for all read/write operations
- All file writes require explicit user confirmation via AskUserQuestion
- Source instincts are archived (not deleted) after successful promotion
- v5.7 enhancement: replace tag-based clustering with embedding similarity

## Related Files

- `MEMORY/LEARNING/INSTINCTS/instincts.jsonl` — active instincts
- `MEMORY/LEARNING/INSTINCTS/instincts-archived.jsonl` — archived instincts
- `hooks/InstinctCapture.hook.ts` — captures new instincts
- `hooks/lib/instinct-store.ts` — CRUD, decay, clustering
- `config/settings.json` → `instincts` block — feature flags
