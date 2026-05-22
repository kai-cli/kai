# MCP Setup

## Metadata
- **Name:** MCP Setup
- **Description:** Guided MCP server configuration within a session
- **Use when:** User asks about MCP, wants to add a server, or has MCP connection issues

## Workflow

1. Read current MCP config from `config/preferences.local.jsonc`
2. Show currently configured servers and their connection status
3. Ask: "What would you like to do?"
   - Add a new server
   - Remove a server
   - Test connections
   - Troubleshoot a failing server
4. For **Add**: Show available servers catalog, collect config, write to `preferences.local.jsonc`
5. Run `bun ~/.claude/hooks/handlers/BuildSettings.ts`
6. Inform user: "Server added. Restart your session to connect."

## Available Servers Catalog

| Server | Type | Config |
|--------|------|--------|
| Cloudflare | Remote | `{ "url": "https://mcp.cloudflare.com/sse" }` |
| GitHub | stdio | `{ "command": "npx", "args": ["-y", "@anthropic-ai/mcp-github"] }` |
| Playwright | stdio | `{ "command": "npx", "args": ["-y", "@anthropic-ai/mcp-playwright"] }` |

## Troubleshooting Steps

If a server is failing:
1. Check if the command/URL is reachable
2. For stdio servers: verify the package is installable (`npx -y <package>`)
3. For OAuth servers: check if `mcp-needs-auth-cache.json` needs deletion
4. For env-dependent servers: verify required env vars are set
5. Suggest: `claude mcp list` to see registered tools

## Notes

- Always write to `preferences.local.jsonc` (gitignored, machine-specific)
- After any change, rebuild settings and inform user about session restart
- Reference `docs/MCP-GUIDE.md` for the full guide
