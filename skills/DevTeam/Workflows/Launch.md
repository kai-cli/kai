# Launch Workflow

Initial team proposal and confirmation flow. Used on first invocation or when user asks how DevTeam works.

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

3. After confirmation, hand off to the appropriate workflow:
   - `BugFix.md`, `Feature.md`, or `Investigation.md`

## Example Prompt

```
I'd like to spin up a team for: "Login fails on Safari after the last deploy"

Based on this, I recommend the **Bug Fix** preset:
- PM (sonnet): Scope the bug, define acceptance criteria
- Dev (sonnet): Implement fix in isolated worktree
- QA (sonnet): Verify fix, regression check
- Review: Bedrock panel (if available) or Claude adversarial

Does this team composition look right, or would you like to adjust?
```
