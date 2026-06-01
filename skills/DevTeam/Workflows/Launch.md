# Launch Workflow

Initial team proposal and confirmation flow. Used on first invocation or when user asks how DevTeam works.

**Execution Modes:**
- Foreground (default): Runs team in current session via Agent tool calls — best for quick work, user stays involved
- Background: Dispatches Dev/QA as background sessions — best for long-running work, frees user

## Execution

1. Determine the appropriate preset from the user's request:
   - Bug/fix/debug → `bug-fix`
   - Feature/build/implement → `feature`
   - Investigate/figure out/root cause → `investigation`
   - Review/check code → `code-review`

2. Present the proposed team to the user via AskUserQuestion:
   - Show preset name and roles
   - Ask if team composition is correct or needs adjustment
   - Options: confirm preset, add/remove roles, change models

3. After team composition confirmation, ask execution mode via AskUserQuestion:
   - **Foreground** (default): Runs in current session via Agent tool calls — best for quick work, user stays involved
   - **Background**: Dispatches Dev/QA as background sessions — best for long-running work (>10min), frees user
   - Present both options, recommend based on task complexity estimate

4. Route based on mode:
   - **Foreground** → existing workflows: `BugFix.md`, `Feature.md`, or `Investigation.md`
   - **Background** → `BackgroundFeature.md` (handles features/bugs that will take >10min)

## Example Prompt

```
I'd like to spin up a team for: "Login fails on Safari after the last deploy"

Based on this, I recommend the **Bug Fix** preset:
- PM (sonnet): Scope the bug, define acceptance criteria
- Dev (sonnet): Implement fix in isolated worktree
- QA (sonnet): Verify fix, regression check
- Review: Bedrock panel (if available) or Claude adversarial

Goal Ancestry (inferred — validate or adjust):
- Intent: Fix Safari login regression introduced in last deploy
- Priority: critical (production-facing, user-blocking)
- Why: Users cannot log in on Safari, affecting ~30% of traffic

Does this team composition look right, or would you like to adjust?
```
