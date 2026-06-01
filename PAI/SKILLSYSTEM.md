# Custom Skill System

**The MANDATORY configuration system for ALL PAI skills.**

*Full spec: [PAI/dev/SKILLSYSTEM-Reference.md](dev/SKILLSYSTEM-Reference.md)*

---

## TitleCase Naming Convention (MANDATORY)

All naming in the skill system MUST use TitleCase (PascalCase).

- Skill directory: `CreateSkill` (not `create-skill`)
- Workflow files: `UpdateInfo.md` (not `update-info.md`)
- Tool files: `ManageServer.ts`
- YAML name field: `name: CreateSkill`
- Exception: `SKILL.md` is always uppercase

---

## Personal vs System Skills

| Type | Naming | Sharing |
|------|--------|---------|
| **System** | TitleCase: `Research`, `Browser` | Exported to public PAI repo |
| **Personal** | `_ALLCAPS`: `_METRICS`, `_COMMS` | Never shared — contains personal data |

Personal skills sort first (underscore prefix) and are auto-excluded from PAI pack exports.

---

## Skill Customization Pattern

All system skills check for user customizations before executing:
```
~/.claude/PAI/USER/SKILLCUSTOMIZATIONS/{SkillName}/
```
If that directory exists, load and apply any files found there before running the default workflow.

---

## YAML Frontmatter Rules (USE WHEN, routing, 1024 char limit)

Every `SKILL.md` starts with:
```yaml
---
name: SkillName
description: "One sentence. Triggers and purpose."
use_when: "Specific trigger conditions. Excludes. Max 1024 chars."
workflows:
  - WorkflowName: "One-line description"
---
```

**`use_when`** is the routing key — written for the LLM that reads it, not humans.

---

## Directory Structure

```
skills/{SkillName}/
├── SKILL.md          # Frontmatter + routing table (required)
├── Workflows/        # One .md per workflow
│   └── WorkflowName.md
└── Tools/            # Supporting TypeScript tools (optional)
    └── ToolName.ts
```

No other top-level files or directories. No subdirectories under Workflows/.

---

## Workflow Routing Table Format

Inside `SKILL.md`, after frontmatter:
```markdown
## Workflows

| Workflow | When to Use |
|----------|-------------|
| WorkflowName | Trigger condition — what makes this the right choice |
```

---

---

## Skill Specialization (Project Skills)

Project skills can **specialize** a system skill, inheriting all its workflows and selectively overriding or extending them.

### Frontmatter fields

```yaml
---
name: Research                       # Same name as parent — overrides it in-context
specializes: Research                # Parent system skill name (must exist in skills-lock.json)
overrides:                           # Parent workflows replaced by this skill's versions
  - StandardResearch
extends:                             # New workflows added (not in parent)
  - FirmwareBuildSearch
use_when: "Research in firmware context."
---
```

| Field | Required | Meaning |
|-------|----------|---------|
| `specializes` | Yes (for project specializations) | Parent system skill to inherit from |
| `overrides` | No | Workflows from the parent to replace; each must match a parent workflow name exactly |
| `extends` | No | New workflow files added by this project skill; do NOT appear in parent |

### Validation

The lock generator validates specialization declarations at development time:

```bash
bun scripts/skills-lock.ts validate-specialization path/to/project/SKILL.md
```

**Errors caught:**
- `missing_parent` — `specializes:` references a skill not in `skills-lock.json`
- `invalid_override` — `overrides:` lists a workflow name that doesn't exist in the parent

**Not validated at runtime** — Claude Code controls file loading; specialization is a convention and lint-time contract only.

### Example

See `skills-examples/Specialized/` for a complete working example.

---

*Full spec with examples, canonicalization guide, and advanced patterns: [PAI/dev/SKILLSYSTEM-Reference.md](dev/SKILLSYSTEM-Reference.md)*
