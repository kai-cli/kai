#!/usr/bin/env bun
/**
 * TeammateIdle.hook.ts - Quality gate on agent team idle transitions (TeammateIdle)
 *
 * PURPOSE:
 * Fires when a teammate is about to go idle. Checks that the teammate's
 * last message contains structured output (not just "done" or empty).
 * Exit code 2 = block idle + send feedback. Exit code 0 = allow idle.
 *
 * TRIGGER: TeammateIdle
 *
 * INPUT:
 * - stdin: Hook input JSON (session_id, transcript_path, agent_type, agent_id, last_message?)
 *
 * OUTPUT:
 * - stdout: Feedback message if blocking (exit 2)
 * - exit(0): Allow idle
 * - exit(2): Block idle, send stdout as feedback to teammate
 *
 * QUALITY CRITERIA (teammate must have produced ONE of):
 * - JSON with result/findings/output/data keys
 * - Structured markdown (## headers or bullet lists)
 * - A completion signal ("completed", "done", "finished", "passing")
 * - Any non-trivial content (>100 chars)
 */

interface HookInput {
  session_id?: string;
  transcript_path?: string;
  agent_type?: string;
  agent_id?: string;
  last_message?: string;
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
      // No input or parse error — allow idle (don't block on hook failure)
      process.exit(0);
    }

    const { last_message, agent_type } = input;

    // If no message content available, allow idle (can't inspect without content)
    if (!last_message) {
      process.exit(0);
    }

    const msg = last_message.trim();

    // Quality signals that indicate substantive output
    const hasJSON = msg.startsWith('{') || msg.startsWith('[');
    const hasMarkdownHeaders = /^#{1,3} /m.test(msg);
    const hasBulletList = /^[-*] /m.test(msg);
    const hasCompletionSignal = /\b(completed|done|finished|passing|verified|complete)\b/i.test(msg);
    const isSubstantial = msg.length > 100;

    const qualityOk = hasJSON || hasMarkdownHeaders || hasBulletList || hasCompletionSignal || isSubstantial;

    if (!qualityOk) {
      // Block idle — request structured output
      console.log(
        `Your last message appears to be too brief or lacks structured output. ` +
        `Please provide a complete summary of what you accomplished, including: ` +
        `(1) what you found/built, (2) any key decisions made, (3) pass/fail status for your assigned criteria. ` +
        `Use markdown headers or bullet points to organize your response.`
      );
      process.exit(2);
    }

    // Allow idle
    process.exit(0);
  } catch (error) {
    // Never block on hook error
    console.error(`[TeammateIdle] Error: ${error}`);
    process.exit(0);
  }
}

main();
