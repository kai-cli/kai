---
name: AuditMemory
description: Scan memory files for stale references — dead file paths, missing functions, outdated project state. USE WHEN audit memory, check memory, stale memory, memory health, memory maintenance, clean memory.
---

# Audit Memory

Scans all memory files for staleness indicators and reports findings.

## What It Checks

1. **Dead file paths** — memory references a file path that no longer exists on disk
2. **Dead symlinks** — memory references a symlink target that's broken
3. **Missing agents/skills** — memory references custom agents or skills that were removed
4. **Stale project state** — memory describes project status that conflicts with current git state
5. **Orphaned entries** — MEMORY.md index references a file that doesn't exist

## Invocation

When `/audit-memory` is invoked:

### Step 1: Collect All Memory Files

```bash
# Global project memory
find ~/.claude/projects -name "*.md" -path "*/memory/*" -not -name ".archive" | sort

# Project-level MEMORY.md files
find ~/Projects -maxdepth 3 -name "MEMORY.md" -not -path "*/node_modules/*" -not -path "*/.git/*" | sort
```

### Step 2: Extract References from Each File

For each memory file, extract:
- File paths (anything matching `~/`, `/Users/`, or relative paths like `lib/`, `src/`)
- Function/class names preceded by backticks
- Git branches (patterns like `feature/`, `main`, `develop`)
- URLs (check if they're internal references vs external)

### Step 3: Verify References

For each extracted reference:

```bash
# Check file existence
test -e "$path" && echo "OK" || echo "STALE: $path"

# Check symlink targets
test -L "$path" && test -e "$(readlink "$path")" || echo "BROKEN SYMLINK: $path"

# Check git branches (if repo exists)
git -C "$repo" branch --list "$branch" 2>/dev/null
```

### Step 4: Check MEMORY.md Index Integrity

For each entry in `~/.claude/projects/*/memory/MEMORY.md`:
- Verify the linked `.md` file exists
- Verify the description still roughly matches the file content (first line)

### Step 5: Report

Output a structured report:

```
═══ MEMORY AUDIT REPORT ═══════════════════════

## Stale References (action required)
- [file.md] references `~/Projects/X/file.ts` — FILE NOT FOUND
- [file.md] references branch `feature/old` — BRANCH DELETED
- [MEMORY.md] links to `project_x.md` — FILE MISSING

## Suspect (verify manually)
- [file.md] last_verified: 2026-01-15 (133 days ago)
- [file.md] references project state that may have changed

## Healthy
- X memory files checked
- Y references verified OK
- Z files have no external references

## Suggested Actions
- Delete: [list files that reference only dead paths]
- Update: [list files with partially stale content]
- Archive: [list files about completed/abandoned projects]
```

### Step 6: Offer Fixes

After showing the report, use AskUserQuestion to offer:
- "Fix all" — delete orphaned index entries, archive stale files
- "Fix safe only" — only fix orphaned MEMORY.md index entries
- "Report only" — no changes, just the audit output

## Important Rules

1. **Never delete memory files without confirmation.** Always report first.
2. **Check both global memory and project memory** (all `~/.claude/projects/*/memory/` dirs).
3. **Don't flag external URLs** — only check local file paths and references.
4. **The `custom-agents/` directory no longer exists** — any reference to `~/.claude/custom-agents/*.md` is stale by definition.
5. **Respect .archive/ directories** — don't audit archived content.
