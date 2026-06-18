# SessionEndComposite Hook

## Overview

The SessionEndComposite hook consolidates 9 individual SessionEnd hooks into a single orchestrator that applies a heuristic gate to skip expensive inference hooks on trivial sessions.

## Problem Statement

Previously, 9 hooks fired simultaneously at SessionEnd:

1. WorkCompletionLearning (inference)
2. MemoryTimeline (simple)
3. SessionCleanup (simple)
4. SessionSummary (inference)
5. RelationshipMemory (inference)
6. UpdateCounts (simple)
7. IntegrityCheck (simple)
8. InsightExtractor (inference)
9. KnowledgeSync (inference)

This caused unnecessary LLM inference calls on trivial sessions (e.g., "Hello PAI" → "Ready" sessions with 2 messages).

## Solution

The SessionEndComposite hook:

1. **Analyzes the transcript** to determine if the session was trivial
2. **Applies a heuristic gate**:
   - Trivial: `messages < 6 AND totalTokens < 2000`
   - Bypass gate if transcript contains `/feedback`
3. **Runs hooks selectively**:
   - Always run: SessionCleanup, UpdateCounts, MemoryTimeline, IntegrityCheck
   - Conditionally run (only if NOT trivial): InsightExtractor, KnowledgeSync, WorkCompletionLearning, SessionSummary, RelationshipMemory
4. **Executes in parallel** using `Promise.allSettled()` so one failure doesn't block others
5. **Tracks with sentinels** using `markStarted`/`markComplete` for crash recovery

## Heuristic Gate Details

### Trivial Session Criteria

A session is considered "trivial" if:
- Message count < 6 messages, AND
- Estimated tokens < 2000 tokens

Token estimation: `transcript_length / 4` (rough approximation)

### Gate Bypass

The gate is always bypassed (all hooks run) if:
- The transcript contains the string `/feedback`

This ensures feedback sessions always capture full learning data.

### Hook Classification

**Simple hooks** (always run, <100ms execution):
- SessionCleanup: Marks work complete, clears state
- UpdateCounts: Updates counts in settings.json
- MemoryTimeline: Appends to timeline.jsonl
- IntegrityCheck: Validates system integrity

**Inference hooks** (gated, may call LLM):
- InsightExtractor: Extracts learnings from transcript
- KnowledgeSync: Updates knowledge domains
- WorkCompletionLearning: Captures work completion insights
- SessionSummary: Generates session summary
- RelationshipMemory: Extracts relationship notes

## Architecture

### Hook Execution

Each sub-hook is spawned as a separate process:

```typescript
const hookProcess = spawn('bun', [hookPath], {
  stdio: ['pipe', 'inherit', 'inherit'],
  env: { ...process.env },
});

// Pass input via stdin
hookProcess.stdin.write(JSON.stringify(input));
hookProcess.stdin.end();
```

### Sentinel Tracking

Each hook is wrapped with sentinel tracking:

```typescript
markStarted(hookName, sessionId);  // Creates .started file
// ... run hook ...
markComplete(hookName, sessionId); // Renames to .complete
```

If the process crashes, `.started` files without matching `.complete` files indicate incomplete hooks.

### Error Handling

- Uses `Promise.allSettled()` so one hook failure doesn't block others
- Each hook logs errors to stderr but never fails the session
- Exit code is always 0 (non-blocking)

## Configuration

### settings.json

Replace the 9 individual SessionEnd hooks with:

```json
"SessionEnd": [
  {
    "hooks": [
      {
        "type": "command",
        "command": "/Users/your.name/.claude/hooks/lib/run-hook.sh SessionEndComposite.hook.ts",
        "async": true
      }
    ]
  }
]
```

## Testing

### Unit Tests

```bash
bun test tests/SessionEndComposite.test.ts
```

Tests cover:
- Transcript analysis (message count, token estimation)
- Trivial session detection
- `/feedback` bypass
- Edge cases (empty transcript, malformed JSON, etc.)

### Manual Testing

```bash
bun tests/test-session-end-composite-manual.ts
```

Tests three scenarios:
1. Trivial session (2 messages)
2. Substantial session (10 messages, 5000 tokens)
3. Feedback session (4 messages with `/feedback`)

## Performance

### Before Consolidation

- 9 hooks spawned simultaneously
- All inference hooks run on every session
- ~2-5 seconds per trivial session

### After Consolidation

- 1 hook spawned (orchestrator)
- Only 4 hooks run on trivial sessions
- ~200ms per trivial session (95% reduction)
- Substantial sessions unchanged

## Monitoring

Check stderr output for:

```
[SessionEndComposite] Trivial session detected (msgs=2, tokens~400) - skipping inference hooks
[SessionEndComposite] Running 4 hooks in parallel
[SessionEndComposite] Complete: 4 succeeded, 0 failed
```

or

```
[SessionEndComposite] Substantial session (msgs=10, tokens~5000) - running all hooks
[SessionEndComposite] Running 9 hooks in parallel
[SessionEndComposite] Complete: 9 succeeded, 0 failed
```

## Migration Notes

### Backward Compatibility

The composite hook maintains backward compatibility:
- All original hooks still exist as separate files
- Each hook can still be run independently
- Hook input/output format unchanged

### Rollback

To rollback, restore the original settings.json configuration with 9 individual hooks.

## Future Improvements

1. **Dynamic thresholds**: Learn optimal thresholds from historical data
2. **More sophisticated gate**: Use LLM to classify session significance
3. **Selective hook running**: Different hook sets for different session types (debug vs. chat vs. planning)
4. **Parallel execution optimization**: Batch similar hooks together
5. **Metrics collection**: Track gate accuracy and hook execution times

## Related Files

- `hooks/SessionEndComposite.hook.ts` - Main orchestrator
- `hooks/lib/session-end-tracker.ts` - Sentinel tracking
- `hooks/lib/hook-io.ts` - Hook input/output utilities
- `tests/SessionEndComposite.test.ts` - Unit tests
- `tests/test-session-end-composite-manual.ts` - Manual integration tests

## Version History

- **v6.5.0** (2026-05-27): Initial implementation
