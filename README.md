# KAI.8.0 — Personal AI Infrastructure

> A production-ready Claude Code configuration system. Fork of Daniel Miessler's [original project](https://danielmiessler.com), hardened for team deployment.

## Prerequisites

- macOS or Linux
- [Claude Code](https://claude.ai/code) CLI installed (`claude --version` to check)
- Anthropic API key set in your shell profile: `export ANTHROPIC_API_KEY="sk-ant-..."`
  - Get a key at [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
  - Or AWS Bedrock credentials (configured during install)

## Install

```bash
git clone https://github.com/kai-cli/kai ~/kai
bash ~/kai/install.sh
```

The installer symlinks `~/.claude/` to your repo, walks you through identity setup (your name, assistant name, timezone), optionally configures AWS Bedrock, and builds your `settings.json` from domain config files.

**New to KAI?** See **[docs/QUICKSTART.md](docs/QUICKSTART.md)** for the full getting-started guide.

## What's Inside

| Directory | Contents |
|-----------|----------|
| `PAI/` | Core system: Algorithm <!-- KAI:algorithm-version:begin -->v3.13.0<!-- KAI:algorithm-version:end -->, context routing, system docs |
| `skills/` | <!-- KAI:counts:skills:begin -->41<!-- KAI:counts:skills:end --> skill modules (Research, Security, Writing, Analysis, EM/PLM workflows) |
| `hooks/` | <!-- KAI:counts:hooks:begin -->36<!-- KAI:counts:hooks:end --> lifecycle hooks (security guards, formatters, analytics, cleanup) |
| `agents/` | <!-- KAI:counts:agents:begin -->18<!-- KAI:counts:agents:end --> named agents (Architect, Engineer, 5 researchers, Pentester, etc.) |
| `config/` | 7 domain config files that generate settings.json |
| `scripts/` | KAI Board dashboard, deployment packager |
| `PAI-Install/` | Interactive setup wizard |
| `MEMORY/` | Runtime state (gitignored — created per-machine) |

## What's Different From the Original

See **[docs/WHATS-DIFFERENT.md](docs/WHATS-DIFFERENT.md)** for a detailed comparison with Daniel Miessler's original.

Highlights: domain-based config, interactive installer, hook stderr wrapper + async flags, SecretScanner, GitHubWriteGuard, <!-- KAI:counts:agents:begin -->18<!-- KAI:counts:agents:end --> named agents, Algorithm <!-- KAI:algorithm-version:begin -->v3.13.0<!-- KAI:algorithm-version:end --> with ISC quality gates, EM/PLM workflow skills, no personal data in repo.

## Configuration

Configuration lives in `config/*.jsonc` — not in `settings.json` directly.

```bash
# Edit your identity
$EDITOR ~/.claude/config/identity.jsonc

# Edit hook registrations
$EDITOR ~/.claude/config/hooks.jsonc

# Rebuild settings.json (also runs automatically at session start)
bun ~/.claude/hooks/handlers/BuildSettings.ts
```

## Customization

Personal files go in `PAI/USER/` (gitignored, created by installer):

| File | Purpose |
|------|---------|
| `PAI/USER/ABOUTME.md` | Your name, role, organization |
| `PAI/USER/AISTEERINGRULES.md` | Personal behavioral rules |
| `PAI/USER/CONTACTS.md` | Frequent contacts |
| `PAI/USER/TELOS/` | Goals, projects, beliefs, strategies |

## Quick Start

```bash
# Start a Claude Code session (KAI loads automatically)
claude

# Open KAI Board (dashboard on port 3333)
bun ~/.claude/scripts/board.ts

# Build a deployment package
bun ~/.claude/scripts/deploy.ts
```

## Documentation

- **[docs/QUICKSTART.md](docs/QUICKSTART.md)** — Getting started guide (start here)
- **[docs/WHATS-DIFFERENT.md](docs/WHATS-DIFFERENT.md)** — Comparison with the original
- **[docs/planning/NEXT-STEPS.md](docs/planning/NEXT-STEPS.md)** — Roadmap and current work
- **[docs/architecture/SYSTEM-ATLAS.md](docs/architecture/SYSTEM-ATLAS.md)** — System architecture
- **[PAI/THEHOOKSYSTEM.md](PAI/THEHOOKSYSTEM.md)** — Hook system docs
- **[PAI/SKILL.md](PAI/SKILL.md)** — Full system documentation

## API Keys

See **[.env.example](.env.example)** for all optional API keys (GitHub, research agents, notifications, etc.).
