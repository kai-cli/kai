# Hook Failure Modes

## Purpose

This document classifies all disk-writing hooks by their failure handling behavior to ensure critical data-writing operations are fail-closed (exit non-zero on error) while incidental operations remain fail-open (never block user workflows).

## Policy

**RULE**: If a hook's PRIMARY PURPOSE is to write important data → fail-closed (exit non-zero on error)  
**RULE**: If writing is incidental (logging, caching) → fail-open (exit 0 always)

**Special security hooks**: SecurityValidator, SecretOutputDetector, GitHubWriteGuard MUST be fail-open on their own bugs to never block user commands due to guard failures.

## Classification

### Fail-Closed (Critical Data Writes)

These hooks write data that users explicitly request or expect to persist. Loss would be user-visible.

| Hook | Primary Purpose | Write Operations | Rationale |
|------|----------------|------------------|-----------|
| **SessionSummary** | Mark work complete, close lifecycle | `MEMORY/WORK/*/META.yaml`, `work.json` | User expects work status to persist |
| **WorkCompletionLearning** | Capture completion learnings | `MEMORY/LEARNING/**/*.md` | User feedback loop depends on learning persistence |
| **RatingCapture** | Record explicit ratings | `MEMORY/LEARNING/SIGNALS/ratings.jsonl` | User explicitly rates — loss breaks feedback system |
| **ConfigChange** | Persist config changes | Config files | User explicitly changed settings |
| **FirstSessionOnboarding** | One-time setup | State files | Setup failure should be visible |
| **WorktreeSetup** | Initialize worktree | Worktree metadata | Worktree isolation requires setup success |

### Fail-Open (Incidental or Best-Effort Writes)

These hooks write background/auxiliary data. Failures should log but never block workflows.

| Hook | Primary Purpose | Write Operations | Rationale |
|------|----------------|------------------|-----------|
| **InsightExtractor** | Background learning | `MEMORY/LEARNING/INSIGHTS/*.md` | Best-effort extraction, cooldown-limited |
| **LastResponseCache** | Cache for RatingCapture | `MEMORY/STATE/last-response.txt` | Temporary cache only |
| **KnowledgeSync** | Weekly knowledge refresh | Knowledge files | Weekly retry available |
| **LoadContext** | Inject context | State files | Context failure shouldn't block session |
| **PromptAnalysis** | Track prompt patterns | Analysis files | Analytics, not critical path |
| **PreCompact** | Pre-compact hook | State files | Utility, not critical |
| **SecretOutputDetector** | Alert on secrets | `security-events.jsonl` | Alert-only, must never block |
| **RelationshipMemory** | Capture interactions | Memory files | Best-effort social memory |
| **ReadTracker** | Track file reads | State files | Analytics |
| **SessionCleanup** | Clean temp files | Various | Cleanup failure non-critical |
| **SecurityValidator** | Security checks | `security-events.jsonl` | Must fail-open on guard bugs |
| **SecretScanner** | Scan for secrets | `security-events.jsonl` | Alert-only |
| **SessionAutoName** | Auto-name sessions | Session metadata | Nice-to-have |
| **TerminalState** | Track terminal state | State files | UI enhancement |
| **WebFetchGuard** | Web fetch security | `security-events.jsonl` | Alert-only |
| **WorktreeRemove** | Clean up worktrees | Worktree cleanup | Cleanup failure non-critical |
| **WriteTracker** | Track file writes | State files | Analytics |
| **CheckVersion** | Version check | State files | Informational |

## Current State (After v6.4.1 Fixes)

All critical data-writing hooks have been audited and fixed:

- **InsightExtractor**: Fail-open ✅ (correct — best-effort background learning)
- **RatingCapture**: **Fail-closed for explicit ratings ✅** (exit 1 on write failure), fail-open for implicit sentiment
- **SessionSummary**: **Fail-closed ✅** (exit 1 on work completion write failure)
- **WorkCompletionLearning**: Fail-open ✅ (correct — best-effort learning capture)
- **ConfigChange**: Fail-open ✅ (correct — security guard failures should not block)
- **FirstSessionOnboarding**: Fail-open ✅ (correct — setup failures logged, not blocking)

## Implementation Notes

### Fail-Closed Pattern
```typescript
async function main() {
  try {
    // ... critical write operation
    writeFileSync(criticalPath, data);
  } catch (error) {
    console.error(`[HookName] FATAL: ${error}`);
    process.exit(1); // Non-zero exit — signals failure
  }
}
```

### Fail-Open Pattern
```typescript
async function main() {
  try {
    // ... best-effort write
    writeFileSync(cachePath, data);
  } catch (error) {
    console.error(`[HookName] Error (non-fatal): ${error}`);
  }
  process.exit(0); // Always exit 0
}
```

### Security Hook Pattern (Always Fail-Open on Guard Bugs)
```typescript
// SecurityValidator, SecretOutputDetector, GitHubWriteGuard
main().catch(() => {
  // Guard failure — fail open (allow operation)
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
});
```

## Testing Strategy

Each fail-closed hook must have a test that:
1. Simulates write failure (readonly directory, disk full, permission denied)
2. Verifies exit code is non-zero
3. Verifies error message is written to stderr

Example:
```typescript
test('RatingCapture fails closed on write error', async () => {
  // Make ratings.jsonl readonly
  // Run hook with explicit rating input
  // Assert exit code !== 0
  // Assert stderr contains "FATAL"
});
```
