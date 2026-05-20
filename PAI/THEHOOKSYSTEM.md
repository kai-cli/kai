# Hook System

**Event-Driven Automation Infrastructure**

**Location:** `~/.claude/hooks/` | **Config:** `~/.claude/settings.json`

*Full spec: [PAI/dev/THEHOOKSYSTEM-Reference.md](dev/THEHOOKSYSTEM-Reference.md)*

---

## 8 Hook Events

| Event | Trigger | Key Uses |
|-------|---------|----------|
| **SessionStart** | New conversation begins | Load context, persist Kitty env, reset tab state, compact recovery |
| **UserPromptSubmit** | User sends a message | Mode classification, rating capture, tab title, session naming |
| **PreToolUse** | Before any tool executes | Security validation, AskUserQuestion tab, agent/skill guards |
| **PostToolUse** | After any tool executes | PRD sync, count updates |
| **Stop** | Claude finishes responding | Tab reset, voice completion, response cache, doc integrity |
| **SessionEnd** | Session terminates | Work learning, session cleanup, relationship memory, integrity check |
| **SubagentStop** | Subagent completes | (reserved) |
| **PreCompact** | Before context compaction | (reserved) |

---

## Hook Output Protocol

Hooks communicate via stdout JSON and exit codes:

```typescript
// Inject context into next Claude turn
console.log(JSON.stringify({ additionalContext: "..." }));

// Block the action (PreToolUse only)
console.log(JSON.stringify({ decision: "block", reason: "..." }));

// Exit codes
process.exit(0);  // success / allow
process.exit(1);  // block (PreToolUse) or error
process.exit(2);  // hard block with message
```

**Stderr handling (CRITICAL):** Claude Code treats stderr output from hooks as an error indicator and displays "hook error" in the UI. All hooks MUST use the `run-hook.sh` wrapper to redirect stderr to log files. Never call hooks directly in settings.json — always use the wrapper. See [Stderr & the run-hook.sh Wrapper](#stderr--the-run-hooksh-wrapper) below.

---

## Stderr & the run-hook.sh Wrapper

Claude Code (verified in v2.1.85) surfaces stderr from command hooks as error messages in the UI. This means `console.error()` diagnostic logging — which is standard practice — triggers "hook error" display.

**Solution:** All hooks are registered through `hooks/lib/run-hook.sh`, which redirects stderr to per-hook log files at `/tmp/pai-hooks/`.

```bash
# hooks/lib/run-hook.sh
#!/bin/bash
HOOK_NAME="${1:?Usage: run-hook.sh <ExampleHook.hook.ts>}"
HOOK_PATH="~/.claude/hooks/${HOOK_NAME}"
LOG_DIR="/tmp/pai-hooks"
mkdir -p "$LOG_DIR"
LOG_FILE="${LOG_DIR}/${HOOK_NAME%.hook.ts}.log"
exec bun "$HOOK_PATH" 2>>"$LOG_FILE"
```

**Registration pattern in settings.json:**
```json
{
  "type": "command",
  "command": "~/.claude/hooks/lib/run-hook.sh YourHook.hook.ts"
}
```

**Reading hook diagnostics:**
```bash
cat /tmp/pai-hooks/MyHook.log       # Single hook
tail -f /tmp/pai-hooks/*.log        # All hooks live
```

**When creating new hooks:** Always register via `run-hook.sh`. Never register `.hook.ts` files directly.

---

## Hook Performance Policy

**Budget:** Sync hooks must complete in <500ms. Hooks exceeding this should be async.

| Category | Max Time | When to Use |
|----------|----------|-------------|
| **Sync (blocking)** | <500ms | Injects `additionalContext`, blocks actions, validates input |
| **Async (background)** | No limit | Analytics, tab state, logging, cleanup |

**Sync hooks** block the UI — the user sees "running hooks" until all sync hooks complete.
**Async hooks** (`"async": true` in config) run in the background after the event fires.

### Which Hooks MUST Be Sync

Hooks that output JSON to stdout (additionalContext, decision, continue) must be sync because their output needs to reach Claude before the next turn:

- SecretScanner (continue flag)
- ModeClassifier (additionalContext)
- FormatReminder (additionalContext)
- LocalContextFirst (additionalContext)
- SecurityValidator (decision: block)
- GitHubWriteGuard (decision: block)
- SkillGuard (decision)
- AgentExecutionGuard (decision)

### Which Hooks Should Be Async

Hooks that only write to files, update state, or perform analytics — no stdout output needed:

- PromptAnalysis, RatingCapture, TerminalState, UpdateTabTitle (UserPromptSubmit — inference calls)
- StopOrchestrator (Stop — 15s inference in DocCrossRefIntegrity)
- All SessionEnd hooks (post-session cleanup)
- AlgorithmTracker, LastResponseCache (Stop — fast but non-blocking)

### Performance Baseline (2026-03-27)

| Hook | Event | Time | Inference? |
|------|-------|------|-----------|
| SecretScanner | UserPromptSubmit | 222ms | No |
| LocalContextFirst | UserPromptSubmit | 28ms | No |
| ModeClassifier | UserPromptSubmit | 33ms | No |
| FormatReminder | UserPromptSubmit | 27ms | No |
| SessionAutoName | UserPromptSubmit | 36ms | No |
| PromptAnalysis | UserPromptSubmit | 8,013ms | Yes |
| RatingCapture | UserPromptSubmit | 5,538ms | Yes |
| TerminalState | UserPromptSubmit | 4,149ms | Yes |
| UpdateTabTitle | UserPromptSubmit | 3,283ms | Yes |
| LastResponseCache | Stop | 23ms | No |
| TerminalState | Stop | 188ms | No |
| AlgorithmTracker | Stop | 236ms | No |
| StopOrchestrator | Stop | 15,060ms | Yes |

---

## Hook File Convention

```typescript
#!/usr/bin/env bun
import { readHookInput } from './lib/hook-io';

async function main() {
  const input = await readHookInput();
  if (!input) process.exit(0);

  // Route by event
  const event = input.hook_event_name;
  // ... handle event ...

  process.exit(0);
}

main().catch(() => process.exit(0));
```

- Always `#!/usr/bin/env bun` shebang
- Read stdin via `readHookInput()` from `hooks/lib/hook-io.ts`
- Always exit — never hang
- Fail gracefully: `catch(() => process.exit(0))`
- Use `console.error()` for diagnostics (redirected to log by wrapper)
- Use `console.log()` ONLY for JSON output to Claude Code

---

## Payload Schema Notes

Claude Code sends `prompt` (not `user_prompt`) in UserPromptSubmit payloads. The `hook-io.ts` normalizes both directions so hooks can use either field name. See `hooks/lib/payload-schema.ts` for the full schema.

---

## Settings.json Registration

```json
"hooks": {
  "EventName": [
    {
      "matcher": "ToolName",
      "hooks": [
        { "type": "command", "command": "${PAI_DIR}/hooks/lib/run-hook.sh YourHook.hook.ts" }
      ]
    }
  ]
}
```

For async hooks: `{ "type": "command", "command": "...", "async": true }`

---

*Full spec with all hooks documented, handler patterns, and architecture diagrams: [PAI/dev/THEHOOKSYSTEM-Reference.md](dev/THEHOOKSYSTEM-Reference.md)*
*Claude Code hook internals research: [Knowledge/ai-infrastructure/pai-system/docs/hooks/CLAUDE-CODE-HOOK-INTERNALS.md](~/Projects/Knowledge/ai-infrastructure/pai-system/docs/hooks/CLAUDE-CODE-HOOK-INTERNALS.md)*
