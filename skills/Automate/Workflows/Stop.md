# Stop Workflow

Stop a running autonomous agent.

## Steps

1. **Identify the target.** User can specify by:
   - PID
   - Session ID
   - Profile name (match by cwd)

2. **Confirm** with the user before killing — show what session will be stopped.

3. **Kill** with `kill <PID>` via Bash.

4. **Verify** with `claude agents --json` that it's gone.
