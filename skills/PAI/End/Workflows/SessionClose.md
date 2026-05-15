# Session Close Workflow

Produce a structured closing summary by checking session state. Then tell the user to type `/exit` when ready.

## Steps

1. **Check active work** — Read `MEMORY/STATE/work.json` for any PRD in an active phase (observe/think/plan/build/execute/verify). Report what's in progress and what criteria remain unchecked.

2. **Check STAGING** — Count files in `MEMORY/STAGING/`. If >0, note that `pai curate` should be run to review pending knowledge drafts.

3. **Check memory written** — Look at `MEMORY/KNOWLEDGE/` domain files modified today (via file mtime). Report which domains got new knowledge this session.

4. **Check CAPABILITIES** — If `CAPABILITIES.md` was modified this session (mtime today), note what capabilities were added.

5. **Check git state** — Run `git status` in the current working directory. Report uncommitted changes, unpushed commits.

6. **Produce summary** in this format:

```
═══ SESSION CLOSE ═══════════════════════════

📋 WORK THIS SESSION:
  • [bullet list of what was accomplished]

🧠 MEMORY CAPTURED:
  • [domains updated, capabilities added, or "none"]

📦 PENDING:
  • [STAGING drafts awaiting curation, stale PRDs, uncommitted changes]
  • [or "Nothing pending — clean exit"]

💡 HANDOFF NOTE:
  [One sentence about what to pick up next session, or "None needed"]

═══════════════════════════════════════════════
Type /exit to close, or keep working.
```

## Rules

- Keep it concise — this is a summary, not a report
- Only show sections that have content (skip empty ones)
- If nothing happened this session (brand new session, no work), just say "Clean session — no work to summarize" and suggest `/exit`
- Do NOT auto-exit — the user decides whether to continue or close
- Do NOT run KnowledgeSync or any heavy operations — just read state
