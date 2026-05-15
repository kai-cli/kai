# Context Routing

Load context on-demand by reading the file at the path listed. Only load what the current task requires.

## KAI System

| Topic | Path |
|-------|------|
| KAI system overview | `PAI/README.md` |
| System architecture | `PAI/PAISYSTEMARCHITECTURE.md` |
| Memory system | `PAI/MEMORYSYSTEM.md` |
| Skill system | `PAI/SKILLSYSTEM.md` |
| Hook system | `PAI/THEHOOKSYSTEM.md` |
| Agent system | `PAI/PAIAGENTSYSTEM.md` |
| Delegation system | `PAI/THEDELEGATIONSYSTEM.md` |
| Notification system | `PAI/THENOTIFICATIONSYSTEM.md` |
| CLI architecture | `PAI/CLIFIRSTARCHITECTURE.md` |
| Tools reference | `PAI/TOOLS.md` |
| Actions & pipelines | `PAI/ACTIONS.md`, `PAI/PIPELINES.md` |
| Flows | `PAI/FLOWS.md` |
| Behavioral rules | `PAI/AISTEERINGRULES.md` |
| PRD format spec | `PAI/PRDFORMAT.md` |

## {PRINCIPAL.NAME} — Personal Context

| Topic | Path |
|-------|------|
| All USER context index | `PAI/USER/README.md` |
| Projects registry | `PAI/USER/PROJECTS/PROJECTS.md` |
| Telos (life goals) | `PAI/USER/TELOS/README.md` |

## Your Domain Knowledge

Add your domain-specific knowledge paths here. Structure by domain:

| Topic | Path |
|-------|------|
| Knowledge base index | `~/Projects/Knowledge/INDEX.md` |
| _Your domain A_ | `~/Projects/Knowledge/domain-a/INDEX.md` |
| _Your domain B_ | `~/Projects/Knowledge/domain-b/INDEX.md` |

Configure `config/domains.jsonc` to enable automatic domain-context injection
when your prompts match domain keywords.

## KAI Development

| Topic | Path |
|-------|------|
| KAI repo | `~/Projects/kai/` |
| KAI live installation | `~/.claude/` |
| KAI Board (Kanban) | `~/Projects/kai/scripts/board.ts` (localhost:3333) |

## Cross-Project Memory

Knowledge accumulated in one project's memory is available to all projects via these paths.
Read on-demand when context is needed — not auto-injected.

**Shorthand:** `{MEM}` = `~/.claude/projects/-Users-you-Projects-`

Each project's memory index lives at: `{MEM}<project-name>/memory/MEMORY.md`

---

### How This File Grows

As you work across projects, KAI accumulates project-specific memory (feedback, references,
project state). Add routing entries here so context is discoverable across projects:

```markdown
### my-project (N files)

| Topic | Path |
|-------|------|
| Index | `{MEM}my-project/memory/MEMORY.md` |
| Architecture notes | `{MEM}my-project/memory/project_architecture.md` |
| Build system | `{MEM}my-project/memory/reference_build_system.md` |
```

This file grows organically from real work. Don't pre-populate — let it accumulate
naturally as you use KAI across more projects.
