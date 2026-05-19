---
name: WikiQuery
description: Query a local engineering wiki for project knowledge. USE WHEN wiki, wiki query, check wiki, what do we know about, project knowledge, look up in wiki, wiki search.
---

## Customization

**Before executing, check for user customizations at:**
`~/.claude/PAI/USER/SKILLCUSTOMIZATIONS/WikiQuery/`

If this directory exists, load and apply any PREFERENCES.md, configurations, or resources found there. These override default behavior. If the directory does not exist, proceed with skill defaults.

# WikiQuery Skill

Fast knowledge retrieval from a local engineering wiki.

## Setup

Create a wiki directory (default: `~/Projects/Wiki/`) with:
- `index.md` — Page listing (start here for all queries)
- `schema.md` — Structure rules for creating/updating pages
- Topic subdirectories (repos/, processes/, concepts/, etc.)

## When To Use

- Any question about topics the wiki likely covers
- Before doing web research on internal topics
- When onboarding to a new area of the codebase
- When another skill or workflow needs project-specific context

## Workflow

### Step 1: Load the Index

Read `~/Projects/Wiki/index.md` to see all available pages.

### Step 2: Identify Relevant Pages

Match the user's question to wiki pages by topic/keyword.

### Step 3: Read Pages (1-4 max)

Load the identified pages. Most questions need 1-2 pages.

### Step 4: Answer

Synthesize the answer from wiki content. Include:
- The direct answer
- `[[page-name]]` references so the user can dig deeper
- If the wiki doesn't cover it: say so explicitly and suggest alternative sources

### Step 5: Feed Back (optional)

If the query revealed a gap, stale info, or useful synthesis opportunity — note it for the user.

## Modes

### Quick Query (default)
Read index -> identify 1-2 pages -> answer. Under 30 seconds.

### Deep Query
Read index -> identify 3-4 pages -> cross-reference -> synthesize.

### Inventory Query
"What does the wiki know about X?" — List all pages that mention the topic.

## Integration with Other Skills

Other skills should invoke WikiQuery when they need project context:
- **Research skill**: Check wiki BEFORE doing web research
- **Engineer skill**: Check wiki for build/process knowledge
- **Architect skill**: Check wiki for existing patterns and decisions

## Wiki Location

```
~/Projects/Wiki/
├── schema.md          <- Structure rules
├── index.md           <- START HERE for all queries
├── repos/             <- Repository entity pages
├── processes/         <- End-to-end workflows
├── concepts/          <- Patterns & abstractions
└── ...                <- Your custom categories
```
