# PAI 4.6.0 — Personal AI Infrastructure

> A production-ready Claude Code configuration system. Fork of Daniel Miessler's [PAI](https://danielmiessler.com), hardened for team deployment.

## Install

```bash
git clone https://github.com/kai-cli/pai-config ~/pai-config
bash ~/pai-config/install.sh
```

The installer symlinks `~/.claude/` to your repo, walks you through identity setup (your name, assistant name, timezone), optionally configures AWS Bedrock, and builds your `settings.json` from domain config files.

## What's Inside

| Directory | Contents |
|-----------|----------|
| `PAI/` | Core system: Algorithm v3.9.1, context routing, system docs |
| `skills/` | 51 skill modules (Research, Security, Writing, Analysis, EM/PLM workflows) |
| `hooks/` | 38 lifecycle hooks (security guards, formatters, analytics, cleanup) |
| `agents/` | 18 named agents (Architect, Engineer, 5 researchers, Pentester, etc.) |
| `config/` | 7 domain config files that generate settings.json |
| `scripts/` | PAI Board dashboard, deployment packager |
| `PAI-Install/` | Interactive setup wizard |
| `MEMORY/` | Runtime state (gitignored — created per-machine) |

## What's Different From the Original

See **[docs/WHATS-DIFFERENT.md](docs/WHATS-DIFFERENT.md)** for a detailed comparison with Daniel Miessler's original PAI.

Highlights: domain-based config, interactive installer, hook stderr wrapper + async flags, SecretScanner, GitHubWriteGuard, 18 named agents, Algorithm v3.9.1 with ISC quality gates, EM/PLM workflow skills, no personal data in repo.

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
# Start a Claude Code session (PAI loads automatically)
claude

# Open PAI Board (dashboard on port 3333)
bun ~/.claude/scripts/board.ts

# Build a deployment package
bun ~/.claude/scripts/deploy.ts
```

## Documentation

- **[docs/WHATS-DIFFERENT.md](docs/WHATS-DIFFERENT.md)** — Comparison with original PAI
- **[docs/planning/ROADMAP.md](docs/planning/ROADMAP.md)** — Product roadmap
- **[docs/planning/NEXT-STEPS.md](docs/planning/NEXT-STEPS.md)** — Current work
- **[docs/architecture/SYSTEM-ATLAS.md](docs/architecture/SYSTEM-ATLAS.md)** — System architecture
- **[PAI/THEHOOKSYSTEM.md](PAI/THEHOOKSYSTEM.md)** — Hook system docs
- **[PAI/SKILL.md](PAI/SKILL.md)** — Full system documentation

## Requirements

- macOS or Linux
- [Bun](https://bun.sh) (installed automatically by `install.sh`)
- [Claude Code](https://claude.ai/code) CLI
- Anthropic API key (or AWS Bedrock credentials)
