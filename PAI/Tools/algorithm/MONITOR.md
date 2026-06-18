# Algorithm Meta-Cognitive Monitor

A post-generation linter that enforces quality policies extracted from user feedback memories.

## Purpose

The Algorithm Monitor transforms feedback patterns into testable policy checks. Rather than relying on prompts alone, it provides a concrete verification layer that can:

1. Detect anti-patterns in generated output
2. Provide actionable suggestions
3. Be independently tested with known-bad inputs (gate validation)
4. Run as a post-generation quality check

## Architecture

```
monitor.ts
├── PolicyCheck interface - Each policy is a check function
├── 12 policy implementations - Extracted from feedback memories
└── runMonitor() - Executes all checks and returns violations
```

## Policy Checks (12 total)

1. **no-trailing-summary** - Avoid restating what was done
2. **verify-by-running** - Claims require executable evidence
3. **sweep-not-spot-fix** - Renames need tree-wide sweep proof
4. **describe-before-acting** - Reviews need intent description
5. **simple-commands** - Prefer simple over compound bash
6. **no-over-asking** - Don't ask for obvious next steps
7. **signal-verification-phases** - Announce phase transitions
8. **gates-must-fail** - Test that checks actually fail
9. **diagnose-before-pushing** - Fix failures before pushing
10. **no-empty-verify** - VERIFY needs specific evidence
11. **quality-over-tokens** - Justify changes by quality not size
12. **test-hooks-actually-run** - Smoke test modified hooks

## Usage

```typescript
import { runMonitor, formatViolations } from './monitor';

const output = "...generated output...";
const context = {
  sessionMessages: 10,
  hasToolCalls: true,
  hasTests: true,
  mode: 'algorithm',
};

const violations = runMonitor(output, context);
console.log(formatViolations(violations));
```

## Design Principles

- **Low false-positive rates** - Better to miss than annoy
- **Context-aware** - Some checks only apply in certain modes
- **Advisory, not blocking** - Returns violations but doesn't block
- **Testable** - Each policy has known-bad and known-good test cases

## Integration Points

The monitor is designed to be called:
- After Algorithm output generation (post-generation linting)
- In CI/CD for quality gates
- In development tools for real-time feedback

## Testing

Each policy has comprehensive tests in `tests/Monitor.test.ts`:
- Known-bad input → should return violation
- Known-good input → should return null
- Multiple violations → returns all
- Context sensitivity → correct mode handling

Run tests:
```bash
PAI_DIR=/path/to/kai bun test tests/Monitor.test.ts
```

## Future Enhancements

- [ ] Integration with Algorithm loop (automatic policy checking)
- [ ] Dashboard visualization of policy violations over time
- [ ] Policy weight/priority system (errors vs warnings)
- [ ] Per-project policy configuration
- [ ] Learning from user corrections (policy refinement)
