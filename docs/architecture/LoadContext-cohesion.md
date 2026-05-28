# LoadContext.hook.ts — Why It's Not Split

## Background

LoadContext.hook.ts is 823 lines, which triggered investigation during v6.3 planning.
The question: should it be split into LoadStaticContext, LoadDynamicContext, and LoadNudges?

## Decision: Keep It Unified

**Rationale:**

1. **Unified token budget** — Lines 654-661 apply a single budget cap across knowledge, learning, and relationship context. Splitting would require either:
   - Duplicating budget logic in each hook (fragile)
   - Passing state between hooks (complex)
   - Abandoning unified budget (regresses UX)

2. **Ordering dependencies** — The sections have subtle ordering:
   - Index memory initialization must happen before disclosure
   - Instinct decay must happen before surfacing
   - Budget must be applied after all context is loaded but before injection
   - Splitting would expose these as cross-hook dependencies

3. **Single responsibility** — Despite the length, the hook has ONE job: inject dynamic context at session start. The sections are implementation details, not separate responsibilities.

4. **Once-per-session guard** — Lines 548-552 prevent re-runs. Splitting into 3 hooks would require either:
   - Each hook checking separately (wasteful, racy)
   - Orchestrator hook that calls the 3 (adds indirection without benefit)

5. **Cohesive data flow** — All sections contribute to a single `<system-reminder>` block (lines 715-720). They're not independent outputs.

## What Makes It Readable Despite Length

- **Clear section headers** — Each major section has a comment block
- **Extracted helper functions** — Complex logic lives in lib/ modules:
  - `lib/learning-readback.ts` — Learning digest, wisdom frames, failure patterns
  - `lib/knowledge-readback.ts` — Cross-project knowledge injection
  - `lib/instinct-store.ts` — Instinct decay and surfacing
  - `lib/memory-disclosure.ts` — Index memory management
- **Linear flow** — Top-to-bottom execution, no complex branching
- **Testable pieces** — applyTokenBudget() exported for unit testing (lines 497-529)

## Alternative Considered: Extract Large Helpers

Instead of splitting the hook itself, we could extract more helpers:

```typescript
// hooks/lib/context-loaders.ts
export function loadAllContextSources(paiDir: string, settings: Settings): ContextBundle {
  // Aggregates relationship, learning, knowledge, instinct context
}

// hooks/lib/context-budget.ts
export function applyTokenBudgetToBundle(bundle: ContextBundle): ContextBundle {
  // Unified budget logic
}
```

This would reduce LoadContext to ~400 lines (orchestration only), while preserving:
- Unified token budget
- Single once-per-session guard
- Cohesive data flow

**Not implemented yet** — Waiting for real pain points. Premature extraction risks over-abstraction.

## Future Split Criteria

Split LoadContext IF:

1. **Different trigger conditions** — e.g., "load static context once per day, dynamic context every session"
2. **Independent token budgets** — e.g., "knowledge has 10k budget, learning has 5k budget"
3. **User configuration** — e.g., "allow disabling relationship context but keeping learning context"
   - (Note: This exists via dynamicContext config, but doesn't require splitting — lines 84-88 handle it)
4. **Performance isolation** — e.g., "static context is cached, dynamic context is always fresh"

Currently, NONE of these apply.

## Conclusion

LoadContext.hook.ts is long but not complex. It's a single cohesive unit with clear internal structure.
Splitting it would add complexity without solving a real problem.

If length becomes a maintenance burden, extract more helpers (not hooks).
