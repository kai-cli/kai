# Status Workflow

Check what autonomous agents are currently running.

## Steps

1. **Run** `claude agents --json` via Bash to get all active sessions.

2. **Filter** to show relevant info:
   - PID, cwd, status (idle/busy), session ID, started time
   - Calculate how long each has been running

3. **Present** as a clean table to the user.

4. **Optionally** cross-reference with known profiles from `~/.claude/automations/` if the cwd matches.

## Output Format

```
ACTIVE AGENTS
─────────────────────────────────────────────
PID     Status  CWD                    Running
56926   busy    ~/Projects/kai  2h 14m
74302   idle    ~/Projects             45m
─────────────────────────────────────────────
Total: 2 active sessions
```
