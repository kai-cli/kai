---
name: WikiQuery
description: Query the Linksys Engineering Wiki for firmware, build system, Jenkins, GitHub, and repository knowledge. USE WHEN wiki, wiki query, check wiki, what do we know about, linksys knowledge, firmware knowledge, build knowledge, jenkins knowledge, look up in wiki, wiki search.
---

## Customization

**Before executing, check for user customizations at:**
`~/.claude/PAI/USER/SKILLCUSTOMIZATIONS/WikiQuery/`

If this directory exists, load and apply any PREFERENCES.md, configurations, or resources found there. These override default behavior. If the directory does not exist, proceed with skill defaults.

# WikiQuery Skill

Fast knowledge retrieval from the Linksys Engineering Wiki (`~/Projects/Linksys-Wiki/`).

## When To Use

- Any question about Linksys firmware, repos, build system, Jenkins, GitHub processes
- Before doing web research on topics the wiki likely covers
- When onboarding to a new area of the codebase
- When another skill or workflow needs Linksys engineering context

## Workflow

### Step 1: Load the Index

Read `~/Projects/Linksys-Wiki/index.md` to see all available pages.

### Step 2: Identify Relevant Pages

Match the user's question to wiki pages. Use these heuristics:

| Question About | Check These Pages |
|---------------|-------------------|
| A specific repo | `repos/{repo-name}.md` |
| Building firmware | `build-system/overview.md` + specific phase pages |
| Jenkins / CI | `jenkins/server.md`, `jenkins/build-dev-job.md` |
| GitHub workflows | `github/actions-dispatch.md`, `github/release-workflow.md` |
| A product | `products/{product}.md` |
| A customer | `customers/{customer}.md` |
| Release process | `processes/dev-to-release.md` |
| Architecture patterns | `concepts/` folder pages |
| "How does X connect to Y?" | `repos/overview.md` + both entity pages |

### Step 3: Read Pages (1-4 max)

Load the identified pages. Most questions need 1-2 pages. If you need more than 4, the wiki may be missing a synthesis page — note this for future ingestion.

### Step 4: Answer

Synthesize the answer from wiki content. Include:
- The direct answer
- `[[page-name]]` references so the user can dig deeper
- If the wiki doesn't cover it: say so explicitly and suggest checking `~/Projects/Knowledge/` (raw sources) or doing live research

### Step 5: Feed Back (optional)

If the query revealed:
- A gap in the wiki (question couldn't be answered)
- Stale information (wiki contradicts known current state)
- A useful synthesis that should be a page

Note it for future ingestion. Don't create pages inline — just flag for the user.

## Modes

### Quick Query (default)
Read index → identify 1-2 pages → answer. Under 30 seconds.

### Deep Query
Read index → identify 3-4 pages → cross-reference → synthesize. For complex questions spanning multiple topics.

### Inventory Query
"What does the wiki know about X?" — List all pages that mention the topic, with one-line summaries. Good for scoping before a deep dive.

## Integration with Other Skills

Other skills should invoke WikiQuery when they need Linksys context:
- **Research skill**: Check wiki BEFORE doing web research
- **Engineer skill**: Check wiki for build/process knowledge before investigating repos
- **Architect skill**: Check wiki for existing patterns and decisions

## Example Invocations

```
User: "how do dev builds work?"
→ Read index → load jenkins/dev-builds.md → answer with process steps

User: "what repos are involved in a firmware release?"
→ Read index → load repos/overview.md + processes/dev-to-release.md → answer with repo flow

User: "what's the deal with SDK patches?"
→ Read index → load build-system/sdk-patches.md → answer with categories and application order

User: "wiki: does the wiki cover EasyMesh?"
→ Inventory mode → grep wiki for easymesh mentions → report coverage
```

## Wiki Location

```
~/Projects/Linksys-Wiki/
├── schema.md          ← Structure rules (read if creating/updating pages)
├── index.md           ← START HERE for all queries
├── log.md             ← Operation history
├── repos/             ← Repository entity pages
├── github/            ← GitHub process pages
├── jenkins/           ← Jenkins & CI/CD
├── build-system/      ← Build architecture
├── firmware/          ← Firmware components
├── processes/         ← End-to-end workflows
├── concepts/          ← Patterns & abstractions
├── customers/         ← Customer specifics
└── products/          ← Product lines
```

## Raw Sources (Tier 3 fallback)

If the wiki doesn't have what you need:
- `~/Projects/Knowledge/` — Reference docs, specs, source code snapshots
- `~/.claude/projects/-Users-deven-ducommun-Projects-Learning-Linksys-Repo/memory/` — PAI memory (deepest firmware knowledge)
- Actual GitHub repos via `gh` CLI
