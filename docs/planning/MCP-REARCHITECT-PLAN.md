# MCP Rearchitect Plan

## Problem Statement

MCP servers are a constant source of friction. They require manual maintenance, break silently, and the configuration model is a confusing mess across multiple discovery mechanisms.

## Current State (2026-05-21)

### What's Deployed
| Server | Type | Status |
|--------|------|--------|
| router | stdio (bun) | Connected but tools NOT exposed |
| jenkins | stdio (bun) | Connected but tools NOT exposed |
| usp | stdio (bun) | Connected but tools NOT exposed |
| build | stdio (bun) | Connected, tools exposed |
| cloudflare | HTTP remote | Connected, tools exposed |
| github | stdio (go binary) | Connected, tools exposed |
| playwright | stdio (npx) | Connected, tools exposed |

### Architecture Failures

**Failure 1: Servers connected but tools not registered**

`claude mcp list` shows all 7 servers as "✓ Connected" — but router, jenkins, and usp tools don't appear in the deferred tool list. Only build/cloudflare/github/playwright are available. The servers are running, consuming resources, and reporting healthy... but Claude can't use them.

Likely cause: Claude Code has an internal tool registration limit or silent failure when servers expose too many tools or have naming conflicts. No error surfaces anywhere.

**Failure 2: Three competing configuration mechanisms**

MCP servers can be configured in THREE different places, each with different discovery rules:

1. **`~/.claude/settings.json` → `mcpServers` key** — Global user-level. Currently EMPTY (no mcpServers key exists).
2. **`.mcp.json` in project root** — Picked up when `enableAllProjectMcpServers: true`. The `feed_bbf` project has NO `.mcp.json`. The `linksys-mcp` project has one but it's empty (`{}`).
3. **External plugins** (`~/.claude-pre-symlink/plugins/marketplaces/...`) — How github and playwright actually load. Hidden directory structure.

**The actual config that works** lives in `linksys-mcp/config/settings-snippet.json` — a reference file that must be manually installed somewhere. It's never been installed into `settings.json`. The servers somehow load anyway (likely from a prior `claude mcp add` invocation that stores config in a hidden DB).

**Failure 3: We previously had to DELETE .mcp.json to fix things**

Claude Code's discovery changed between versions. `.mcp.json` was once the canonical source, then Claude started reading from an internal store instead. Having both causes conflicts or double-registration that silently fails.

**Failure 4: Env var validation crashes servers on startup**

The registry (`packages/common/src/registry.ts`) uses Zod `.refine()` to validate that credential env vars exist at parse time:
```typescript
credentialRef: z.string().min(1).refine(
  (ref) => process.env[ref] !== undefined,
  { message: "Referenced environment variable is not set" }
)
```
If any referenced env var (`LINKSYS_ROUTER_M62_PASS`, `LINKSYS_JENKINS_TOKEN`, etc.) is missing when the server process spawns, the server exits immediately with a validation error. The MCP server `env` block in config must pass these through, but:
- Different projects have different env blocks
- Claude Code's env inheritance from shell profile is inconsistent
- No graceful degradation — one missing var kills the entire server

**Failure 5: No observability**

- No way to see WHY a tool isn't registered when the server is connected
- No logs accessible from Claude Code session
- `claude mcp list` only shows connection status, not tool registration status
- Server crashes appear as silent tool absence

**Failure 6: Fragile absolute paths**

All server configs use absolute paths:
```json
"command": "/Users/deven.ducommun/.bun/bin/bun",
"args": ["run", "/Users/deven.ducommun/Projects/linksys-mcp/packages/router/src/index.ts"]
```
Moving the project, changing username, or using a different machine breaks everything.

## Root Cause Analysis

The core problem is that MCP server lifecycle is **fully opaque**:
1. You configure servers
2. Claude Code starts them as child processes
3. They either work or they don't
4. When they don't, there's no feedback loop

Combined with THREE competing config mechanisms and env var fragility, the result is a system that requires tribal knowledge to maintain and breaks silently.

## Proposed Architecture

### Principle: One Source of Truth, Fail Loud

**Phase 1: Consolidate Config (Immediate)**

1. Move ALL MCP server definitions into `~/.claude/settings.json` under `mcpServers` key
2. Delete all `.mcp.json` files (they cause silent conflicts)
3. Remove `enableAllProjectMcpServers` (we don't use project-level MCP)
4. Use env var references (`${VAR_NAME}` syntax) that Claude Code resolves from shell

**Phase 2: Make Servers Resilient**

1. Remove Zod `.refine()` on env vars at schema parse time — validate lazily on first tool call instead
2. Servers should start successfully even if credentials are missing — just return clear errors when tools are called without creds
3. Add a health-check tool to each server (`<server>_health`) that reports which credentials are available

**Phase 3: Observability**

1. Add structured startup log to `~/.local/state/linksys-mcp/startup.log` — timestamped, shows which tools registered
2. Add a meta-tool `mcp_status` that reports: server name, PID, tools registered, last error
3. Write a `scripts/doctor.sh` that checks all servers can start and register tools

**Phase 4: Portable Config**

1. Replace absolute paths with relative resolution:
   - `command: "bun"` (rely on PATH)
   - `args: ["run", "${PAI_DIR}/../Projects/linksys-mcp/packages/router/src/index.ts"]` or
   - Use a launcher script: `~/.claude/mcp/start-router.sh` that resolves paths
2. Store credential env var names in one place (`~/.config/linksys-mcp/env.sh`) that all servers source

### Immediate Fix (Today)

To get router SSH working for PR #72 validation:

```bash
# Option A: Add mcpServers to settings.json
# (requires session restart to pick up)

# Option B: Just SSH directly with the hook allowing it
# (need to update hook config to allow sshpass commands)

# Option C: Run the validation commands manually via ! prefix
```

## Files to Change

| File | Action |
|------|--------|
| `~/.claude/settings.json` | Add `mcpServers` block from snippet |
| `linksys-mcp/packages/common/src/registry.ts` | Remove `.refine()` on credentialRef/passwordRef |
| `linksys-mcp/.mcp.json` | Delete or leave empty |
| `linksys-mcp/config/settings-snippet.json` | Keep as reference but not canonical |
| `linksys-mcp/packages/*/src/index.ts` | Add startup logging |
| `~/.config/linksys-mcp/env.sh` | New: single source for credential env vars |

## Success Criteria

1. After session restart, ALL 7 servers show tools in deferred list
2. Removing one env var doesn't crash any server — just degrades gracefully
3. `scripts/doctor.sh` passes clean
4. No `.mcp.json` files anywhere
5. Config lives in exactly ONE place (`~/.claude/settings.json`)
