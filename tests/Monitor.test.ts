/**
 * Monitor.test.ts - Tests for the Algorithm meta-cognitive monitor
 *
 * Each policy check must have:
 * 1. A test with known-bad input → should return violation
 * 2. A test with known-good input → should return null
 *
 * This validates that gates actually fail when they should (gate validation).
 */

import { describe, test, expect } from "bun:test";
import {
  runMonitor,
  getPolicies,
  getPolicy,
  formatViolations,
  type MonitorContext,
  type PolicyViolation,
} from "../PAI/Tools/algorithm/monitor";

// ─── Test Helpers ────────────────────────────────────────────────────────────

const defaultContext: MonitorContext = {
  sessionMessages: 5,
  hasToolCalls: true,
  hasTests: true,
  mode: 'algorithm',
};

function expectViolation(
  output: string,
  context: MonitorContext = defaultContext,
): PolicyViolation {
  const violations = runMonitor(output, context);
  expect(violations.length).toBeGreaterThan(0);
  return violations[0];
}

function expectNoViolation(
  output: string,
  context: MonitorContext = defaultContext,
): void {
  const violations = runMonitor(output, context);
  expect(violations.length).toBe(0);
}

// ─── Meta Tests ──────────────────────────────────────────────────────────────

describe("Monitor Meta", () => {
  test("getPolicies returns all policies", () => {
    const policies = getPolicies();
    expect(policies.length).toBeGreaterThanOrEqual(12);

    // All policies should have required fields
    for (const policy of policies) {
      expect(policy.id).toBeTruthy();
      expect(policy.name).toBeTruthy();
      expect(policy.description).toBeTruthy();
      expect(typeof policy.check).toBe('function');
    }
  });

  test("getPolicy retrieves specific policy by ID", () => {
    const policy = getPolicy('verify-by-running');
    expect(policy).toBeTruthy();
    expect(policy?.id).toBe('verify-by-running');
  });

  test("policy IDs are unique", () => {
    const policies = getPolicies();
    const ids = policies.map(p => p.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  test("formatViolations produces readable output", () => {
    const violations: PolicyViolation[] = [
      {
        policyId: 'test-policy',
        severity: 'error',
        message: 'Test violation',
        suggestion: 'Fix it',
      },
    ];
    const formatted = formatViolations(violations);
    expect(formatted).toContain('test-policy');
    expect(formatted).toContain('Test violation');
    expect(formatted).toContain('Fix it');
  });

  test("formatViolations handles empty array", () => {
    const formatted = formatViolations([]);
    expect(formatted).toContain('All policy checks passed');
  });
});

// ─── Policy: no-trailing-summary ─────────────────────────────────────────────

describe("Policy: no-trailing-summary", () => {
  test("detects trailing summary paragraph", () => {
    const output = `
Updated configuration in 3 files.
Running tests locally confirmed everything works.
Modified the authentication system.
Added new validation logic.
Updated database schema.
Refactored error handling.
Added comprehensive test coverage.
Updated documentation.

In summary, we've successfully completed all the requested changes.
The changes include updated configuration and passing tests.
These changes ensure better performance going forward.
    `.trim();

    const violation = expectViolation(output);
    expect(violation.policyId).toBe('no-trailing-summary');
    expect(violation.severity).toBe('warning');
  });

  test("allows output without trailing summary", () => {
    const output = `
🔧 CHANGE: Updated config files
Edits done. Verifying now...
✅ VERIFY: 1398 tests passed
📍 STATUS: Done
    `.trim();

    expectNoViolation(output);
  });

  test("allows short output with summary keywords", () => {
    const output = "In summary, do X";
    expectNoViolation(output); // Too short to be flagged
  });
});

// ─── Policy: verify-by-running ───────────────────────────────────────────────

describe("Policy: verify-by-running", () => {
  test("detects verification claim without evidence", () => {
    const output = `
✅ VERIFY: Confirmed that all changes are correct
Everything looks good after reviewing the files.
    `.trim();

    const violation = expectViolation(output);
    expect(violation.policyId).toBe('verify-by-running');
    expect(violation.severity).toBe('error');
  });

  test("allows verification with test output", () => {
    const output = `
✅ VERIFY: All tests pass
$ bun test
1398 tests passed
    `.trim();

    expectNoViolation(output);
  });

  test("allows verification with grep results", () => {
    const output = `
✅ VERIFY: No remaining references
$ grep -r "oldName" .
0 matches found
    `.trim();

    expectNoViolation(output);
  });

  test("allows output without verification claims", () => {
    const output = `
🔧 CHANGE: Updated files
📍 STATUS: Done
    `.trim();

    expectNoViolation(output);
  });
});

// ─── Policy: sweep-not-spot-fix ──────────────────────────────────────────────

describe("Policy: sweep-not-spot-fix", () => {
  test("detects rename without sweep evidence", () => {
    const output = `
Renamed oldFunction to newFunction in utils.ts
Updated all imports in main.ts
    `.trim();

    const violation = expectViolation(output);
    expect(violation.policyId).toBe('sweep-not-spot-fix');
    expect(violation.severity).toBe('error');
  });

  test("allows rename with tree-wide sweep", () => {
    const output = `
Renamed oldFunction to newFunction
$ grep -r "oldFunction" .
0 occurrences remaining
    `.trim();

    expectNoViolation(output);
  });

  test("allows removal with sweep evidence", () => {
    const output = `
Removed deprecated feature
Searched entire tree - no matches in tracked files
    `.trim();

    expectNoViolation(output);
  });

  test("allows output without renames", () => {
    const output = `
Updated configuration values
Added new test coverage
    `.trim();

    expectNoViolation(output);
  });
});

// ─── Policy: describe-before-acting ──────────────────────────────────────────

describe("Policy: describe-before-acting", () => {
  test("detects action on review input without describing", () => {
    const output = `
Required edits before approval:
[Edit] modified: src/utils.ts
[Write] created: tests/new.test.ts
    `.trim();

    const violation = expectViolation(output);
    expect(violation.policyId).toBe('describe-before-acting');
    expect(violation.severity).toBe('error');
  });

  test("allows review response with intent description", () => {
    const output = `
Required edits before approval:

Here's what I'd change:
- Fix the validation logic in utils.ts
- Add test coverage for edge cases

Want me to go ahead with these changes?
    `.trim();

    expectNoViolation(output);
  });

  test("allows direct work without review language", () => {
    const output = `
[Edit] modified: src/utils.ts
Updated validation logic per your request
    `.trim();

    expectNoViolation(output);
  });
});

// ─── Policy: simple-commands ─────────────────────────────────────────────────

describe("Policy: simple-commands", () => {
  test("detects long pipe chains", () => {
    const output = `
$ find . -name "*.ts" | grep -v node_modules | xargs grep "pattern" | sort | uniq
    `.trim();

    const violation = expectViolation(output);
    expect(violation.policyId).toBe('simple-commands');
    expect(violation.severity).toBe('warning');
  });

  test("detects long && chains", () => {
    const output = `
$ cd src && npm install && npm test && npm run build && npm publish
    `.trim();

    const violation = expectViolation(output);
    expect(violation.policyId).toBe('simple-commands');
    expect(violation.severity).toBe('warning');
  });

  test("allows simple commands", () => {
    const output = `
$ grep -r "pattern" src/
$ npm test
    `.trim();

    expectNoViolation(output);
  });

  test("ignores output without tool calls", () => {
    const output = `
$ find . | grep x | sort | uniq | wc
    `.trim();

    const context = { ...defaultContext, hasToolCalls: false };
    expectNoViolation(output, context);
  });
});

// ─── Policy: no-over-asking ──────────────────────────────────────────────────

describe("Policy: no-over-asking", () => {
  test("detects unnecessary commit permission request", () => {
    const output = `
All changes complete and tests passing.
Should I commit these changes?
    `.trim();

    const violation = expectViolation(output);
    expect(violation.policyId).toBe('no-over-asking');
    expect(violation.severity).toBe('warning');
  });

  test("detects unnecessary push permission request", () => {
    const output = `
Changes committed. Want me to push to origin?
    `.trim();

    const violation = expectViolation(output);
    expect(violation.policyId).toBe('no-over-asking');
    expect(violation.severity).toBe('warning');
  });

  test("allows questions about risky operations", () => {
    const output = `
Ready to force push to main?
    `.trim();

    expectNoViolation(output);
  });

  test("allows output without permission requests", () => {
    const output = `
Changes committed and pushed to feature branch.
    `.trim();

    expectNoViolation(output);
  });
});

// ─── Policy: signal-verification-phases ──────────────────────────────────────

describe("Policy: signal-verification-phases", () => {
  test("detects verification without phase signal", () => {
    const output = `
🔧 CHANGE: Updated files
✅ VERIFY: 1398 tests passing
    `.trim();

    const violation = expectViolation(output);
    expect(violation.policyId).toBe('signal-verification-phases');
    expect(violation.severity).toBe('warning');
  });

  test("allows verification with phase signal", () => {
    const output = `
🔧 CHANGE: Updated files
Edits done. Verifying now...
✅ VERIFY: 1398 tests passed
    `.trim();

    expectNoViolation(output);
  });

  test("ignores in non-algorithm modes", () => {
    const output = `
✅ VERIFY: 1398 tests passed
    `.trim();

    const context = { ...defaultContext, mode: 'native' as const };
    expectNoViolation(output, context);
  });
});

// ─── Policy: gates-must-fail ─────────────────────────────────────────────────

describe("Policy: gates-must-fail", () => {
  test("detects gate implementation without failure test", () => {
    const output = `
Added verification gate for hook counts.
Created new check in verify-release.sh.
    `.trim();

    const violation = expectViolation(output);
    expect(violation.policyId).toBe('gates-must-fail');
    expect(violation.severity).toBe('error');
  });

  test("allows gate with failure test", () => {
    const output = `
Added verification gate for hook counts.
Deliberately broke the count to confirm gate fails.
Gate correctly catches mismatches.
    `.trim();

    expectNoViolation(output);
  });

  test("allows output without gate implementation", () => {
    const output = `
Updated documentation files
Added new test coverage
    `.trim();

    expectNoViolation(output);
  });
});

// ─── Policy: diagnose-before-pushing ─────────────────────────────────────────

describe("Policy: diagnose-before-pushing", () => {
  test("detects push suggestion with failures present", () => {
    const output = `
3 tests failed in CI
Let's push the fix and see if it works
    `.trim();

    const violation = expectViolation(output);
    expect(violation.policyId).toBe('diagnose-before-pushing');
    expect(violation.severity).toBe('error');
  });

  test("allows push suggestion after fixing failures", () => {
    const output = `
All tests passing locally
Ready to push to origin
    `.trim();

    expectNoViolation(output);
  });

  test("allows output without push suggestions", () => {
    const output = `
5 tests failed
Investigating the root cause
    `.trim();

    expectNoViolation(output);
  });
});

// ─── Policy: no-empty-verify ─────────────────────────────────────────────────

describe("Policy: no-empty-verify", () => {
  test("detects empty VERIFY section", () => {
    const output = `
✅ VERIFY: Looks good
🔧 CHANGE: Updated files
    `.trim();

    // This should trigger no-empty-verify first, but may also trigger verify-by-running
    // So let's just check that at least one violation is for no-empty-verify
    const violations = runMonitor(output, defaultContext);
    expect(violations.length).toBeGreaterThan(0);
    const hasEmptyVerify = violations.some(v => v.policyId === 'no-empty-verify');
    expect(hasEmptyVerify).toBe(true);
  });

  test("allows VERIFY with specific evidence", () => {
    const output = `
🔧 CHANGE: Updated files
Edits done. Verifying now...
✅ VERIFY: 1398 tests passed, 0 failed
$ grep -r "oldName" .
0 remaining references
    `.trim();

    expectNoViolation(output);
  });

  test("allows output without VERIFY section", () => {
    const output = `
🔧 CHANGE: Updated files
📍 STATUS: Done
    `.trim();

    expectNoViolation(output);
  });
});

// ─── Policy: quality-over-tokens ─────────────────────────────────────────────

describe("Policy: quality-over-tokens", () => {
  test("detects token-focused algorithm change", () => {
    const output = `
Algorithm v3.15.0 changes:
- Merged OBSERVE and ORIENT to save 2000 tokens
- Removed examples to reduce token count
    `.trim();

    const violation = expectViolation(output);
    expect(violation.policyId).toBe('quality-over-tokens');
    expect(violation.severity).toBe('error');
  });

  test("allows quality-focused algorithm change", () => {
    const output = `
Algorithm v3.15.0 changes:
- Enhanced OBSERVE phase for better ISC extraction
- This produces better results by improving context capture
    `.trim();

    expectNoViolation(output);
  });

  test("allows algorithm change with both quality and efficiency", () => {
    const output = `
Algorithm v3.15.0 changes:
- Streamlined OBSERVE phase for better results
- Also reduces tokens as a side benefit
    `.trim();

    expectNoViolation(output);
  });
});

// ─── Policy: test-hooks-actually-run ─────────────────────────────────────────

describe("Policy: test-hooks-actually-run", () => {
  test("detects hook modification without smoke test", () => {
    const output = `
Modified hooks/SessionStart.hook.ts
Updated import paths and fixed logic
    `.trim();

    const violation = expectViolation(output);
    expect(violation.policyId).toBe('test-hooks-actually-run');
    expect(violation.severity).toBe('error');
  });

  test("allows hook modification with smoke test", () => {
    const output = `
Modified hooks/SessionStart.hook.ts
$ bun hooks/SessionStart.hook.ts < /dev/null
No import errors - hook loads successfully
    `.trim();

    expectNoViolation(output);
  });

  test("allows output without hook modifications", () => {
    const output = `
Updated configuration files
Added new tests
    `.trim();

    expectNoViolation(output);
  });
});

// ─── Integration Tests ───────────────────────────────────────────────────────

describe("Monitor Integration", () => {
  test("returns multiple violations when multiple policies violated", () => {
    const output = `
Renamed oldFunc to newFunc in one file.
✅ VERIFY: Looks correct
Should I commit these changes?
    `.trim();

    const violations = runMonitor(output, defaultContext);
    expect(violations.length).toBeGreaterThanOrEqual(2); // sweep + no-empty-verify at minimum
  });

  test("returns empty array for clean output", () => {
    const output = `
🔧 CHANGE: Updated configuration files
Edits done. Verifying now...
✅ VERIFY: Tests passed (1398/1398)
$ grep -r "oldValue" .
0 matches
📍 STATUS: Done
    `.trim();

    const violations = runMonitor(output, defaultContext);
    expect(violations.length).toBe(0);
  });

  test("context affects which policies trigger", () => {
    const output = `
🔧 CHANGE: Updated files
✅ VERIFY: 1398 tests passing
    `.trim();

    // In algorithm mode with edits + verify, missing signal is a warning
    const algoViolations = runMonitor(output, {
      ...defaultContext,
      mode: 'algorithm',
    });
    expect(algoViolations.length).toBeGreaterThan(0);
    expect(algoViolations.some(v => v.policyId === 'signal-verification-phases')).toBe(true);

    // In native mode, signal-verification-phases doesn't check
    const nativeViolations = runMonitor(output, {
      ...defaultContext,
      mode: 'native',
    });
    expect(nativeViolations.every(v => v.policyId !== 'signal-verification-phases')).toBe(true);
  });
});
