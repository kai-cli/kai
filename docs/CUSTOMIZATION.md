# Customizing KAI

KAI separates system files (updated via `git pull`) from user files (yours to edit freely).

## Configuration Files

All user configuration lives in `config/`:

| File | Purpose | Tracked? |
|------|---------|----------|
| `identity.jsonc` | Your name, AI name, color, timezone | No (gitignored) |
| `preferences.jsonc` | Env vars, voice, memory settings | No (gitignored) |
| `preferences.local.jsonc` | Machine-specific overrides (e.g. Bedrock) | No (gitignored) |
| `domains.jsonc` | Knowledge domains and keywords | No (gitignored) |
| `notifications.jsonc` | Notification routing | No (gitignored) |

Templates (`.template` files) are tracked as reference. The installer copies them on first setup.

After editing any config file, rebuild settings.json:
```bash
bun ~/.claude/hooks/handlers/BuildSettings.ts
```

## Knowledge Domains

Edit `config/domains.jsonc` to define your expertise areas:

```jsonc
{
  "definitions": {
    "backend": {
      "keywords": ["rails", "django", "postgres", "api"],
      "description": "Backend services and APIs"
    }
  },
  "projectMapping": [
    { "pattern": "my-app", "domains": ["backend"] }
  ],
  "excludedProjects": ["personal-notes"],
  "maxDomainsPerSession": 3
}
```

Starter configs are in `config/starters/` — copy one to get started:
```bash
cp config/starters/fullstack-domains.jsonc config/domains.jsonc
```

## Custom Hooks

Add your own hooks in `hooks/user/` (gitignored):

1. Copy the example registry: `cp hooks/user/hooks.jsonc.example hooks/user/hooks.jsonc`
2. Create your hook: `hooks/user/MyHook.hook.ts`
3. Register it in `hooks/user/hooks.jsonc`:
   ```jsonc
   { "SessionEnd": ["MyHook.hook.ts"] }
   ```
4. Rebuild: `bun ~/.claude/hooks/handlers/BuildSettings.ts`

User hooks are appended to system hooks — they never replace or disable them.

## Personal Context

Files in `PAI/USER/` are yours to edit:

- `ABOUTME.md` — Who you are, what you do
- `RESPONSEFORMAT.md` — How you want responses formatted
- `TECHSTACKPREFERENCES.md` — Your preferred technologies
- `TELOS/` — Goals, strategies, beliefs

## AWS Bedrock

To use Bedrock instead of the Anthropic API, create `config/preferences.local.jsonc`:

```jsonc
{
  "env": {
    "CLAUDE_CODE_USE_BEDROCK": "1",
    "AWS_REGION": "us-east-1",
    "AWS_PROFILE": "your-profile-name",
    "ANTHROPIC_MODEL": "us.anthropic.claude-opus-4-6-v1:0",
    "ANTHROPIC_SMALL_FAST_MODEL": "us.anthropic.claude-haiku-4-5-20251001-v1:0"
  }
}
```

Then rebuild: `bun ~/.claude/hooks/handlers/BuildSettings.ts`

## Upgrading

System files update via git:
```bash
cd ~/kai && git pull
```

Your config files, user hooks, and personal context are gitignored and preserved.
