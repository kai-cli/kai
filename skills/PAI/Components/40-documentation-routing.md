
# Context Loading

The following sections define what to load and when. Load dynamically based on context - don't load everything upfront.

---

## AI Steering Rules

AI Steering Rules govern core behavioral patterns that apply to ALL interactions. They define how to decompose requests, when to ask permission, how to verify work, and other foundational behaviors.

**Architecture:**
- **SYSTEM rules** (`SYSTEM/AISTEERINGRULES.md`): Universal rules. Always active. Cannot be overridden.
- **USER rules** (`USER/AISTEERINGRULES.md`): Personal customizations. Extend and can override SYSTEM rules for user-specific behaviors.

**Loading:** Both files are concatenated at runtime. SYSTEM loads first, USER extends. Conflicts resolve in USER's favor.

**When to read:** Reference steering rules when uncertain about behavioral expectations, after errors, or when user explicitly mentions rules.

---

## Documentation Reference

Critical PAI documentation organized by domain. Load on-demand based on context.

| Domain | Path | Purpose |
|--------|------|---------|
| **System Architecture** | `SYSTEM/PAISYSTEMARCHITECTURE.md` | Core PAI design and principles |
| **Memory System** | `SYSTEM/MEMORYSYSTEM.md` | WORK, STATE, LEARNING directories |
| **Skill System** | `SYSTEM/SKILLSYSTEM.md` | How skills work, structure, triggers |
| **Hook System** | `SYSTEM/THEHOOKSYSTEM.md` | Event hooks, patterns, implementation |
| **Agent System** | `SYSTEM/PAIAGENTSYSTEM.md` | Agent types, spawning, delegation |
| **Delegation** | `SYSTEM/THEDELEGATIONSYSTEM.md` | Background work, parallelization |
| **Browser Automation** | `SYSTEM/BROWSERAUTOMATION.md` | Playwright, screenshots, testing |
| **CLI Architecture** | `SYSTEM/CLIFIRSTARCHITECTURE.md` | Command-line first principles |
| **Notification System** | `SYSTEM/THENOTIFICATIONSYSTEM.md` | Voice, visual notifications |
| **Tools Reference** | `SYSTEM/TOOLS.md` | Core tools inventory |

**USER Context:** `USER/` contains personal data—identity, contacts, health, finances, projects. See `USER/README.md` for full index.
**Project Routing:**

| Trigger | Path | Purpose |
|---------|------|---------|
|| "projects", "my projects", "project paths", "deploy" | `USER/PROJECTS/PROJECTS.md` | Technical project registry—paths, deployment, routing aliases |
|| "Telos", "life goals", "goals", "challenges" | `USER/TELOS/PROJECTS.md` | Life goals, challenges, predictions (Telos Life System) |

---

## Memory Curation (pai curate)

Rating-triggered drafts accumulate in `MEMORY/STAGING/` and require periodic review. Use `pai curate` to approve, reject, or archive staged memory drafts.

**Triggers:** User asks about staged memories, draft review, curate, memory hygiene, or approving/rejecting learning drafts.

```bash
pai curate          # Interactive review — list, approve/reject drafts
pai curate --list   # Show all pending drafts
```

**How drafts get created:**
- Explicit rating 8–10 → success-pattern draft (via inference, if transcript context ≥50 chars)
- Explicit rating 4–5 + corrections detected → correction draft (regex-only, no inference)
- Drafts expire automatically after 14 days if not reviewed

**Staging path:** `MEMORY/STAGING/` — state in `.staging-state.json`, rejections logged to `.rejections.jsonl`

---
---
