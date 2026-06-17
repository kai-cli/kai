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

### 1b. Memcarry backflow safety net

Check whether any GLOBAL lesson recalled this session should be refined (the B→A backflow net, spec 004 FR8):
- Read `MEMORY/STATE/memcarry-recalled-${session_id}.jsonl` (atom ids surfaced this session). If absent/empty → report "No recalled lessons." and skip.
- For each recalled lesson id, ask: did this session establish anything that makes that lesson **wrong, incomplete, or in need of a caveat**?
- If yes for any: surface a WAS/NOW preview via `memcarry refine <id> --do "…" --because "…"` (no `--apply`) and ask {PRINCIPAL.NAME} to confirm. On confirm only, re-run with `--apply`. NEVER `--apply` without confirmation (anti-circular-loop gate).
- If nothing learned contradicts/extends them → report "Recalled lessons still accurate." Do NOT refine speculatively.
- CLI: `${PAI_DIR}/memcarry/packages/cli/src/index.ts`, `MEMCARRY_STORE=$PAI_DIR/MEMORY/memcarry/store`.

### 1c. Memcarry capture safety net

Check whether this session produced a durable, reusable LESSON worth keeping (the forward/capture half, spec 005 FR8 — sibling to the 1b backflow net):
- Review the session for a cross-project rule or gotcha {PRINCIPAL.NAME} established that ISN'T already a recalled lesson (those go through 1b refine, not capture).
- If yes: draft the `WHEN → DO → BECAUSE` and preview via `memcarry capture-lesson --when "…" --do "…" --because "…" --trigger "a,b" [--scope global|project:<name>]` (no `--apply`). It dup-checks — if it reports `similar`/`collision`, prefer `refine` of that atom instead. Ask {PRINCIPAL.NAME} to confirm. On confirm only, re-run with `--apply`. NEVER `--apply` without confirmation (anti-circular-loop gate).
- If nothing durable was learned → report "No new lessons to capture." Do NOT capture speculatively or pump the store.
- CLI/store paths same as 1b.

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
