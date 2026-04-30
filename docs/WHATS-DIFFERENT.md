# What KAI Includes

KAI turns Claude Code into a structured, reliable AI assistant for engineering and research work. This document covers what's built in and why each piece exists.

---

## At a Glance

| Capability | Details |
|-----------|---------|
| **Skills** | <!-- KAI:counts:skills:begin -->79<!-- KAI:counts:skills:end --> modules across Research, Security, Thinking, EM/PLM, Analysis, Writing |
| **Hooks** | <!-- KAI:counts:hooks:begin -->40<!-- KAI:counts:hooks:end --> lifecycle hooks (security guards, analytics, formatting, cleanup) |
| **Agents** | <!-- KAI:counts:agents:begin -->18<!-- KAI:counts:agents:end --> named specialists (Architect, Engineer, 5 researchers, Pentester, etc.) |
| **Algorithm** | <!-- KAI:algorithm-version:begin -->v3.13.0<!-- KAI:algorithm-version:end --> — 7-phase execution with ISC quality gates |
| **Config** | 7 domain config files, auto-merged into `settings.json` at session start |
| **Installer** | 7-step interactive wizard with archetype selection, identity setup, Bedrock config |
| **Security** | SecretScanner, GitHubWriteGuard, SecurityValidator, path protection |

---

## Core Capabilities

### 1. The Algorithm (<!-- KAI:algorithm-version:begin -->v3.13.0<!-- KAI:algorithm-version:end -->)

For complex tasks, KAI uses a 7-phase execution framework:
**Observe** → **Think** → **Plan** → **Build** → **Execute** → **Verify** → **Learn**

Each task gets Ideal State Criteria (ISC) — verifiable checkboxes with quality gates. This makes KAI systematically reliable rather than just "AI that tries."

- **6 effort tiers** — Micro through Comprehensive, each with ISC count floors
- **7 ISC Quality Gates** — mandatory before execution begins
- **PRD as system of record** — structured documents with frontmatter tracking across sessions
- **Reflection JSONL** — structured learning capture after every Algorithm run
- **Context compaction** — automatic summarization at phase boundaries

### 2. Domain-Based Configuration

Instead of one monolithic `settings.json`, configuration is split into purpose-specific files:

| File | Controls |
|------|----------|
| `config/identity.jsonc` | Assistant name, user name, timezone |
| `config/hooks.jsonc` | All hook registrations and lifecycle events |
| `config/permissions.jsonc` | Tool permissions (allow/deny/ask) |
| `config/notifications.jsonc` | Alert routing and channels |
| `config/preferences.jsonc` | Environment vars, voice, memory, Bedrock |
| `config/spinner-verbs.json` | Custom spinner text |
| `config/spinner-tips.json` | Custom tip messages |

`BuildSettings.ts` merges these into `settings.json` at session start. Edit the domain file, not the generated output. Changes take effect automatically next session.

### 3. Hook System (<!-- KAI:counts:hooks:begin -->40<!-- KAI:counts:hooks:end --> hooks)

All hooks run through `run-hook.sh`, which redirects stderr to `/tmp/pai-hooks/` (no "hook error" messages in the UI) and supports async flags for inference-heavy work.

**Security hooks:**
- `SecretScanner` — blocks credential leaks in prompts (14 patterns)
- `GitHubWriteGuard` — requires confirmation + time-limited approval tokens for all git mutations
- `SecurityValidator` — path protection and command validation on every tool call
- `SecretOutputDetector` — scans tool output for leaked credentials
- `WebFetchGuard` — validates URLs before external fetches

**Context hooks:**
- `LoadContext` — injects relationship context, learning readback, active work summary at session start
- `LocalContextFirst` — injects domain knowledge before web research
- `KnowledgeSync` — incremental cross-project knowledge distillation at session end
- `ReadTracker` — tracks frequently-read files for routing candidate analysis

**Intelligence hooks:**
- `FormatReminder` — enforces KAI output format compliance
- `AlgorithmTracker` — tracks Algorithm phase progress
- `RatingCapture` — captures explicit and implicit session ratings
- `PRDSync` — syncs PRD frontmatter to dashboard
- `PromptAnalysis` — batched inference for session naming and tab titles
- `PreCompact` — preserves critical context before compaction
- `ModeClassifier` — classifies effort tier from prompt

### 4. Named Agent System (<!-- KAI:counts:agents:begin -->18<!-- KAI:counts:agents:end --> specialists)

Spawned automatically when the task matches:

| Agent | Role |
|-------|------|
| Architect | System design, constitutional principles |
| Engineer | TDD implementation, Fortune 10 patterns |
| Designer | UX/UI with shadcn/ui, accessibility |
| QATester | Browser-based verification (Gate 4) |
| Pentester | Security assessment |
| ProductStrategist | Roadmap, feature trade-offs |
| TechnicalReviewer | Architecture evaluation |
| StakeholderCommunicator | Executive comms |
| 5 Research agents | Multi-model parallel research (Claude, Gemini, Grok, Perplexity, Codex) |
| Artist | Visual content creation |
| Intern | High-agency generalist |
| BrowserAgent | Parallel headless browser automation |
| UIReviewer | User story validation |

### 5. Engineering Manager Workflows

Purpose-built skills for technical leadership:

- **OneOnOne** — 1:1 meeting notes and growth tracking
- **WeeklyStatus** — Status report generation from project state
- **DecisionLog** — Structured decision capture with context and rationale
- **NPITracker** — NPI risk tracking and status generation

### 6. Interactive Installer

`install.sh` → `PAI-Install/main.ts` — 7-step wizard:

1. Symlink `~/.claude/` → repo (with backup of existing config)
2. **Archetype selection** — choose domain config template (fullstack, devops, datascience, generic)
3. Configure identity (assistant name, your name, timezone)
4. AWS Bedrock setup (optional)
5. Create `PAI/USER/` scaffold with starter templates
6. Build `settings.json` from domain config files
7. Build `CLAUDE.md` from template

Detects existing installs and shows what was preserved on upgrade.

### 7. Clean Separation of Personal Data

- `PAI/USER/` is gitignored — created by installer, never committed
- `settings.json` is gitignored — generated from domain configs
- Portable paths throughout (`${PAI_DIR}` not hardcoded home directories)
- No personal names, timezones, or AWS profiles in tracked code

### 8. Security Hardening

- **`patterns.yaml`** — path protection rules and command validation
- **`MEMORY/SECURITY/`** — security event audit log (gitignored)
- **GitHubWriteGuard** — all push/PR/issue operations require explicit confirmation
- **SecretScanner** — 14 credential patterns, blocks before submission

---

## Credits

KAI's core architecture — the Algorithm, TELOS framework, skill hierarchy, hook lifecycle, and CLAUDE.md approach — was designed by [Daniel Miessler](https://danielmiessler.com). KAI builds on that foundation with production hardening, team deployability, and professional workflow integration.
