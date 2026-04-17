# PAI v5.0.0 — Public Release Plan

**Created:** 2026-04-17
**Source:** 3 Architect council agents (repo/install, config layer, codebase audit)
**Status:** Planning — fork decision pending

---

## Vision

PAI 5.0.0 is a public open-source release of the personal AI infrastructure system, installable by any CLI-comfortable developer who uses Claude Code. MIT/Apache license. Zero personal or company-specific content in the repository.

**What changes:** Configuration layer replaces hardcoded content. Installer replaces manual setup.
**What stays:** Algorithm, all hooks, all skills, all tools — generic framework unchanged.

---

## Decision: Fork the Repository

Create a **new public repo** (`pai` or similar) forked from the current codebase. The personal repo (`kai-cli/pai-config`) stays frozen at v4.9.0 as your live installation.

**Why fork, not in-place refactor:**
- Clean slate — no accumulated personal log files, git history with personal data
- Your personal PAI keeps all Your Company-specific optimizations working
- Public repo can be a clean generic system without risk to your live setup
- Framework improvements (Algorithm versions, security hooks) can be manually ported — ~5 min per bump

**Pending decisions:**
- [ ] Repo name: `pai`, `claude-pai`, `pai-framework`, or other?
- [ ] GitHub org/account: personal `kai-cli` or new org?

---

## Install Architecture (Agent 1)

### Install command
```bash
curl -fsSL https://pai.sh/install | bash
# or with custom location:
curl -fsSL https://pai.sh/install | PAI_HOME=~/Projects/pai bash
```

### What happens
1. Clone repo to `~/pai` (configurable via `PAI_HOME`)
2. Create symlink: `ln -s ~/pai ~/.claude`  
   *(Claude Code reads `~/.claude/` — symlink keeps it a live git repo)*
3. Run `PAI-Install/main.ts` interactive wizard
4. Generate user config files from templates
5. Build `settings.json` and `CLAUDE.md`

### Why `curl | bash` not npm/brew
- PAI must be a git repo post-install (for `git pull` upgrades)
- Bun already installed via Claude Code — no new runtime dependency
- oh-my-zsh proved this pattern at millions of users with the same constraint

### Upgrade
```bash
pai update
```
→ `git pull --ff-only` + `BuildSettings.ts` rebuild + run versioned migrations in `scripts/migrations/`

### Three-category file model
| Category | `git pull` touches? | User changes? | Examples |
|----------|-------------------|---------------|---------|
| **System** | Yes | No | hooks/*.ts, Algorithm/, skills/, config/hooks.jsonc |
| **User** | Never | Yes | PAI/USER/, config/identity.jsonc, .env |
| **Runtime** | Never | Generated | settings.json, CLAUDE.md, MEMORY/ |

### Template/instance pattern
- System: `config/identity.jsonc.template` (tracked, generic)
- User: `config/identity.jsonc` (gitignored, generated at install)
- Same as `.env.example → .env`

---

## Configuration Layer (Agent 2)

### The One New File: `config/domains.jsonc`

All hardcoded Your Company content collapses into a single user-editable file:

```jsonc
{
  // Define knowledge domains relevant to your work
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

  // Map project directory patterns to relevant domains
  "projectMapping": [
    { "pattern": "my-app", "domains": ["backend", "frontend"] },
    { "pattern": "infra", "domains": ["devops"] }
  ],

  // Projects to skip knowledge injection entirely
  "excludedProjects": ["personal-notes", "resume"],

  // Max domains injected per session (token budget)
  "maxDomainsPerSession": 3
}
```

### What this replaces
- `DOMAIN_KEYWORDS` in KnowledgeSync.hook.ts (R4)
- `DOMAIN_DESCRIPTIONS` in KnowledgeSync.hook.ts (R4)
- `PROJECT_DOMAIN_MAP` in knowledge-readback.ts (R3)
- `EXCLUDED_PROJECTS` in knowledge-readback.ts (R3)
- Domain definitions in KnowledgeHarvester.ts (R13)
- `DOMAIN_PATTERNS` in LocalContextFirst.hook.ts (R5)

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

### Four archetype starter configs ship in repo
- `config/starters/fullstack-domains.jsonc`
- `config/starters/datascience-domains.jsonc`
- `config/starters/devops-domains.jsonc`
- `config/starters/generic-domains.jsonc`

---

## Codebase Audit — What Must Change (Agent 3)

### RED: Must fix before public release (20 items)

| # | File | Issue |
|---|------|-------|
| R1 | `config/preferences.jsonc` | ~~AWS credentials~~ **DONE in v4.9.0** |
| R2 | `config/bedrock-known-good.jsonc` | ~~Personal AWS~~ **DONE in v4.9.0** |
| R3 | `hooks/lib/knowledge-readback.ts` | `EXCLUDED_PROJECTS` + `PROJECT_DOMAIN_MAP` hardcoded |
| R4 | `hooks/KnowledgeSync.hook.ts` | `DOMAIN_KEYWORDS` + `DOMAIN_DESCRIPTIONS` Your Company-specific |
| R5 | `hooks/LocalContextFirst.hook.ts` | Entire hook is Your Company-specific |
| R6 | `PAI/CONTEXT_ROUTING.md` | Entire Your Company/firmware section + cross-project memory paths |
| R7 | `PAI/PAIAGENTSYSTEM.md` | OpenWRT/Your Company agents section |
| R8 | `agents/StakeholderCommunicator.md` | "Deven", "Your Company", "Fortinet" throughout |
| R8 | `agents/ProductStrategist.md` | "Deven", "Your Company NPI programs" throughout |
| R8 | `agents/TechnicalReviewer.md` | "Deven", "Your Company/Fortinet" throughout |
| R9 | `PAI/Tools/Banner*.ts` (4 files) | Fallback hardcoded `kai-cli/pai-config` URL |
| R10 | `install.sh` | `kai-cli/pai-config` URL |
| R11 | `scripts/board-config.json` | Personal project library |
| R12 | `Plans/archive/` | Personal work plans tracked in git |
| R13 | `PAI/Tools/KnowledgeHarvester.ts` | Your Company domain definitions |
| R14 | `skills/CompetitiveIntel/` | Your Company Wireless throughout |
| R14 | `skills/StandardsTracker/` | TR-369 Your Company references |
| R14 | `skills/NPITracker/` | Your Company Pinnacle product line |
| R14 | `skills/WeeklyStatus/` | Fortinet leadership update |
| R15 | `skills/OneOnOne/` | "Deven" in workflow |
| R16 | `skills/Research/` | Your Company/firmware pre-check |
| R17 | `skills/PAI/SKILL.md` | `principal.name - User's name (Deven)` |
| R18 | `docs/` (multiple) | `kai-cli/pai-config` URLs throughout |
| R19 | `MEMORY/WISDOM/README.md` | "Deven's personal" references |
| R20 | `README.md` | `kai-cli/pai-config` clone URL |

### Dead code to delete
- `PAI/Tools/BannerRetro.ts` — unused legacy
- `PAI/Tools/BannerMatrix.ts` — unused legacy
- `PAI/Tools/BannerNeofetch.ts` — unused legacy
- `PAI/Tools/NeofetchBanner.ts` — unused legacy
- `Plans/archive/` — personal archived work plans
- `skills/SECUpdates/State/` — stale personal state

### Already clean (no work needed)
- All Algorithm files, MEMORYSYSTEM.md, THEHOOKSYSTEM.md
- config/hooks.jsonc, config/permissions.jsonc
- Generic skills (Research, Security, Thinking, Science)
- All test files, deploy.ts, board.ts

### Missing for release
- `LICENSE` (MIT)
- `CONTRIBUTING.md`
- `CUSTOMIZATION.md` — how to configure your domains
- `CHANGELOG.md`

---

## Implementation Sequence

```
Phase A: Fork + Strip (1 day)
  1. Fork repo (decide name/org)
  2. Remove all 20 RED items from tracked files
  3. Delete 4 dead banner files + Plans/archive/ + SECUpdates/State/
  4. Add LICENSE, update README, update install.sh URL

Phase B: Config Layer (half day)
  1. Create config/domains.jsonc + 4 starter configs
  2. Create hooks/lib/config-loader.ts
  3. Refactor KnowledgeSync.hook.ts (DOMAIN_KEYWORDS → config)
  4. Refactor knowledge-readback.ts (PROJECT_DOMAIN_MAP → config)
  5. Refactor LocalContextFirst.hook.ts (Your Company patterns → config)
  6. Refactor KnowledgeHarvester.ts (same domain externalization)

Phase C: Setup Wizard (half day)
  1. Create PAI-Install/main.ts (6-step interactive wizard)
  2. Create config/*.jsonc.template files
  3. Create PAI/USER/*.md.template files
  4. Create PAI/CONTEXT_ROUTING.md.template
  5. Update install.sh for curl|bash + clone + symlink

Phase D: Documentation (1-2 hours)
  1. CONTRIBUTING.md
  2. CUSTOMIZATION.md (how to configure domains)
  3. CHANGELOG.md (v5.0.0 entry)
  4. Update QUICKSTART.md for new install flow

Total: ~2 days of focused work
```

---

## Decoupling Note (Future — v6.0)

The Claude Code dependency is intentional and accepted for v5.0.0. Future decoupling (like Nous Research's Hermes model abstraction) would mean abstracting `PAI/Tools/Inference.ts` to support any model provider (Anthropic, OpenAI, Ollama). This is a v6.0 investigation, not v5.0 scope.

---

## Pending Before Starting

- [ ] Decide: fork repo name (`pai`, `claude-pai`, `pai-framework`?)
- [ ] Decide: GitHub account/org for public release
- [ ] Merge PR #2 and PR #3 to personal repo before forking
