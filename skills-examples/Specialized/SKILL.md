---
name: Research
description: "Firmware-context research — extends system Research with build system and Jenkins knowledge. USE WHEN research in firmware context, OpenWrt, build system questions, Jenkins CI."
specializes: Research
overrides:
  - StandardResearch
extends:
  - FirmwareBuildSearch
use_when: "Research in firmware context. Adds build system and Jenkins context. Overrides StandardResearch with firmware-specific agent configuration."
---

# Research (Firmware Specialization)

This skill **specializes** the system `Research` skill for firmware development context.

## What changes from system Research

**Overrides:**
- `StandardResearch` — Uses firmware-aware agent configuration with Jenkins, OpenWrt, and build system context injected

**Extends (adds):**
- `FirmwareBuildSearch` — Searches yourcompany-mcp build tools and Jenkins artifact history

**Inherits unchanged:**
- `QuickResearch`, `ExtensiveResearch`, `DeepInvestigation`, all other system workflows

## Specialization mechanics

The `specializes:` + `overrides:` + `extends:` frontmatter is validated by:
```
bun scripts/skills-lock.ts validate-specialization path/to/SKILL.md
```

This catches typos in workflow names (must match parent's exact workflow names) and missing parent skills at development time.

## Workflow Routing

| Workflow | When to Use |
|----------|-------------|
| StandardResearch | General firmware research (overrides system version with firmware context) |
| FirmwareBuildSearch | Search Jenkins builds, OpenWrt packages, yourcompany-mcp tools |

See system `Research` skill for all inherited workflows.
