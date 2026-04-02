# PAI Quickstart Guide

Step-by-step guide for getting PAI running on your machine.

## Prerequisites

Before running the installer, make sure you have:

1. **macOS or Linux** (Windows not supported)
2. **Claude Code CLI** installed
   ```bash
   # Check if installed
   claude --version

   # If not installed, see https://claude.ai/code
   ```
3. **Anthropic API key** (or AWS Bedrock credentials)
   ```bash
   # Set your API key — add this to your shell profile (~/.zshrc or ~/.bashrc)
   export ANTHROPIC_API_KEY="sk-ant-your-key-here"

   # Get a key at https://console.anthropic.com/settings/keys
   ```

## Install

```bash
# Clone the repo
git clone https://github.com/kai-cli/pai-config ~/pai-config

# Run the installer
bash ~/pai-config/install.sh
```

The installer will:
1. Install Bun (if missing)
2. Symlink `~/.claude/` to your repo clone
3. Ask for your name, assistant name, and timezone
4. Optionally configure AWS Bedrock
5. Create personal file templates in `PAI/USER/`
6. Build `settings.json` from domain config files

Total time: ~60 seconds.

## After Install

### Verify it works

```bash
# Start a session — PAI loads automatically
claude

# You should see the PAI banner and your configured identity
```

### Personalize (optional but recommended)

Edit these files in `~/.claude/PAI/USER/` to give PAI context about you:

| File | What to add | Impact |
|------|-------------|--------|
| `ABOUTME.md` | Your name, role, team, expertise | PAI tailors responses to your background |
| `AISTEERINGRULES.md` | Personal rules (e.g., "always use TypeScript") | PAI follows your preferences |
| `CONTACTS.md` | People you work with (name, role, context) | Used by meeting and communication skills |

These are all **optional** — PAI works without them, just with less personalization.

### Configuration

All configuration lives in `~/.claude/config/*.jsonc` (JSON with comments):

| File | What it controls |
|------|-----------------|
| `identity.jsonc` | Your name, assistant name, timezone |
| `hooks.jsonc` | 38 lifecycle hooks (security, formatting, etc.) |
| `permissions.jsonc` | Tool permissions (allow/deny/ask rules) |
| `preferences.jsonc` | Environment variables, MCP servers, tech stack |
| `notifications.jsonc` | Alert routing (disabled by default) |

After editing any config file:
```bash
# Rebuild settings.json (also runs automatically at session start)
bun ~/.claude/hooks/handlers/BuildSettings.ts
```

**Never edit `settings.json` directly** — it's auto-generated from the config files above.

## What You Get

### Skills (47 modules)
PAI includes specialized skills invoked with slash commands or automatically:
- **Research** — multi-agent parallel research with dedup
- **Security** — recon, web assessment, prompt injection testing
- **Thinking** — first principles, iterative depth, council debate
- **EM/PLM** — 1:1 notes, weekly status, decision log, NPI tracking
- And 40+ more — type `/skills` in a session to see all

### Agents (18 named specialists)
Spawned automatically when the task matches:
- **Architect** — system design
- **Engineer** — implementation with TDD
- **5 Researchers** — Claude, Gemini, Grok, Perplexity, Codex
- **ProductStrategist, TechnicalReviewer, StakeholderCommunicator** — EM support

### The Algorithm (v3.9.1)
For complex tasks, PAI uses a 7-phase execution framework:
**Observe** (understand) > **Think** (pressure-test) > **Plan** > **Build** > **Execute** > **Verify** > **Learn**

Each task gets Ideal State Criteria (ISC) — verifiable checkboxes that must all pass. This is what makes PAI systematically reliable rather than just "AI that tries."

### Hooks (38 lifecycle events)
Automated behaviors that fire on specific events:
- **SecretScanner** — warns if you're about to commit secrets
- **GitHubWriteGuard** — requires confirmation before git push
- **FormatReminder** — enforces PAI output format
- **BuildSettings** — auto-rebuilds config on changes

## Optional: API Keys for Advanced Features

Some skills need additional API keys. Add these to your shell profile if you want them:

```bash
# GitHub (for repo skills, PR review)
export GITHUB_TOKEN="ghp_..."

# Google (for Gemini researcher)
export GOOGLE_API_KEY="AIza..."

# OpenAI (for Codex researcher)
export OPENAI_API_KEY="sk-..."
```

See `.env.example` at the repo root for the full list.

## Troubleshooting

### "Authentication error" on first session
Your `ANTHROPIC_API_KEY` isn't set. Add it to your shell profile and restart your terminal:
```bash
echo 'export ANTHROPIC_API_KEY="sk-ant-your-key"' >> ~/.zshrc
source ~/.zshrc
```

### "Claude Code not found"
Install Claude Code first: https://claude.ai/code

### settings.json out of date
```bash
bun ~/.claude/hooks/handlers/BuildSettings.ts
```

### Hooks throwing errors
Check the hook log:
```bash
ls -la ~/.claude/MEMORY/STATE/*.log
```

### Want to re-run the installer
```bash
bash ~/pai-config/install.sh
# It detects existing config and offers to migrate or overwrite
```

## Further Reading

- [WHATS-DIFFERENT.md](WHATS-DIFFERENT.md) — How PAI differs from the original
- [SYSTEM-ATLAS.md](architecture/SYSTEM-ATLAS.md) — Full system architecture
- [ROADMAP.md](planning/ROADMAP.md) — Product roadmap
