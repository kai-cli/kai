# List Workflow

Show all defined automation profiles.

## Steps

1. **Read** all JSON files from `~/.claude/automations/`

2. **Present** as a table:
   ```
   AUTOMATION PROFILES
   ─────────────────────────────────────────────────────────
   Name               Tools                    Description
   jenkins-monitor    mcp__jenkins__*          Check builds, summarize failures
   device-health      mcp__router__*           Poll router health metrics
   pr-summary         mcp__github__*           Summarize open PRs
   ─────────────────────────────────────────────────────────
   ```

3. **If no profiles exist**, tell the user and suggest `/automate define` to create one.
