#!/usr/bin/env bun
/**
 * monitor.example.ts - Example usage of the Algorithm meta-cognitive monitor
 *
 * The monitor is a post-generation linter that checks Algorithm output
 * against policies extracted from user feedback memories.
 */

import {
  runMonitor,
  getPolicies,
  formatViolations,
  type MonitorContext,
} from "./monitor";

// ─── Example 1: Check a typical Algorithm output ────────────────────────────

const exampleOutput = `
═══ PAI | ALGORITHM MODE ══════════════════════════════
🗒️ TASK: Refactor authentication system

🔧 CHANGE: Updated 3 files
- Modified src/auth.ts
- Updated tests/auth.test.ts
- Refactored middleware/auth.middleware.ts

Edits done. Verifying now...

✅ VERIFY: All checks passing
$ bun test
1398 tests passed

$ grep -r "oldAuthFunction" .
0 matches found

📍 STATUS: ✅ Done
🗣️ PAI: Authentication refactored and verified
`;

const context: MonitorContext = {
  sessionMessages: 10,
  hasToolCalls: true,
  hasTests: true,
  mode: 'algorithm',
};

console.log("Example 1: Checking clean Algorithm output\n");
const violations = runMonitor(exampleOutput, context);
console.log(formatViolations(violations));
console.log();

// ─── Example 2: Check output with policy violations ─────────────────────────

const problematicOutput = `
═══ PAI | ALGORITHM MODE ══════════════════════════════
🗒️ TASK: Update configuration

🔧 CHANGE: Updated config files
✅ VERIFY: Looks good

Should I commit these changes?
`;

console.log("Example 2: Checking problematic output\n");
const violations2 = runMonitor(problematicOutput, context);
console.log(formatViolations(violations2));
console.log();

// ─── Example 3: List all available policies ─────────────────────────────────

console.log("Example 3: Available policy checks\n");
const policies = getPolicies();

for (const policy of policies) {
  console.log(`• ${policy.id}`);
  console.log(`  ${policy.description}\n`);
}

console.log(`Total policies: ${policies.length}`);
