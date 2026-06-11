# Define Workflow

Create or update an automation profile.

## Steps

1. **Gather from the user:**
   - `name` — short kebab-case identifier (e.g. `jenkins-monitor`)
   - `description` — what it does in one line
   - `prompt` — the task prompt for the headless agent
   - `allowedTools` — array of tool patterns (e.g. `["mcp__jenkins__*"]`)
   - `cwd` (optional) — working directory, defaults to `~/Projects/Automation`
   - `permissionMode` (optional) — defaults to `auto`
   - `model` (optional) — defaults to `sonnet`

2. **Write the profile** to `~/.claude/automations/<name>.json`

3. **Confirm** by showing the profile and example launch command.

## Profile Schema

```json
{
  "name": "string (kebab-case)",
  "description": "string",
  "prompt": "string",
  "allowedTools": ["string (tool patterns)"],
  "cwd": "string (absolute path, optional)",
  "permissionMode": "auto | default | bypassPermissions",
  "model": "sonnet | opus | haiku"
}
```

## Guidelines

- If the user is vague about tools, suggest based on what MCP servers are available
- Available MCP tool prefixes: `mcp__jenkins__*`, `mcp__router__*`, `mcp__github__*`, `mcp__usp__*`, `mcp__build__*`, `mcp__playwright__*`
- Also available: `Bash`, `Read`, `Edit`, `Write`, `WebFetch`, `WebSearch`, `Agent`
- Always confirm the allowedTools list before saving — this is the security boundary
