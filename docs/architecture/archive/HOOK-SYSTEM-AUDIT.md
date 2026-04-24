# PAI Hook System Audit

> Deep audit of the hook system covering registration, execution flow, file sizes, broken imports, and the StopOrchestrator situation.
>
> **Date:** 2026-03-11
> **Source of truth:** `config/hooks.jsonc` (compiled to `settings.json` by `handlers/BuildSettings.ts`)

---

## Hook Registration Map

Derived from `config/hooks.jsonc`. This is what Claude Code actually executes.

### PreToolUse (7 registrations, 4 unique hooks)

| Matcher | Hook | Lines | Purpose |
|---------|------|-------|---------|
| Bash | SecurityValidator.hook.ts | 618 | Pattern-match commands against security rules |
| Bash | GitHubWriteGuard.hook.ts | 211 | Block dangerous GitHub operations |
| Edit | SecurityValidator.hook.ts | — | (same hook, different matcher) |
| Write | SecurityValidator.hook.ts | — | (same hook, different matcher) |
| Read | SecurityValidator.hook.ts | — | (same hook, different matcher) |
| AskUserQuestion | TerminalState.hook.ts | 302 | Track terminal state for prompts |
| Task | AgentExecutionGuard.hook.ts | 109 | Validate agent spawn parameters |
| Skill | SkillGuard.hook.ts | ~80 | Validate skill invocations |

**Note:** SecurityValidator runs on 4 different matchers (Bash, Edit, Write, Read). Each triggers a separate process spawn.

### PostToolUse (2 registrations, 2 unique hooks)

| Matcher | Hook | Lines | Purpose |
|---------|------|-------|---------|
| AskUserQuestion | QuestionAnswered.hook.ts | ~60 | Reset tab state after question |
| Write | PRDSync.hook.ts | ~100 | Sync PRD frontmatter to work.json |
| Edit | PRDSync.hook.ts | — | (same hook, different matcher) |

### UserPromptSubmit (5 hooks, no matchers)

| Hook | Lines | Purpose | Blocking? |
|------|-------|---------|-----------|
| ModeClassifier.hook.ts | ~80 | Classify effort tier (Native vs Algorithm) | Yes |
| RatingCapture.hook.ts | 553 | Capture explicit/implicit ratings | No (but calls inference) |
| TerminalState.hook.ts | 302 | Track terminal state | No |
| UpdateTabTitle.hook.ts | 228 | Set Kitty tab title from prompt | No |
| SessionAutoName.hook.ts | 524 | Generate 4-word session name | No (spawns background process) |

**Performance note:** 5 processes spawn on every user message. RatingCapture calls Haiku inference (~1s). SessionAutoName spawns a detached background process for inference upgrade.

### SessionStart (4 hooks + 1 conditional)

| Hook | Lines | Purpose | Blocking? |
|------|-------|---------|-----------|
| TerminalState.hook.ts | 302 | Initialize terminal state | No |
| LoadContext.hook.ts | 536 | Inject dynamic context (relationship, learning, work) | Yes |
| `bun` handlers/BuildCLAUDE.ts | ~150 | Rebuild CLAUDE.md if algo version changed | Yes |
| `bun` handlers/BuildSettings.ts | 282 | Rebuild settings.json if config changed | Yes |
| PostCompactRecovery.hook.ts (matcher: compact) | ~100 | Re-inject context after compaction | Conditional |

**Note:** BuildCLAUDE and BuildSettings use `bun ${PAI_DIR}/hooks/handlers/...` syntax (explicit bun runner) while all other hooks use shebang-based execution.

### Stop (5 hooks — THE PROBLEM AREA)

| Hook | Lines | Purpose | Status |
|------|-------|---------|--------|
| LastResponseCache.hook.ts | ~80 | Cache last response for rating reference | ✅ Works |
| TerminalState.hook.ts | 302 | Reset terminal state | ✅ Works |
| DocIntegrity.hook.ts | 39 | Thin wrapper → handlers/DocCrossRefIntegrity | ✅ Works |
| StopOrchestrator.hook.ts | 123 | Orchestrate TabState + RebuildSkill + AlgorithmEnrichment + DocCrossRef | 🔴 BROKEN (phantom imports) |
| AlgorithmTracker.hook.ts | 188 | Track algorithm phase progress | ✅ Works |

**The Paradox:** StopOrchestrator exists to be the single entry point, but:
1. It crashes on import (2 phantom handlers + wrong TranscriptParser path)
2. 4 other hooks are registered alongside it
3. DocCrossRefIntegrity is called by both DocIntegrity.hook.ts and StopOrchestrator

### SessionEnd (5 hooks)

| Hook | Lines | Purpose |
|------|-------|---------|
| WorkCompletionLearning.hook.ts | 373 | Extract learnings from session |
| SessionCleanup.hook.ts | 270 | Mark work complete, clear state |
| RelationshipMemory.hook.ts | 284 | Capture relationship notes |
| UpdateCounts.hook.ts | 25 | Thin wrapper → handlers/UpdateCounts |
| IntegrityCheck.hook.ts | ~100 | PAI integrity validation |

### ConfigChange (1 hook)

| Hook | Lines | Purpose |
|------|-------|---------|
| ConfigChange.hook.ts | 135 | React to config changes |

---

## StopOrchestrator Deep Dive

### What It Imports

```typescript
// Line 23-28 of StopOrchestrator.hook.ts
import { parseTranscript, extractCompletionPlain, extractStructuredSections } from '../skills/PAI/Tools/TranscriptParser';
                                                                                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                                                                    WRONG PATH — should be ../PAI/Tools/TranscriptParser

import { handleTabState } from './handlers/TabState';           // ✅ EXISTS
import { handleRebuildSkill } from './handlers/RebuildSkill';   // 🔴 DOES NOT EXIST
import { handleAlgorithmEnrichment } from './handlers/AlgorithmEnrichment';  // 🔴 DOES NOT EXIST
import { handleDocCrossRefIntegrity } from './handlers/DocCrossRefIntegrity'; // ✅ EXISTS
```

### What It Runs

```typescript
// Lines 100-106
const handlers: Promise<void>[] = [
    handleTabState(parsed, hookInput.session_id),
    handleRebuildSkill(),                              // 🔴 WOULD CRASH
    handleAlgorithmEnrichment(parsed, hookInput.session_id), // 🔴 WOULD CRASH
    handleDocCrossRefIntegrity(parsed, hookInput),     // ⚠️ ALSO called by DocIntegrity.hook.ts
];
```

### What Actually Exists in handlers/

```
hooks/handlers/
├── BuildCLAUDE.ts      (606 bytes)  — Called by SessionStart, not Stop
├── BuildSettings.ts    (11KB)       — Called by SessionStart, not Stop
├── DocCrossRefIntegrity.ts (32KB)   — Called by DocIntegrity.hook.ts AND StopOrchestrator
├── SystemIntegrity.ts  (5.9KB)      — Called by IntegrityCheck.hook.ts (SessionEnd)
├── TabState.ts         (7KB)        — Called by StopOrchestrator (and TerminalState standalone)
└── UpdateCounts.ts     (9KB)        — Called by UpdateCounts.hook.ts (SessionEnd)
```

**Missing:**
- `AlgorithmEnrichment.ts` — Never created. Likely planned but not implemented.
- `RebuildSkill.ts` — Never created. Was supposed to auto-rebuild SKILL.md from Components/.

---

## File Size Analysis

### Hooks by Size (descending)

| File | Lines | Category |
|------|-------|----------|
| handlers/DocCrossRefIntegrity.ts | 886 | 🔴 Should be split |
| SecurityValidator.hook.ts | 618 | Acceptable (security needs thoroughness) |
| hooks/lib/change-detection.ts | 612 | 🟡 Large for a lib file |
| RatingCapture.hook.ts | 553 | 🔴 Should extract prompt + learning |
| LoadContext.hook.ts | 536 | 🟡 Borderline |
| SessionAutoName.hook.ts | 524 | 🔴 Should extract noise words + inference |
| WorkCompletionLearning.hook.ts | 373 | Acceptable |
| hooks/lib/tab-setter.ts | 363 | 🟡 Large for a lib file |
| TerminalState.hook.ts | 302 | Acceptable |
| handlers/UpdateCounts.ts | 294 | Acceptable |
| hooks/lib/prd-utils.ts | 284 | Acceptable |
| RelationshipMemory.hook.ts | 284 | Acceptable |
| handlers/BuildSettings.ts | 282 | Acceptable |
| SessionCleanup.hook.ts | 270 | Acceptable |
| UpdateTabTitle.hook.ts | 228 | Acceptable |
| hooks/lib/learning-readback.ts | 222 | Acceptable |
| GitHubWriteGuard.hook.ts | 211 | Acceptable |
| hooks/lib/prd-template.ts | 203 | Acceptable |
| hooks/lib/output-validators.ts | 194 | Acceptable |
| handlers/SystemIntegrity.ts | 192 | Acceptable |
| AlgorithmTracker.hook.ts | 188 | Acceptable |
| handlers/TabState.ts | 169 | Acceptable |
| hooks/lib/identity.ts | 148 | Acceptable |
| hooks/lib/time.ts | 137 | Acceptable |
| ConfigChange.hook.ts | 135 | Acceptable |
| StopOrchestrator.hook.ts | 123 | Acceptable (thin orchestrator) |
| AgentExecutionGuard.hook.ts | 109 | Acceptable |
| hooks/lib/payload-schema.ts | 108 | Acceptable |
| hooks/lib/notifications.ts | 92 | Acceptable |

**Total hook system:** 9,569 lines across 42 files (23 hooks + 6 handlers + 17 lib files)

---

## TerminalState Multi-Event Registration

`TerminalState.hook.ts` (302 lines) is registered on 4 different events:

| Event | Matcher | Purpose |
|-------|---------|---------|
| PreToolUse | AskUserQuestion | Set tab to "question" state |
| UserPromptSubmit | (none) | Track prompt state |
| SessionStart | (none) | Initialize state |
| Stop | (none) | Reset to default state |

This is 4 process spawns for one hook across the lifecycle. Each spawn reads stdin, parses JSON, and branches on `hook_event_name`. The alternative would be splitting into event-specific handlers, but the shared state logic may justify the single-file approach.

---

## Duplicate Handler Execution Map

| Handler | Called From | Event | Issue |
|---------|------------|-------|-------|
| handleDocCrossRefIntegrity | DocIntegrity.hook.ts | Stop | ✅ Works |
| handleDocCrossRefIntegrity | StopOrchestrator.hook.ts | Stop | 🔴 Duplicate (masked by crash) |
| handleTabState | StopOrchestrator.hook.ts | Stop | 🔴 Crashes before reaching |
| handleTabState | TerminalState.hook.ts | Stop | ✅ Works (compensates) |

If StopOrchestrator's bugs were fixed without deduplication:
- DocCrossRefIntegrity would run twice per Stop
- TabState reset would run twice per Stop
- Both would create race conditions on their shared state files

---

## Recommended Fix Order

1. **Remove phantom imports** from StopOrchestrator (AlgorithmEnrichment, RebuildSkill)
2. **Fix TranscriptParser path** (`../skills/PAI/Tools/` → `../PAI/Tools/`)
3. **Choose dedup strategy** for DocCrossRefIntegrity:
   - Option A: Remove DocIntegrity.hook.ts from hooks.jsonc (let StopOrchestrator own it)
   - Option B: Remove DocCrossRefIntegrity from StopOrchestrator (let standalone hook own it)
   - Recommendation: Option A — the orchestrator pattern is better long-term
4. **Remove voice remnants** from DocCrossRefIntegrity.ts (lines 870-885)
5. **Long-term:** Complete the orchestrator pattern by moving LastResponseCache, AlgorithmTracker, TerminalState into it
