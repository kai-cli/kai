# MCP Server Guide

## What Are MCP Servers?

Model Context Protocol servers give KAI access to external tools — databases,
APIs, browsers, infrastructure. They're like plugins that expose new tool calls
to Claude during your session.

## Adding a Server

Edit `config/preferences.local.jsonc` and add your server to `mcpServers`:

### Remote (HTTP) servers

```jsonc
{
  "mcpServers": {
    "my-server": { "url": "https://example.com/mcp" }
  }
}
```

### Local (stdio) servers

```jsonc
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "@some/mcp-server"],
      "env": { "API_KEY": "${MY_API_KEY}" }
    }
  }
}
```

After adding, rebuild settings:
```bash
bun ~/.claude/hooks/handlers/BuildSettings.ts
```

Then restart your Claude Code session to connect.

## Available Servers

| Server | Type | Install | What It Does |
|--------|------|---------|-------------|
| Cloudflare | Remote | `https://mcp.cloudflare.com/sse` | Workers, KV, R2, DNS |
| GitHub | stdio | `npx -y @anthropic-ai/mcp-github` | PRs, issues, search |
| Playwright | stdio | `npx -y @anthropic-ai/mcp-playwright` | Browser automation |

See each server's README for full documentation and additional options.

## OAuth Flows (Cloudflare, etc.)

Some remote servers use OAuth for authentication:

1. Add the server URL to `config/preferences.local.jsonc`
2. Rebuild: `bun ~/.claude/hooks/handlers/BuildSettings.ts`
3. Start a session — Claude Code will prompt you to authenticate in your browser
4. Complete the flow in your browser
5. Auth token cached in `mcp-needs-auth-cache.json` (gitignored, auto-recreated)

## Project-Specific Servers

Add a `.mcp.json` to your project root for servers only needed in that project.
Enable project servers in preferences.jsonc:

```jsonc
{
  "enableAllProjectMcpServers": true
}
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Server connected but no tools | Run `claude mcp list` to verify tools registered |
| Connection refused | Verify the server process is running (for stdio: check the command works standalone) |
| Auth expired (OAuth servers) | Delete `~/.claude/mcp-needs-auth-cache.json`, restart session |
| Env var not found | Add to `preferences.local.jsonc` env block or shell profile |
| Server timeout | Check network connectivity; remote servers need internet access |
| "MCP server not responding" | For stdio: ensure the command is installed (`npx` will auto-install) |

## Multiple Machines

MCP servers are configured in `preferences.local.jsonc` which is gitignored.
Each machine gets its own server configuration. This is intentional — servers
like a local database or project-specific tool may only exist on one machine.

For servers you want everywhere, add them to `config/preferences.jsonc` instead
(this file is committed and syncs across machines).
