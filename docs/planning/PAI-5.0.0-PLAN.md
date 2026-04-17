# PAI v5.0.0 — Public Release Plan

**Created:** 2026-04-17
**Reviewed:** 2026-04-17 — issues addressed
**Source:** 3 Architect council agents (repo/install, config layer, codebase audit)
**Status:** Planning — fork decisions pending (see bottom)

---

## Vision

PAI 5.0.0 is a public open-source release of the personal AI infrastructure system, installable by any CLI-comfortable developer who uses Claude Code. MIT/Apache license. Zero personal or company-specific content in the repository.

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

**Pending decisions (must resolve before starting):**
- [ ] Repo name: `pai`, `claude-pai`, `pai-framework`, or other?
- [ ] GitHub org/account: personal `kai-cli` or new org?
- [ ] Install URL: `https://pai.sh/install` (needs domain) or raw GitHub URL?

---

## Install Architecture

### Install command
```bash
curl -fsSL https://raw.githubusercontent.com/ORG/pai/main/install.sh | bash
# or with custom location:
curl -fsSL ... | PAI_HOME=~/Projects/pai bash
```

### Installer flow — existing ~/.claude/ handling (CRITICAL)

Every existing Claude Code user has `~/.claude/` as a directory. The symlink step is the most likely first-run failure. The installer must handle all three cases:

```bash
# Case A: ~/.claude/ does not exist (fresh machine)
git clone REPO ~/pai
ln -s ~/pai ~/.claude

# Case B: ~/.claude/ is a regular directory (existing Claude Code user)
echo "~/.claude/ already exists. PAI will back it up and install."
mv ~/.claude ~/.claude.pre-pai.backup
git clone REPO ~/pai
# Migrate existing Claude Code data into the new repo
mv ~/.claude.pre-pai.backup/settings.json ~/pai/settings.json.pre-pai 2>/dev/null
mv ~/.claude.pre-pai.backup/projects ~/pai/projects 2>/dev/null
mv ~/.claude.pre-pai.backup/history.jsonl ~/pai/history.jsonl 2>/dev/null
ln -s ~/pai ~/.claude
echo "Original ~/.claude backed up to ~/.claude.pre-pai.backup"

# Case C: ~/.claude/ is already a symlink
EXISTING=$(readlink ~/.claude)
if git -C "$EXISTING" remote get-url origin 2>/dev/null | grep -q "pai"; then
  echo "PAI already installed at $EXISTING. Run: pai update"
  exit 0
else
  echo "~/.claude is a symlink to $EXISTING. Move it first or set PAI_HOME."
  exit 1
fi
```

### Symlink and Claude Code compatibility
Claude Code resolves hooks, settings.json, and CLAUDE.md from `~/.claude/`. Symlink traversal must be verified to work with Claude Code's hook resolution. **Add an explicit test in Phase A:** install into a temp dir via symlink and verify hooks fire correctly.

### What happens after symlink
1. Run `PAI-Install/main.ts` interactive wizard
2. Generate user config files from templates
3. Build `settings.json` and `CLAUDE.md` via BuildSettings.ts

### Upgrade
```bash
pai update
```

**Conflict handling policy:**
- `git pull --ff-only` will error if user has modified system files (hooks/*.ts, skills/, etc.)
- Policy: **system files are read-only for users.** Customizations go in `hooks/user/` (gitignored) or `config/preferences.local.jsonc`.
- If `git pull --ff-only` fails, the upgrade prints a clear error: "You have local changes to system files. Move them to hooks/user/ first, then re-run pai update."
- Upgrade never force-pushes or silently discards changes.

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

### LocalContextFirst.hook.ts — generic version design
The current hook detects Your Company-specific topics in the prompt and injects local context paths. The generic version does the same thing but reads patterns from `config/domains.jsonc`.

**Generic behavior:**
1. Read `projectMapping` from domains.jsonc
2. Check if current prompt mentions keywords from any mapped domain
3. If match: inject a brief reminder: "Local knowledge available at `[path]` — check before searching"
4. The paths are defined by the user in `config/domains.jsonc` under an optional `localPaths` field

If the user hasn't configured `localPaths`, the hook does nothing (zero output). This makes it genuinely optional.

### New lib: `hooks/lib/config-loader.ts`
Single module with caching that all hooks import. No hook reads domain config directly.

### `pai setup` Wizard — 6 Steps, 2 Required

```
Step 1/6: What's your name? [enter]
Step 2/6: Choose your developer archetype:
  1. Full-Stack Web Developer     (5 domains, ~150 keywords)
  2. Data Scientist / ML Engineer (6 domains, ~140 keywords)
  3. DevOps / Platform Engineer   (6 domains, ~150 keywords)
  4. Generic                      (3 domains, ~50 keywords)
Steps 3-6: [optional] Bedrock, projects, custom domains, review
```

Generates 8 files from templates in one pass. Idempotent on re-run.

**PAI-Install/main.ts note:** A stub already exists in the current repo. Phase C is a full rewrite to support the 6-step wizard, archetype selection, and template rendering — not an extension of the existing stub.

### Four archetype starter configs ship in repo
- `config/starters/fullstack-domains.jsonc`
- `config/starters/datascience-domains.jsonc`
- `config/starters/devops-domains.jsonc`
- `config/starters/generic-domains.jsonc`

---

## Codebase Audit — What Must Change

### R14 Skills — Disposition Decision

The four Your Company-vertical skills need an explicit call before Phase A:

| Skill | Verdict | Rationale |
|-------|---------|-----------|
| `CompetitiveIntel/` | **Move to `skills-examples/`** | Useful template showing how to build domain-specific competitive tracking. Keep as example, not shipped as active skill. |
| `StandardsTracker/` | **Move to `skills-examples/`** | Same — demonstrates standards tracking pattern, not generically useful |
| `NPITracker/` | **Move to `skills-examples/`** | Highly specific to Your Company NPI process |
| `WeeklyStatus/` | **Genericize** | Weekly status reporting is universal for any EM. Replace "Fortinet leadership" with `{PRINCIPAL.ORG}` template variable. |
| `OneOnOne/` | **Keep, fix "YourName"** | Generically useful EM skill — replace name with `{PRINCIPAL.NAME}` |
| `DecisionLog/` | **Keep, fix "YourName"** | Generically useful EM skill — replace name with `{PRINCIPAL.NAME}` |

### RED: Must fix before public release

| # | File | Fix |
|---|------|-----|
| ~~R1~~ | ~~config/preferences.jsonc~~ | **DONE in v4.9.0** |
| ~~R2~~ | ~~config/bedrock-known-good.jsonc~~ | **DONE in v4.9.0** |
| R3 | `hooks/lib/knowledge-readback.ts` | Replace with config-loader.ts (Phase B) |
| R4 | `hooks/KnowledgeSync.hook.ts` | Replace with config-loader.ts (Phase B) |
| R5 | `hooks/LocalContextFirst.hook.ts` | Rewrite as config-driven (Phase B) |
| R6 | `PAI/CONTEXT_ROUTING.md` | Strip Your Company section; replace with generated template |
| R7 | `PAI/PAIAGENTSYSTEM.md` | Remove OpenWRT/Your Company agents section |
| R8 | `agents/Stakeholder*.md`, `ProductStrategist.md`, `TechnicalReviewer.md` | Replace `{PRINCIPAL.NAME}`, strip company refs |
| R9 | `PAI/Tools/Banner*.ts` (4 files) | Change fallback URL to public org URL |
| R10 | `install.sh` | Update URL to public repo |
| R11 | `scripts/board-config.json` | Replace library with empty array + comment |
| R12 | `Plans/archive/` | Delete entirely, add to .gitignore |
| R13 | `PAI/Tools/KnowledgeHarvester.ts` | Replace with config-loader.ts (Phase B) |
| R14 | Skills | See disposition table above |
| R15–R20 | Various docs + README | Replace `kai-cli` URLs, personal names |

**Spot check before shipping:**
- `config/spinner-tips.json` and `config/spinner-verbs.json` — scan for personal content
- Any YAML files in PAI/PIPELINES/ — scan for personal refs

### Dead code to delete
- `PAI/Tools/BannerRetro.ts`, `BannerMatrix.ts`, `BannerNeofetch.ts`, `NeofetchBanner.ts`
- `Plans/archive/` (+ add to .gitignore)
- `skills/SECUpdates/State/` (+ add to .gitignore)

### MEMORY/ stub structure for new installs
The public repo needs a stub MEMORY/ skeleton so fresh installs have the right directory structure. Current repo has real MEMORY content (gitignored). Phase A must add:

```
MEMORY/
├── README.md          (tracked — explains the memory system)
├── KNOWLEDGE/         (tracked — .gitkeep)
├── LEARNING/          (tracked — .gitkeep)
├── RELATIONSHIP/      (tracked — .gitkeep)
├── SECURITY/          (tracked — .gitkeep)
├── STAGING/           (tracked — .gitkeep)
├── STATE/             (tracked — .gitkeep)
└── WORK/              (tracked — .gitkeep)
```

### .gitignore audit (Phase A deliverable)
The three-category model requires the public .gitignore to cover:
```gitignore
# User config (generated at install, never committed)
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
Plans/archive/
skills/SECUpdates/State/
skills/_USER/

# User hook extensions
hooks/user/

# Build artifacts
node_modules/
*.bun-build
```

This must be verified against a clean install to confirm no personal content leaks on first `git push`.

---

## Implementation Sequence (Revised)

```
Prerequisites (before writing any code):
  [ ] Decide repo name + GitHub org
  [ ] Decide install URL (pai.sh or raw GitHub)
  [ ] Merge PR #2 and PR #3 to personal repo

Phase A: Fork + Strip + History Clean (1 day)
  1. Fork repo with new name/org
  2. Run git filter-repo / BFG on fork to remove credential history
     (R1/R2 files still in git history even though content is fixed)
  3. Verify symlink install works with existing ~/.claude/ (Cases A, B, C)
  4. Remove all 20 RED items from tracked files
  5. Delete dead code (4 banners, Plans/archive/, SECUpdates/State/)
  6. Add MEMORY/ stub skeleton + .gitkeep files
  7. Audit + finalize .gitignore
  8. Spot check spinner-tips.json, spinner-verbs.json, PIPELINES/*.yaml
  9. Add LICENSE (MIT)

Phase B: Config Layer (half day)
  1. Create config/domains.jsonc + 4 starter configs
  2. Create hooks/lib/config-loader.ts
  3. Refactor KnowledgeSync.hook.ts (DOMAIN_KEYWORDS → config)
  4. Refactor knowledge-readback.ts (PROJECT_DOMAIN_MAP → config)
  5. Refactor LocalContextFirst.hook.ts (generic pattern injection)
  6. Refactor KnowledgeHarvester.ts (same domain externalization)

Phase C: Setup Wizard + Install (half day)
  1. Rewrite PAI-Install/main.ts (full 6-step wizard, archetype selection)
  2. Create config/*.jsonc.template files
  3. Create PAI/USER/*.md.template files
  4. Create PAI/CONTEXT_ROUTING.md.template
  5. Update install.sh for curl|bash + clone + symlink (all 3 cases)
  6. Test end-to-end on a machine with existing ~/.claude/

Phase D: Documentation (1-2 hours)
  1. CONTRIBUTING.md
  2. CUSTOMIZATION.md (how to configure domains)
  3. CHANGELOG.md (v5.0.0 entry)
  4. Update QUICKSTART.md for new install flow

Total: ~2 days of focused work
```

---

## Decoupling Note (Future — v6.0)

The Claude Code dependency is intentional and accepted for v5.0.0. Future decoupling would mean abstracting `PAI/Tools/Inference.ts` to support any model provider (Anthropic, OpenAI, Ollama) — similar to how Nous Research's Hermes abstracts model providers. This is a v6.0 investigation, not v5.0 scope.

---

## Pending Before Starting

- [ ] Repo name: `pai`, `claude-pai`, `pai-framework`?
- [ ] GitHub org/account for public release?
- [ ] Install URL: need a domain, or use raw.githubusercontent.com?
- [ ] Merge PR #2 (v4.8.0) to personal repo
- [ ] Merge PR #3 (v4.9.0) to personal repo
