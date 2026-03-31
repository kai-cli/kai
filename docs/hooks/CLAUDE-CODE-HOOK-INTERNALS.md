# Claude Code Hook Internals — Research Notes

**Date:** 2026-03-27
**Claude Code Version:** 2.1.85
**Binary Location:** `~/.local/share/claude/versions/2.1.85`
**Context:** Debugging persistent "UserPromptSubmit hook error" messages in PAI hook system

---

## Hook Execution Model

### How Claude Code Runs Command Hooks

1. Hooks registered in `settings.json` under event names (UserPromptSubmit, Stop, PreToolUse, etc.)
2. All matching hooks for a single event **run in parallel**
3. Each hook is spawned as a separate process via the OS shebang (`#!/usr/bin/env bun`)
4. Claude Code pipes the event payload as JSON to each hook's stdin
5. Hooks are **synchronous by default** — they block the UI until completion
6. `"async": true` in hook config runs the hook in the background (non-blocking)

### Hook Timeout Defaults

| Hook Type | Default Timeout |
|-----------|----------------|
| Command hooks | 600 seconds (10 min) |
| Prompt-based hooks | 30 seconds |
| Agent-based hooks | 60 seconds |

Configurable per hook with `"timeout": <seconds>` in settings.json.

---

## Hook Payload Schema (UserPromptSubmit)

Captured via bash debug hook on 2026-03-27:

```json
{
  "session_id": "2598bd7e-2ff7-48ca-8767-2294b255baf6",
  "transcript_path": "/Users/user/.claude/projects/.../2598bd7e.jsonl",
  "cwd": "/Users/user/Projects",
  "permission_mode": "default",
  "hook_event_name": "UserPromptSubmit",
  "prompt": "ok are we still testing? do we have the logs?"
}
```

**Key finding:** Claude Code sends `prompt` (not `user_prompt`). The PAI `payload-schema.ts` originally required `user_prompt`, causing validation failures in hooks using `hook-io.ts`.

---

## Hook Outcome Determination (from binary analysis)

Claude Code's command hook runner (`j39` / `Y39` functions) determines outcomes as follows:

### Decision Tree

```
stdout starts with "{"?
├─ YES → Parse as JSON
│   ├─ JSON parse fails → hook_non_blocking_error ("JSON validation failed")
│   ├─ JSON valid but schema fails → hook_non_blocking_error
│   └─ JSON valid + schema passes → check sE(json)
│       ├─ sE() true (empty/no-op) → success
│       └─ sE() false → UH8() → check conditions → success with message
├─ NO → Treat as plain text
│   └─ exit 0 → success
└─ EMPTY →
    └─ exit 0 → success

Exit code checks (if reached):
├─ exit 0 → success
├─ exit 2 → blocking error (hard block with stderr message)
└─ exit != 0 → hook_non_blocking_error ("Failed with non-blocking status code")
```

### Expected JSON Schema

```typescript
{
  continue?: boolean;       // Allow/block (PreToolUse)
  suppressOutput?: boolean; // Suppress hook output display
  stopReason?: string;      // Reason for stopping
  decision?: "approve" | "block"; // PreToolUse decision
  reason?: string;          // Reason for decision
  additionalContext?: string; // Inject context into next turn
}
```

### Display Rules

| Outcome | Event = Stop/SubagentStop | Other Events |
|---------|--------------------------|--------------|
| `hook_non_blocking_error` | Suppressed (null) | Shows "hookName hook error" |
| `hook_error_during_execution` | Suppressed (null) | Shows "hookName hook warning" |
| `hook_success` | null | null |

---

## Root Cause: stderr Triggers "hook error" Display

### The Discovery

Despite the binary analysis suggesting exit codes and JSON validation as the only error triggers, **stderr output from hooks causes Claude Code to display "hook error" messages**.

### Evidence

1. **Direct hook execution** (bun shebang): 3 "UserPromptSubmit hook error" messages consistently
2. **Bash wrapper with stderr redirect**: Zero errors (all 9 hooks succeed)
3. **Wrapper behavior**: `exec bun "$HOOK_PATH" 2>>"$LOG_FILE"` — only change is stderr suppression
4. All hooks exit 0 in both scenarios
5. All JSON stdout output is schema-valid in both scenarios

### Which Hooks Produce stderr

| Hook | Has stderr | stderr Content |
|------|-----------|----------------|
| SecretScanner | No | — |
| LocalContextFirst | Yes | `[LocalContextFirst] No work topic match` |
| PromptAnalysis | Yes | `[PromptAnalysis] tabTitle=...` |
| ModeClassifier | Yes | `[ModeClassifier] Injected mode hint: ...` |
| FormatReminder | Yes | `[FormatReminder] ...` |
| RatingCapture | Yes | `[RatingCapture] Hook started...` |
| TerminalState | Yes | `[tab-setter] ...`, `[TerminalState] ...` |
| UpdateTabTitle | Yes | `[tab-setter] ...`, `[UpdateTabTitle] ...` |
| SessionAutoName | Yes (sometimes) | `[SessionAutoName] ...` |

7 of 9 hooks produce stderr, but only 3 errors show. The discrepancy may relate to:
- Timing (some hooks complete before stderr is flushed)
- Buffer sizes (small stderr may not trigger the condition)
- Race conditions in parallel execution

### The Fix

Universal wrapper script `~/.claude/hooks/lib/run-hook.sh` redirects stderr to log files:

```bash
#!/bin/bash
HOOK_NAME="${1:?Usage: run-hook.sh <HookName.hook.ts>}"
HOOK_PATH="/Users/user/.claude/hooks/${HOOK_NAME}"
LOG_DIR="/tmp/pai-hooks"
mkdir -p "$LOG_DIR"
LOG_FILE="${LOG_DIR}/${HOOK_NAME%.hook.ts}.log"
exec bun "$HOOK_PATH" 2>>"$LOG_FILE"
```

Settings.json command format:
```json
{"type": "command", "command": "/Users/user/.claude/hooks/lib/run-hook.sh HookName.hook.ts"}
```

---

## Hook Performance Baseline (2026-03-27)

### UserPromptSubmit Hooks (9 hooks, run in parallel)

| Hook | Time | Has Inference | Produces stdout |
|------|------|--------------|-----------------|
| SecretScanner | 222ms | No | `{"continue":true}` |
| LocalContextFirst | 28ms | No | `{"additionalContext":"..."}` (when matched) |
| PromptAnalysis | 8,013ms | Yes | None |
| ModeClassifier | 33ms | No | `{"additionalContext":"..."}` |
| FormatReminder | 27ms | No | `{"additionalContext":"..."}` (when violation) |
| RatingCapture | 5,538ms | Yes | None |
| TerminalState | 4,149ms | Yes | None |
| UpdateTabTitle | 3,283ms | Yes | None |
| SessionAutoName | 36ms | No (spawns background) | None |

**Total wall clock (parallel):** ~8s (limited by slowest: PromptAnalysis)
**Fast hooks:** SecretScanner, LocalContextFirst, ModeClassifier, FormatReminder, SessionAutoName (<250ms)
**Slow hooks:** PromptAnalysis, RatingCapture, TerminalState, UpdateTabTitle (3-8s, all inference)

### Stop Hooks (4 hooks, run in parallel)

| Hook | Time | Has Inference | Notes |
|------|------|--------------|-------|
| LastResponseCache | 23ms | No | File I/O only |
| TerminalState | 188ms | No (Stop path) | Tab state reset |
| StopOrchestrator | 15,060ms | Yes | DocCrossRefIntegrity handler |
| AlgorithmTracker | 236ms | No | Regex extraction |

**Total wall clock (parallel):** ~15s (limited by StopOrchestrator)
**Bottleneck:** StopOrchestrator → DocCrossRefIntegrity handler (inference for semantic drift)

---

## Additional Findings

### payload-schema.ts Fix

**Original bug:** `payload-schema.ts` required `user_prompt` field, but Claude Code sends `prompt`.
**Fix:** Swapped — `prompt` is now required, `user_prompt` is optional.
**File:** `~/.claude/hooks/lib/payload-schema.ts`

### hook-io.ts Normalization

Added bidirectional normalization so hooks can use either `prompt` or `user_prompt`:
```typescript
if (obj.prompt && !obj.user_prompt) {
  obj.user_prompt = obj.prompt;
} else if (obj.user_prompt && !obj.prompt) {
  obj.prompt = obj.user_prompt;
}
```

### THEHOOKSYSTEM.md Incorrectly States

> "Stderr is for diagnostic logging only — never shown to user."

This is incorrect. Claude Code DOES surface stderr as error indicators. The hook system docs should be updated.

---

## Recommendations (Not Yet Implemented)

### Immediate

1. Apply `run-hook.sh` wrapper to ALL hook events (not just UserPromptSubmit/Stop)
2. Mark StopOrchestrator as `"async": true` to eliminate 15s post-response lag
3. Update THEHOOKSYSTEM.md to correct stderr documentation

### Architectural

1. Create sync/async policy document for all hooks
2. Establish performance budget: <500ms for sync hooks, no limit for async
3. Move all inference-based hooks to async where they don't inject additionalContext
4. Consider consolidating the 4 inference-calling UserPromptSubmit hooks into one

### Hooks That Could Be Async

| Hook | Event | Currently | Should Be | Reason |
|------|-------|-----------|-----------|--------|
| PromptAnalysis | UserPromptSubmit | sync | async | No stdout output, just analytics |
| RatingCapture | UserPromptSubmit | sync | async | No stdout output, just logging |
| TerminalState | UserPromptSubmit | sync | async | Tab state only, not blocking |
| UpdateTabTitle | UserPromptSubmit | sync | async | Tab title only, not blocking |
| StopOrchestrator | Stop | sync | async | Post-response cleanup, no blocking needed |
| All SessionEnd hooks | SessionEnd | sync | async | Post-session cleanup |

### Hooks That MUST Stay Sync

| Hook | Event | Reason |
|------|-------|--------|
| SecretScanner | UserPromptSubmit | Outputs `{"continue":true/false}` |
| ModeClassifier | UserPromptSubmit | Injects `additionalContext` |
| FormatReminder | UserPromptSubmit | Injects `additionalContext` |
| LocalContextFirst | UserPromptSubmit | Injects `additionalContext` |
| SecurityValidator | PreToolUse | Blocks dangerous operations |
| GitHubWriteGuard | PreToolUse | Blocks unauthorized pushes |

---

## Binary Analysis Reference

**Binary:** `~/.local/share/claude/versions/2.1.85` (196MB)
**Key offsets:**
- Hook outcome rendering: ~78060455 (hook_non_blocking_error case)
- Command hook result handling: ~79321500-79324000
- JSON validation function (Y39): ~79301454
- stdout parser (j39): ~79301600
- Stop hook error display: ~78071397
