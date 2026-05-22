# Plugin System

## Current State (v5.9)

The plugin system is scaffolded but not yet active for end users.
The `plugins/` directory is gitignored — plugins are installed separately.

## Architecture

```
plugins/
├── config.json             # Tracked — lists installed plugin repos
├── blocklist.json          # Tracked — blocked plugins (security)
├── known_marketplaces.json # Tracked — marketplace registry
├── marketplaces/           # Gitignored — cloned marketplace repos
└── repos/                  # Gitignored — cloned plugin repos
```

## What's Coming (future release)

- `kai plugin install <name>` — install from marketplace
- `kai plugin list` — show installed plugins
- `kai plugin update` — update all plugins
- Plugin isolation (separate node_modules, no global pollution)

Timeline for plugin CLI is TBD — depends on marketplace maturity and
community demand.

## For Now

If you want to add a plugin manually:

1. Clone the repo into `plugins/repos/`
2. Add it to `plugins/config.json`:
   ```json
   {
     "installed": [
       { "name": "my-plugin", "repo": "github.com/user/my-plugin", "version": "main" }
     ]
   }
   ```
3. Rebuild settings: `bun ~/.claude/hooks/handlers/BuildSettings.ts`

## Plugin Structure

A KAI plugin is a git repo with:
- `plugin.json` — metadata (name, version, description, skills, hooks)
- `skills/` — skill markdown files (auto-registered on install)
- `hooks/` — hook TypeScript files (registered in plugin.json)
- `config/` — default configuration (merged with user config)

## Security

- Plugins from unknown sources are blocked by `blocklist.json`
- Plugin hooks run in the same process as KAI hooks — only install trusted plugins
- The SecurityValidator hook applies to plugin-provided tools too
