# How Memory Works

## Overview

KAI builds up knowledge about you and your work over time. This happens
automatically — you don't need to do anything. Over your first ~5-10 sessions,
KAI develops a model of your expertise, patterns, and preferences.

## Directory Structure

| Directory | What's Stored | Auto-populated? | Retention |
|-----------|--------------|-----------------|-----------|
| KNOWLEDGE/ | Domain expertise distilled from sessions | Yes (KnowledgeSync hook) | Permanent (committed) |
| WISDOM/FRAMES/ | Curated lessons and insights | Manual curation | Permanent (committed) |
| STATE/ | Session metadata, work tracking | Yes | 30 days (auto-cleaned) |
| WORK/ | Active PRDs and work sessions | Yes | Until completed |
| LEARNING/ | Raw failure captures, reflections | Yes | Archived monthly |
| LEARNING/REFLECTIONS/ | Structured reflections on session outcomes | Yes | Archived monthly |
| RELATIONSHIP/ | Interaction patterns with user | Yes | Permanent |
| STAGING/ | Draft insights awaiting curation | Yes (ReflectionHarvester) | 14 days |
| RESEARCH/ | Research session outputs | Yes | Per-session |
| SECURITY/ | Security scan results, event log | Yes | Per-session |
| SNAPSHOTS/ | Context snapshots for recovery | Yes | 7 days |
| DECISIONS/ | Architectural decision records | Yes | Permanent |

## What You Should Know

- **KNOWLEDGE/ and WISDOM/ are committed to git** — review before committing.
  If your sessions involve sensitive context (internal project names, colleague
  names, proprietary systems), review KNOWLEDGE/ entries before pushing.
  KnowledgeSync distills technical patterns, but domain keywords can leak context.
  Run `git diff MEMORY/KNOWLEDGE/` before committing to verify.
- Everything else is gitignored (machine-local, may contain PII).
- You never need to manually create files in these directories.
- On fresh install, directories exist but are empty — they fill over ~5-10 sessions.
- The `SessionCleanup` hook enforces retention automatically.

## Customization

- To add domain knowledge manually: edit `MEMORY/KNOWLEDGE/{domain}.md`
- To add a wisdom frame: create `MEMORY/WISDOM/FRAMES/{name}.md`
- To change retention: edit `memory.retention` in `config/preferences.jsonc`
- To review and promote drafts: run `bun PAI/Tools/MemoryCurate.ts`

## Memory Curation

KAI accumulates raw observations in STAGING/ and LEARNING/. Periodically,
you can review and promote the best insights to WISDOM/:

```bash
bun ~/.claude/PAI/Tools/MemoryCurate.ts          # Interactive review
bun ~/.claude/PAI/Tools/MemoryCurate.ts approve-all --confidence 0.85  # Batch
```

## Troubleshooting

- **"My knowledge isn't growing"**: KnowledgeSync fires on session end —
  complete sessions normally (don't kill the process).
- **STATE/ is huge**: SessionCleanup runs daily at session start. If it hasn't,
  you can force cleanup: delete files older than 30 days in STATE/.
- **Want to reset memory**: `bun ~/.claude/scripts/kai-reset.ts --hard` clears
  runtime state while preserving KNOWLEDGE/ and WISDOM/.
- **Duplicate entries in KNOWLEDGE/**: Run `bun PAI/Tools/MemoryCurate.ts` to
  review and consolidate.
