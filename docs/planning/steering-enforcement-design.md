# Steering Enforcement Design Spike

**Created:** 2026-04-30
**Status:** Design complete — ready for v5.3.0 implementation
**Phase S of v5.2.0 plan**

## Problem Statement

CLAUDE.md says "plan means stop" but there's no mechanical enforcement. The recurring failure mode is:

> Diagnosis → obvious fix → execution flows without pause. The user shares a review or asks a question; the assistant treats it as authorization and starts working immediately.

Two distinct failures to address:
1. **Plan-then-execute without approval** — assistant presents a plan then immediately executes it
2. **Review-as-authorization** — user sends a review/critique; assistant treats it as a work directive

The v5.2.0 feedback memory (`feedback_describe_before_acting.md`) addresses #2 at the memory level, but it's not mechanical — a new session ignores it. This design adds a mechanical layer for #1.

---

## Approach: UserPromptSubmit Hook (additionalContext injection)

**Why not PreToolUse:Edit/Write block:**
- No representation of "plan-mode state" in the system
- Fires on every edit, requires precise state detection to avoid blocking normal work
- False positives are session-breaking

**Why UserPromptSubmit with additionalContext:**
- Softer intervention — injects a reminder rather than blocking
- User can override by just proceeding; the hook doesn't stop anything
- Lower false-positive risk than decision hooks
- Already has access to recent transcript context

---

## Detection: Plan-Presented Signal

A single structural marker (`## Phase` heading) fires on any multi-step explanation. Require **≥2 co-occurring signals** to classify a response as "plan presented":

| Signal | Pattern |
|--------|---------|
| S1 | `## Execution Order` or `## Phase \d` section header in last assistant message |
| S2 | Completion gate block — lines matching `- \[ \]` checklist with "gate" language |
| S3 | Phase table with time estimates — lines matching `\| Phase.*\[~.*\]` |

**Require S1 + (S2 or S3)** to classify. Requiring co-occurrence drastically reduces false positives on structured-but-non-plan responses (architecture explanations, feature specs, etc.).

---

## State Management

The hook needs to persist "plan was presented" across the Stop → next UserPromptSubmit boundary.

**State file:** `MEMORY/STATE/plan-pending.json`
```json
{
  "session_id": "...",
  "plan_detected_at": "ISO timestamp",
  "plan_excerpt": "first 200 chars of the detected plan section",
  "approved": false
}
```

**Written by:** A Stop hook (or StopOrchestrator) when plan signals are detected in the last assistant response.

**Read by:** UserPromptSubmit hook — if plan-pending.json exists and `approved: false`, inject reminder.

**Cleared by:** Either (a) user approval detected, or (b) session ends (SessionCleanup deletes it).

---

## Approval Detection

A follow-up prompt counts as approval when it contains any of:

**Explicit:** `go ahead`, `do it`, `start`, `execute`, `approved`, `yes`, `proceed`, `ok go`

**Implicit threshold:** Single word or short phrase (≤ 5 words) that doesn't contain a new question or task description. Heuristic: no `?` and no verb-noun pair suggesting new work.

When approval detected: set `approved: true` in plan-pending.json, suppress the reminder. Do NOT inject any output — silence is the right behavior on approval.

---

## Injection Content

When plan-pending and no approval:

```
[Plan approval pending]
A plan was presented. Waiting for your go-ahead before executing.
To proceed: say "go ahead", "do it", or "start".
To cancel: say "nevermind" or describe a different task.
```

Inject as `additionalContext` (prepended to system context for that turn). Short, non-intrusive, factual.

---

## Implementation Spec

### Stop hook addition (or StopOrchestrator handler)

```typescript
// After response completes, scan last assistant message for plan signals
function detectPlanPresented(lastAssistantMessage: string): boolean {
  const hasSectionHeader = /##\s*(Execution Order|Phase\s+\d)/i.test(lastAssistantMessage);
  const hasGateChecklist = /- \[ \].*(?:gate|complete|pass|done|ship)/i.test(lastAssistantMessage);
  const hasPhaseTable = /\|\s*Phase.*\[~\d+/i.test(lastAssistantMessage);
  return hasSectionHeader && (hasGateChecklist || hasPhaseTable);
}
```

Write `plan-pending.json` if signals detected; clear it if no signals.

### UserPromptSubmit hook: PlanApprovalGuard.hook.ts (new)

```typescript
// Read plan-pending.json
// If approved: false → inject reminder as additionalContext
// If user prompt matches approval phrases → set approved: true, no injection
// If no plan-pending.json → exit immediately (no-op for most sessions)
```

### SessionCleanup addition

Delete `plan-pending.json` at session end (prevents stale state across sessions).

---

## Failure Modes and Mitigations

| Failure | Mitigation |
|---------|-----------|
| False positive: structured explanation classified as plan | Require S1 + (S2 or S3) co-occurrence |
| Stale plan-pending across sessions | SessionCleanup deletes it |
| User says "go ahead" at start of session (no plan pending) | Guard checks file existence first; no-op if absent |
| Approval detection misses a valid "ok" | Approval detection is permissive; err on the side of clearing the gate |
| Plan presented in a subagent response | Subagents use NATIVE mode; plan signals won't appear — no false positives |
| Hook execution error | Exit 0 always; enforcement is advisory not blocking |

---

## Open Questions for v5.3.0 Implementation

1. **Where to detect plan in Stop phase?** StopOrchestrator already reads transcript — add plan detection there, or create a dedicated thin hook? Recommendation: add to StopOrchestrator to avoid another hook registration.

2. **How to access last assistant message?** transcript_path is available in Stop hook payload. Read last assistant turn from JSONL. Already done by StopOrchestrator for DocCrossRefIntegrity.

3. **additionalContext format** — does Claude Code show it differently from other context? Test that it appears in the right place relative to system context.

4. **Plan hash** — should we hash the plan content and require the user to include it in approval (stronger enforcement)? Decision: no for v5.3.0, too much friction. Re-evaluate based on user feedback.

---

## Estimated Implementation Scope (v5.3.0)

- `MEMORY/STATE/plan-pending.json` state schema (trivial)
- `hooks/PlanApprovalGuard.hook.ts` (new, ~80 LOC)
- StopOrchestrator modification: add plan detection (~20 LOC)
- SessionCleanup modification: delete plan-pending.json (~5 LOC)
- `config/hooks.jsonc`: register PlanApprovalGuard on UserPromptSubmit
- Tests for `detectPlanPresented()` and approval detection (~15 tests)

**Total: ~150 LOC + 15 tests. One focused session.**
