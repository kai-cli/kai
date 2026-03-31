#!/usr/bin/env bun
/**
 * TaskCompleted.hook.ts - ISC verification gate before task closure (TaskCompleted)
 *
 * PURPOSE:
 * Fires when any task is being marked completed in agent teams.
 * For Algorithm ISC tasks (subjects starting with "ISC-"), enforces that
 * the task description contains verification evidence before closure.
 * Non-ISC tasks pass through freely.
 *
 * TRIGGER: TaskCompleted
 *
 * INPUT:
 * - stdin: Hook input JSON (task_id, subject, description, owner, session_id)
 *
 * OUTPUT:
 * - stdout: Feedback message if blocking (exit 2)
 * - exit(0): Allow completion
 * - exit(2): Block completion, send stdout as feedback to agent
 *
 * ALGORITHM ISC QUALITY CRITERIA (for tasks with "ISC-" subject prefix):
 * The task description must contain ONE of:
 * - "PASS" or "✅" — explicit verification result
 * - "verified:" or "evidence:" — verification evidence label
 * - A CLI command result (contains $ or exit code reference)
 * - A test result reference (pass/fail count)
 */

interface HookInput {
  task_id?: string;
  subject?: string;
  description?: string;
  owner?: string;
  session_id?: string;
}

async function main() {
  try {
    let input: HookInput = {};
    try {
      const raw = await Promise.race([
        Bun.stdin.text(),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
      ]);
      if (raw && raw.trim()) {
        input = JSON.parse(raw);
      }
    } catch {
      // No input — allow completion
      process.exit(0);
    }

    const { subject = '', description = '' } = input;

    // Only enforce on Algorithm ISC tasks
    const isISCTask = /^ISC-/i.test(subject.trim());

    if (!isISCTask) {
      // Non-ISC task — pass through freely
      process.exit(0);
    }

    // ISC task — check for verification evidence in description
    const desc = description.trim();

    const hasPassSignal = /\bPASS\b|✅/.test(desc);
    const hasVerificationLabel = /\b(verified:|evidence:|actual:|check:)/i.test(desc);
    const hasCLIResult = /\$\s+\S+|exit\s+code\s+\d|exit\(0\)/i.test(desc);
    const hasTestResult = /\d+\s*(tests?|criteria)\s*(pass|fail)/i.test(desc);
    const hasExplicitEvidence = desc.length > 50; // At minimum needs some explanation

    const verificationOk = (hasPassSignal || hasVerificationLabel || hasCLIResult || hasTestResult) && hasExplicitEvidence;

    if (!verificationOk) {
      console.log(
        `ISC task "${subject}" cannot be closed without verification evidence. ` +
        `Before marking this criterion complete, add evidence to the task description: ` +
        `(1) State PASS or FAIL explicitly, ` +
        `(2) Include what you checked (e.g., "Ran: curl -f http://... → exit 0"), ` +
        `(3) For numeric thresholds, include the actual computed value. ` +
        `Update the task description with evidence, then mark complete.`
      );
      process.exit(2);
    }

    // Verification evidence found — allow completion
    process.exit(0);
  } catch (error) {
    // Never block on hook error
    console.error(`[TaskCompleted] Error: ${error}`);
    process.exit(0);
  }
}

main();
