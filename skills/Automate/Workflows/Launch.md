# Launch Workflow

Launch a headless autonomous Claude agent from a profile or ad-hoc definition.

## Steps

1. **Resolve the task.** Either:
   - Load a named profile from `~/.claude/automations/<name>.json`
   - Build an ad-hoc command from the user's inline request

2. **Compose the command:**
   ```bash
   claude -p "<prompt>" \
     --allowedTools <tools> \
     --permission-mode <mode> \
     --model <model> \
     --output-format json \
     2>&1 &
   ```

   Key flags:
   - `--permission-mode auto` — no prompts (default for automations)
   - `--allowedTools` — the guardrail; only tools in this list are available
   - `--output-format json` — structured output for parsing results
   - `--cwd` if specified in profile
   - Run in background with `&` or use Bash with `run_in_background: true`

3. **Launch it** via the Bash tool with `run_in_background: true`.

4. **Report** the PID and how to check status (`/automate status`).

## Safety Rules

- NEVER use `--dangerously-skip-permissions` unless the profile explicitly sets it AND the user confirms
- Default `permissionMode` is `auto` (accepts reads and writes but respects the allowedTools fence)
- If no `allowedTools` are specified, ASK the user — don't launch with full access
- Log the exact command being run so the user can see what was dispatched

## Ad-hoc Syntax

When the user says `/automate run "do something" --tools X,Y`:
- Parse the quoted string as the prompt
- Parse `--tools` as the allowedTools list
- Use defaults for everything else (permissionMode: auto, model: sonnet, cwd: current)
