# KAI Quickstart Guide

Step-by-step guide for getting KAI running on your machine.

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
git clone https://github.com/kai-cli/kai ~/kai

# Run the installer
bash ~/kai/install.sh
```

The installer will:
1. Symlink `~/.claude/` to your repo clone
2. Verify Claude Code is installed
3. Choose a knowledge archetype
4. Configure your identity (name, assistant name, timezone)
5. Optionally configure AWS Bedrock
6. Set up API keys for research agents (optional)
7. Configure MCP servers (optional)
8. Set up notifications (optional)
9. Create personal file templates in `PAI/USER/`
10. Build `settings.json` and `CLAUDE.md`

Total time: ~2-3 minutes (interactive).

## After Install

### Verify it works

```bash
# Start a session — KAI loads automatically
claude

# You should see the KAI banner and your configured identity
```

### Personalize (optional but recommended)

Edit these files in `~/.claude/PAI/USER/` to give PAI context about you:

| File | What to add | Impact |
|------|-------------|--------|
| `ABOUTME.md` | Your name, role, team, expertise | KAI tailors responses to your background |
| `AISTEERINGRULES.md` | Personal rules (e.g., "always use TypeScript") | KAI follows your preferences |
| `CONTACTS.md` | People you work with (name, role, context) | Used by meeting and communication skills |

These are all **optional** — KAI works without them, just with less personalization.

### Configuration

All configuration lives in `~/.claude/config/*.jsonc` (JSON with comments):

| File | What it controls |
|------|-----------------|
| `identity.jsonc` | Your name, assistant name, timezone |
| `hooks.jsonc` | <!-- KAI:counts:hooks:begin -->53<!-- KAI:counts:hooks:end --> lifecycle hooks (security, formatting, etc.) |
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

### Skills (<!-- KAI:counts:skills:begin -->85<!-- KAI:counts:skills:end --> modules)
KAI includes specialized skills invoked with slash commands or automatically:
- **Research** — multi-agent parallel research with dedup
- **Security** — recon, web assessment, prompt injection testing
- **Thinking** — first principles, iterative depth, council debate
- **EM/PLM** — 1:1 notes, weekly status, decision log, NPI tracking
- And 40+ more — type `/skills` in a session to see all

### Agents (<!-- KAI:counts:agents:begin -->20<!-- KAI:counts:agents:end --> named specialists)
Spawned automatically when the task matches:
- **Architect** — system design
- **Engineer** — implementation with TDD
- **5 Researchers** — Claude, Gemini, Grok, Perplexity, Codex
- **ProductStrategist, TechnicalReviewer, StakeholderCommunicator** — EM support

### The Algorithm (<!-- KAI:algorithm-version:begin -->v3.14.0<!-- KAI:algorithm-version:end -->)
For complex tasks, KAI uses a 7-phase execution framework:
**Observe** (understand) > **Think** (pressure-test) > **Plan** > **Build** > **Execute** > **Verify** > **Learn**

Each task gets Ideal State Criteria (ISC) — verifiable checkboxes that must all pass. This is what makes KAI systematically reliable rather than just "AI that tries."

### Hooks (<!-- KAI:counts:hooks:begin -->53<!-- KAI:counts:hooks:end --> lifecycle events)
Automated behaviors that fire on specific events:
- **SecretScanner** — warns if you're about to commit secrets
- **GitHubWriteGuard** — requires confirmation before git push
- **FormatReminder** — enforces KAI output format
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
bash ~/kai/install.sh
# It detects existing config and offers to migrate or overwrite
```

## Further Reading

- [CONFIGURATION.md](CONFIGURATION.md) — Full config system guide (build pipeline, local overrides)
- [MEMORY.md](MEMORY.md) — How the memory system works (directories, retention, curation)
- [MCP-GUIDE.md](MCP-GUIDE.md) — Adding and managing MCP servers
- [PLUGINS.md](PLUGINS.md) — Plugin system architecture and manual installation
- [WHATS-DIFFERENT.md](WHATS-DIFFERENT.md) — How KAI differs from the original
- [ARCHITECTURAL-UNDERSTANDING.md](architecture/ARCHITECTURAL-UNDERSTANDING.md) — Full system architecture
