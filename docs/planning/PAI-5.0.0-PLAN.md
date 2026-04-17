# PAI v5.0.0 — Public Release Plan

**Created:** 2026-04-17  
**Reviewed:** 2026-04-17 (two rounds)  
**Source:** 3 Architect council agents + principal review  
**Status:** Execution-ready pending fork decisions

---

## Prerequisites — Must Resolve Before Any Work

- [ ] **Repo name:** `pai`, `claude-pai`, `pai-framework`?
- [ ] **GitHub org/account:** personal `kai-cli` or new org?
- [ ] **Install URL:** final repo URL locks the `install.sh` content and all docs
- [ ] **License:** MIT (single). Not dual — pick MIT and ship one `LICENSE` file consistently.
- [ ] **Merge PR #2 (v4.8.0) to personal repo**
- [ ] **Merge PR #3 (v4.9.0) to personal repo**
- [ ] **Verify symlink compatibility:** test that Claude Code resolves hooks, settings.json, and CLAUDE.md correctly when `~/.claude` is a symlink (not a directory). Block Phase A on this result.

---

## Vision

PAI 5.0.0 is a public open-source release of the personal AI infrastructure system, installable by any CLI-comfortable developer who uses Claude Code. MIT license. Zero personal or company-specific content in the repository.

**What changes:** Configuration layer replaces hardcoded content. Installer replaces manual setup.  
**What stays:** Algorithm, all hooks, all skills, all tools — generic framework unchanged.

---

## Decision: Fork the Repository

Create a **new public repo** forked from the current codebase. The personal repo (`kai-cli/pai-config`) stays frozen at v4.9.0 as your live installation.

**Why fork, not in-place refactor:**
- Clean slate — no accumulated personal log files, git history with personal data
- Your personal PAI keeps all Your Company-specific optimizations working
- Public repo can be a clean generic system without risk to your live setup
- Framework improvements (Algorithm versions, security hooks) can be manually ported — ~5 min per bump

---

## Install Architecture

### Install command
```bash
# Provisional — URL finalizes once org/repo name is decided
curl -fsSL https://raw.githubusercontent.com/ORG/REPO/main/install.sh | bash

# Custom install location
curl -fsSL ... | PAI_HOME=~/Projects/pai bash
```

### ~/.claude handling — three cases

**Case A: ~/.claude/ does not exist (fresh machine)**
```bash
git clone REPO ~/pai
ln -s ~/pai ~/.claude
```

**Case B: ~/.claude/ is a regular directory (existing Claude Code user — most common)**

Backup the entire directory first, then copy (not move) known reusable files:
```bash
# 1. Move entire old dir to backup — backup stays intact as complete rollback artifact
mv ~/.claude ~/.claude.pre-pai.backup

# 2. Clone new repo
git clone REPO ~/pai

# 3. Copy known reusable files from backup into new install
# (copy, not move — backup remains a full rollback point)
for f in projects history.jsonl sessions/ todos/; do
  cp -r ~/.claude.pre-pai.backup/$f ~/pai/ 2>/dev/null || true
done

# 4. Symlink
ln -s ~/pai ~/.claude

echo "Original ~/.claude backed up to ~/.claude.pre-pai.backup"
echo "To revert: rm ~/.claude && mv ~/.claude.pre-pai.backup ~/.claude"
```

Note: other files in the backup (custom scripts, etc.) are not migrated — they remain in the backup for the user to manually recover. The backup is never deleted by the installer.

**Case C: ~/.claude/ is already a symlink**
```bash
EXISTING=$(readlink ~/.claude)
if git -C "$EXISTING" remote get-url origin 2>/dev/null | grep -q "pai"; then
  echo "PAI already installed at $EXISTING. Run: pai update"
  exit 0
else
  echo "~/.claude is a symlink to $EXISTING. Move it manually or set PAI_HOME."
  exit 1
fi
```

### Rollback / uninstall
```bash
# Revert to pre-PAI state (Case B only)
rm ~/.claude                              # remove symlink
mv ~/.claude.pre-pai.backup ~/.claude    # restore original directory
rm -rf ~/pai                             # remove PAI clone

# Full uninstall (fresh install, no backup)
rm ~/.claude                              # remove symlink
rm -rf ~/pai
```

### Upgrade
```bash
pai update
```

Sequence (order matters):
1. `git pull --ff-only origin main` — fail loudly if local system file changes exist
2. `BuildSettings.ts` — rebuild settings.json from updated system config + existing user config
3. Run pending migrations: `scripts/migrations/*.ts` in version order

**Conflict policy:** System files (`hooks/*.ts`, `skills/`, `PAI/Algorithm/`) are read-only for users. Customizations go in `hooks/user/` (gitignored) or `config/preferences.local.jsonc`. If `git pull --ff-only` fails due to local system file changes, print a clear error:
> "Local changes found in system files. Move customizations to hooks/user/ then re-run pai update."

The upgrade never force-pushes or silently discards changes.

### Three-category file model
| Category | `git pull` touches? | User changes? | Examples |
|----------|-------------------|---------------|---------|
| **System** | Yes | No | hooks/*.ts, Algorithm/, skills/, config/hooks.jsonc |
| **User** | Never | Yes | PAI/USER/, config/identity.jsonc, hooks/user/*.ts, .env |
| **Runtime** | Never | Generated | settings.json, CLAUDE.md, MEMORY/ |

### Template/instance pattern
- System: `config/identity.jsonc.template` (tracked, generic)
- User: `config/identity.jsonc` (gitignored, generated at install)
- Same as `.env.example → .env`

---

## Configuration Layer

### The One New File: `config/domains.jsonc`

All hardcoded Your Company content collapses into a single user-editable file:

```jsonc
{
  "definitions": {
    "backend": {
      "keywords": ["rails", "django", "postgres", "redis", "api"],
      "description": "Backend services and APIs"
    },
    "devops": {
      "keywords": ["docker", "kubernetes", "ci", "deploy", "terraform"],
      "description": "Infrastructure and deployment"
    }
  },
  "projectMapping": [
    { "pattern": "my-app", "domains": ["backend", "frontend"] }
  ],
  "excludedProjects": ["personal-notes", "resume"],
  "maxDomainsPerSession": 3
}
```

### What this replaces
- `DOMAIN_KEYWORDS` + `DOMAIN_DESCRIPTIONS` in KnowledgeSync.hook.ts
- `PROJECT_DOMAIN_MAP` + `EXCLUDED_PROJECTS` in knowledge-readback.ts
- Domain definitions in KnowledgeHarvester.ts
- `DOMAIN_PATTERNS` in LocalContextFirst.hook.ts

### New lib: `hooks/lib/config-loader.ts`
Single module with caching that all hooks import. No hook reads domain config directly.

### hooks/user/ — loading mechanism (Phase B deliverable)

User hook extensions live in `hooks/user/` (gitignored). The loading mechanism:
- `config/hooks.jsonc` ships with a `userHooks` registration field (empty by default)
- User registers custom hooks there: `"userHooks": [{ "event": "SessionEnd", "hook": "hooks/user/MyHook.hook.ts", "async": true }]`
- `BuildSettings.ts` merges userHooks into the generated `settings.json` hooks section alongside system hooks
- User hooks append to system hooks — they never replace or disable them

This is a **Phase B implementation deliverable**, not just policy.

### config/preferences.local.jsonc — merge behavior (already implemented)
`BuildSettings.ts` already merges `preferences.local.jsonc` over `preferences.jsonc` when building `settings.json`. This is live in the current codebase. Phase C only needs to document it in the setup wizard output and CUSTOMIZATION.md — no new implementation.

### LocalContextFirst.hook.ts — generic version design
The generic version reads `projectMapping` from `domains.jsonc` and injects context hints when a session starts in a recognized project. If the user hasn't defined `localPaths` in their config, the hook exits silently (zero output, zero cost). This is a Phase B refactor, not a new feature.

### pai setup wizard — 6 steps, 2 required
```
Step 1/6: What's your name?
Step 2/6: Choose your developer archetype:
  1. Full-Stack Web Developer     (5 domains, ~150 keywords)
  2. Data Scientist / ML Engineer (6 domains, ~140 keywords)
  3. DevOps / Platform Engineer   (6 domains, ~150 keywords)
  4. Generic                      (3 domains, ~50 keywords)
Steps 3-6: [optional] Bedrock, projects, custom domains, review
```

Generates 8 files from templates. Idempotent on re-run.

**PAI-Install/main.ts:** A stub exists in the current repo. Phase C is a **full rewrite** to support the 6-step wizard, archetype selection, and template rendering.

### Four archetype starter configs ship in repo
- `config/starters/fullstack-domains.jsonc`
- `config/starters/datascience-domains.jsonc`
- `config/starters/devops-domains.jsonc`
- `config/starters/generic-domains.jsonc`

---

## Codebase Audit — What Must Change

### R14 Skills — Disposition

| Skill | Disposition | Action |
|-------|-------------|--------|
| `CompetitiveIntel/` | Move to `skills-examples/` | Domain-specific template, not active skill |
| `StandardsTracker/` | Move to `skills-examples/` | Same |
| `NPITracker/` | Move to `skills-examples/` | Same |
| `WeeklyStatus/` | Genericize | Replace "Fortinet leadership" with `{PRINCIPAL.ORG}` |
| `OneOnOne/` | Keep, fix | Replace "Deven" with `{PRINCIPAL.NAME}` |
| `DecisionLog/` | Keep, fix | Replace "Deven" with `{PRINCIPAL.NAME}` |

**`skills-examples/` exclusion guarantee:** Files in `skills-examples/` must not be indexed, auto-loaded, or triggerable as active skills. The skill discovery mechanism only scans `skills/` (not `skills-examples/`). This must be verified in Phase A before shipping.

### RED: Must fix before public release

| # | File | Fix |
|---|------|-----|
| ~~R1~~ | ~~config/preferences.jsonc~~ | **DONE in v4.9.0** |
| ~~R2~~ | ~~config/bedrock-known-good.jsonc~~ | **DONE in v4.9.0** |
| R3 | `hooks/lib/knowledge-readback.ts` | Replace with config-loader.ts (Phase B) |
| R4 | `hooks/KnowledgeSync.hook.ts` | Replace with config-loader.ts (Phase B) |
| R5 | `hooks/LocalContextFirst.hook.ts` | Rewrite as config-driven (Phase B) |
| R6 | `PAI/CONTEXT_ROUTING.md` | Strip Your Company section; generate from template |
| R7 | `PAI/PAIAGENTSYSTEM.md` | Remove OpenWRT/Your Company agents section |
| R8 | `agents/Stakeholder*.md`, `ProductStrategist.md`, `TechnicalReviewer.md` | Replace `{PRINCIPAL.NAME}`, strip company refs |
| R9 | `PAI/Tools/Banner*.ts` (4 files) | Change fallback URL to public org URL |
| R10 | `install.sh` | Update URL to public repo |
| R11 | `scripts/board-config.json` | Replace library with empty array + comment |
| R12 | `Plans/archive/` | Delete; add to .gitignore |
| R13 | `PAI/Tools/KnowledgeHarvester.ts` | Replace with config-loader.ts (Phase B) |
| R14 | Skills | See disposition table above |
| R15–R20 | Various docs + README | Replace `kai-cli` URLs, personal names |

**Spot check before shipping:**
- `config/spinner-tips.json` and `config/spinner-verbs.json` — scan for personal content
- `PAI/PIPELINES/*.yaml` — scan for personal refs

### Dead code to delete
- `PAI/Tools/BannerRetro.ts`, `BannerMatrix.ts`, `BannerNeofetch.ts`, `NeofetchBanner.ts`
- `Plans/archive/`
- `skills/SECUpdates/State/`

### MEMORY/ stub structure for new installs
```
MEMORY/
├── README.md          (tracked — explains the memory system)
├── KNOWLEDGE/.gitkeep (tracked)
├── LEARNING/.gitkeep  (tracked)
├── RELATIONSHIP/.gitkeep (tracked)
├── SECURITY/.gitkeep  (tracked)
├── STAGING/.gitkeep   (tracked)
├── STATE/.gitkeep     (tracked)
└── WORK/.gitkeep      (tracked)
```
All subdirectory contents (actual memory files) are gitignored.

### .gitignore (Phase A deliverable)
```gitignore
# User config (generated at install)
PAI/USER/
config/identity.jsonc
config/preferences.jsonc
config/notifications.jsonc
config/preferences.local.jsonc
.env
settings.json
CLAUDE.md

# Runtime state
MEMORY/STATE/
MEMORY/WORK/
MEMORY/LEARNING/
MEMORY/RELATIONSHIP/
MEMORY/SECURITY/
MEMORY/RESEARCH/
MEMORY/STAGING/
projects/
history.jsonl
sessions/
tasks/

# User extensions
Plans/archive/
skills/SECUpdates/State/
skills/_USER/
hooks/user/
```
Verify against a clean install: no personal content should appear in `git status` after first run.

---

## Implementation Sequence

```
Phase A: Fork + Strip + History Clean (1 day)
  1. Fork repo (org/name decided)
  2. Run git filter-repo / BFG — remove R1/R2 credential history from fork
     (file content fixed in v4.9.0 but history must be purged before first public push)
  3. Verify symlink compatibility with Claude Code (block rest of Phase A on result)
  4. Remove all RED items from tracked files
  5. Delete dead code (4 banner files, Plans/archive/, SECUpdates/State/)
  6. Move R14 skills to skills-examples/; verify skills-examples/ is excluded from skill discovery
  7. Add MEMORY/ stub skeleton with .gitkeep files
  8. Finalize .gitignore; verify clean install produces no personal content in git status
  9. Spot check spinner-tips.json, spinner-verbs.json, PIPELINES/*.yaml
  10. Add LICENSE (MIT)
  11. Update README, install.sh with public repo URL

Phase B: Config Layer + hooks/user/ loader (half day)
  1. Create config/domains.jsonc + 4 starter configs
  2. Create hooks/lib/config-loader.ts
  3. Refactor KnowledgeSync.hook.ts (DOMAIN_KEYWORDS → config)
  4. Refactor knowledge-readback.ts (PROJECT_DOMAIN_MAP → config)
  5. Refactor LocalContextFirst.hook.ts (generic pattern injection)
  6. Refactor KnowledgeHarvester.ts (same domain externalization)
  7. Implement hooks/user/ loading mechanism in BuildSettings.ts + config/hooks.jsonc

Phase C: Setup Wizard + Install (half day)
  1. Rewrite PAI-Install/main.ts (6-step wizard, archetype selection, template rendering)
  2. Create config/*.jsonc.template files
  3. Create PAI/USER/*.md.template files
  4. Create PAI/CONTEXT_ROUTING.md.template
  5. Update install.sh for curl|bash + clone + symlink (all 3 cases + rollback instructions)
  6. End-to-end test on a machine with existing ~/.claude/

Phase D: Documentation (1-2 hours)
  1. CONTRIBUTING.md
  2. CUSTOMIZATION.md (how to configure domains, hooks/user/, preferences.local.jsonc)
  3. CHANGELOG.md (v5.0.0 entry)
  4. Update QUICKSTART.md for new install flow

Total: ~2 days of focused work
```

---

## Decoupling Note (Future — v6.0)

The Claude Code dependency is intentional and accepted for v5.0.0. Future decoupling would mean abstracting `PAI/Tools/Inference.ts` to support any model provider (Anthropic, OpenAI, Ollama) — similar to how Nous Research's Hermes abstracts model providers. This is a v6.0 investigation, not v5.0 scope.
