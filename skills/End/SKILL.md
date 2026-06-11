---
name: End
description: Session wrap-up checklist — saves memory, updates knowledge, checks commit/push status, updates PRD phase. USE WHEN end, wrap up, done for now, closing out, finish session.
---

## MANDATORY TRIGGER

| User Says | Action |
|-----------|--------|
| "/end" / "wrap up" / "done for now" / "closing out" | → Run full checklist |

## Checklist

Execute each step in order. Report results inline. Do NOT prompt for confirmation except for destructive actions (commit, push).

### 1. Memory Check

Review the conversation for anything worth persisting:
- **User preferences/feedback** discovered this session
- **Project state changes** (new decisions, phase transitions, blockers)
- **References** to external systems learned

If anything qualifies, write to memory. If nothing new, report "No new memories."

### 2. Knowledge Sync

Check if domain knowledge files were updated or should be updated based on work done:
- Were facts learned that belong in `MEMORY/KNOWLEDGE/*.md`?
- Did existing knowledge become stale?

If updates needed, make them. Otherwise report "Knowledge current."

### 3. PRD Update

If this session was working on a task with a PRD:
- Update `phase` if work is complete (e.g. execute → done)
- Update `progress` count
- Add decisions or verification notes if substantive

If no active PRD or already up to date, report "PRD current."

### 4. Docs & Roadmap Currency (VERIFY, don't assume)

The session's work must be reflected in the docs/wiki/roadmap BEFORE closing — confirm it, don't trust memory.
For each substantive thing built/changed this session, check it is actually written down:
- **Roadmap** (`docs/planning/ROADMAP-*.md`): are completed items still listed as open? Are new builds recorded?
  Grep the roadmap for the feature/file names you touched. If stale → fix inline now (mark done/partial, add new).
- **Wiki** (PAI-Wiki / project wikis): did a new subsystem/behavior get a wiki page or section? Check
  `pending-wiki-nudge.json` — if the wiki-currency hook flagged un-wikied code, resolve it here.
- **Verify against live state**, not the conversation: `grep` the doc for what you changed; confirm files
  marked done actually exist/changed.

If everything is current, report "Docs current." If you fixed drift, report what.

### 5. Git Status

Run `git status` and `git log --oneline @{u}..HEAD` (if upstream exists). Report:
- Uncommitted changes (list files)
- Unpushed commits (count + one-liners)

Do NOT commit or push automatically. Just report state and ask if user wants action.

### 6. Summary

One-line session summary: what was accomplished.

## Output Format

```
════ SESSION END ═══════════════════════════
📝 MEMORY: [saved N memories / no new memories]
📚 KNOWLEDGE: [updated X / current]
📋 PRD: [updated slug → phase / current / N/A]
📖 DOCS: [reconciled roadmap/wiki / current]
🔀 GIT: [N uncommitted files, M unpushed commits / clean]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 SESSION: [one-line summary of what was accomplished]
```

If git has uncommitted or unpushed work, follow with:
```
🔧 Action needed?
- [ ] Commit changes
- [ ] Push to remote
```
