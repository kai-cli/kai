# What's Different: KAI 4.8.0 vs. Daniel Miessler's Original

KAI (Personal AI Infrastructure) was originally created by [Daniel Miessler](https://danielmiessler.com), the creator of [Fabric](https://github.com/danielmiessler/fabric). His public release (v4.0.3) established the foundational architecture for turning Claude Code into a personalized AI assistant.

This fork has evolved significantly. Here's what changed, what was added, and what you gain by deploying KAI 4.8.0.

---

## At a Glance

| | Daniel's Original (v4.0.3) | This Fork (KAI) |
|---|---|---|
| **Skills** | 63 (12 categories) | <!-- KAI:counts:skills:begin -->79<!-- KAI:counts:skills:end --> (streamlined, no dead skills) |
| **Hooks** | 21 | <!-- KAI:counts:hooks:begin -->39<!-- KAI:counts:hooks:end --> (all through stderr wrapper) |
| **Agents** | ~6 generic | <!-- KAI:counts:agents:begin -->18<!-- KAI:counts:agents:end --> specialized (named personas) |
| **Algorithm** | v3.5.0 | <!-- KAI:algorithm-version:begin -->v3.13.0<!-- KAI:algorithm-version:end --> |
| **Context footprint** | ~19% at startup | Optimized with lazy loading |
| **Installer** | Drop-in `.claude/` directory | Interactive setup wizard with symlink |
| **Config management** | Single `settings.json` | 7 domain config files, auto-merged |
| **PII handling** | Personal data in repo | Gitignored, portable paths |
| **Security** | Hook-based validation | Extended: SecretScanner, GitHubWriteGuard, patterns.yaml |
| **EM/PLM workflows** | None | 1:1 notes, weekly status, decision log, NPI tracker |
| **AWS Bedrock** | Not supported | Optional, configured at install |

---

## Key Improvements

### 1. Clean Separation of Personal Data

The original shipped with the author's personal files embedded in the repo. This fork:

- **Gitignores all personal data** (`PAI/USER/`, `skills/PAI/USER/`)
- **Gitignores `settings.json`** — it's generated from 7 domain config files at install time
- **Portable paths** — hooks use `${PAI_DIR}` instead of hardcoded home directories
- **Generic defaults** — no personal names, timezones, or AWS profiles in tracked code

Your coworkers clone the repo, run the installer, and get their own identity without touching tracked files.

### 2. Interactive Installer

The original required manually copying a `.claude/` directory. KAI 4.6.0 includes:

- **`install.sh`** — bootstrap script that installs prerequisites (Bun, Git)
- **`PAI-Install/main.ts`** — 6-step interactive wizard:
  1. Symlink `~/.claude/` → repo (with backup of existing config)
  2. Configure identity (assistant name, your name, timezone)
  3. AWS Bedrock setup (optional — skip if using Anthropic direct)
  4. Create `PAI/USER/` scaffold with starter templates
  5. Build `settings.json` from domain config files
  6. Build `CLAUDE.md` from template

### 3. Domain-Based Configuration

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

`BuildSettings.ts` merges these into `settings.json` at session start. Edit the domain file, not the generated output.

### 4. Hook System Hardening

All <!-- KAI:counts:hooks:begin -->39<!-- KAI:counts:hooks:end --> hooks now go through `run-hook.sh`, which:

- **Redirects stderr to `/tmp/pai-hooks/`** — prevents "hook error" messages in Claude Code UI
- **Async flags on analytics hooks** — PromptAnalysis, RatingCapture, StopOrchestrator, and other inference-heavy hooks run in the background instead of blocking the UI for 15+ seconds
- **New hooks not in the original:**
  - `SecretScanner` — blocks credential leaks in prompts
  - `GitHubWriteGuard` — requires explicit confirmation for all GitHub mutations
  - `LocalContextFirst` — injects project context before web research
  - `FormatReminder` — enforces KAI output format compliance
  - `AlgorithmTracker` — tracks Algorithm phase progress
  - `PRDSync` — syncs PRD frontmatter to dashboard
  - `PromptAnalysis` — batched inference for session naming + tab titles
  - `PreCompact` — preserves critical context before compaction

### 5. Algorithm <!-- KAI:algorithm-version:begin -->v3.13.0<!-- KAI:algorithm-version:end -->

Upgraded from v3.5.0 with:

- **Effort tiers** — 6 levels (Micro through Comprehensive) with ISC count floors
- **ISC Quality Gates** — 7 mandatory gates before execution begins
- **Confidence tags** — `[E]`xplicit, `[I]`nferred, `[R]`everse-engineered on each criterion
- **PRD as system of record** — structured project documents with frontmatter tracking
- **Capability selection** — mandated skill/agent invocation (no text-only theater)
- **Context compaction** — automatic summarization at phase boundaries
- **Reflection JSONL** — structured learning capture after every Algorithm run

### 6. Named Agent System

18 specialized agents with defined personas, voice assignments, and focused capabilities:

| Agent | Role |
|-------|------|
| Architect | System design, constitutional principles |
| Engineer | TDD implementation, Fortune 10 patterns |
| Designer | UX/UI with shadcn/ui, accessibility |
| QATester | Browser-based verification |
| Pentester | Security assessment |
| ProductStrategist | Roadmap, feature trade-offs |
| TechnicalReviewer | Architecture evaluation |
| StakeholderCommunicator | Executive comms |
| 5 Research agents | Multi-model parallel research (Claude, Gemini, Grok, Perplexity, Codex) |
| Artist | Visual content creation |
| Intern | High-agency generalist |
| BrowserAgent | Parallel headless automation |
| UIReviewer | User story validation |

### 7. Engineering Manager Workflows

Purpose-built skills for technical leadership:

- **OneOnOne** — 1:1 meeting notes and growth tracking
- **WeeklyStatus** — Status report generation from project state
- **DecisionLog** — Structured decision capture with context and rationale
- **NPITracker** — NPI risk tracking and status generation
- **StandardsTracker** — TR-369/TR-069 compliance monitoring
- **CompetitiveIntel** — Competitor scanning and battlecard generation

### 8. Security Hardening

Beyond the original's SecurityValidator:

- **SecretScanner** — 14 credential patterns, blocks before submission
- **GitHubWriteGuard** — all push/PR/issue operations require AskUserQuestion confirmation + time-limited approval tokens
- **patterns.yaml** — path protection rules and command validation
- **MEMORY/SECURITY/** — security event audit log (gitignored)

### 9. Research & Analysis Pipeline

Multi-agent research with parallel execution:

- **Research skill** — quick/standard/extensive/deep modes
- **5 specialized researchers** — each uses a different AI model for diverse perspectives
- **Scraping** — Progressive escalation with Bright Data proxy
- **OSINT/Investigation** — Structured intelligence gathering
- **ContentAnalysis** — Wisdom extraction from videos, podcasts, articles

### 10. KAI Board (Dashboard)

`bun ~/.claude/scripts/board.ts` — visual dashboard on port 3333:

- Active/recent sessions with status
- Work items from PRDs
- Backlog tracking
- Session history

---

## What's NOT Included (By Design)

- **No personal data** — `PAI/USER/` is gitignored; created by installer
- **No API keys** — stored in environment or `.env` (gitignored)
- **No `settings.json`** — generated from domain configs at install
- **No session state** — sessions, tasks, learning signals are gitignored
- **No company-specific content — EM/PLM and workflow skills are generic frameworks

---

## Credits

KAI's core architecture — the Algorithm, TELOS framework, skill hierarchy, hook lifecycle, and CLAUDE.md approach — was designed by Daniel Miessler. This fork builds on that foundation with production hardening, professional workflow integration, and deployability improvements.
