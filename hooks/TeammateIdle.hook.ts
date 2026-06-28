#!/usr/bin/env bun
/**
 * TeammateIdle.hook.ts - Quality gate on agent team idle transitions (TeammateIdle)
 *
 * PURPOSE:
 * Fires when a teammate is about to go idle. Checks that the teammate's
 * teammate identity is present and, when a future payload includes message content,
 * that content is structured enough to be useful.
 * Exit code 2 = block idle + send feedback. Exit code 0 = allow idle.
 *
 * TRIGGER: TeammateIdle
 *
 * INPUT:
 * - stdin: Hook input JSON (session_id, transcript_path, teammate_name, team_name)
 *
 * OUTPUT:
 * - stderr: Feedback message if blocking (exit 2)
 * - exit(0): Allow idle
 * - exit(2): Block idle, send stderr as feedback to teammate
 *
 * QUALITY CRITERIA (teammate must have produced ONE of):
 * - JSON with result/findings/output/data keys
 * - Structured markdown (## headers or bullet lists)
 * - A completion signal ("completed", "done", "finished", "passing")
 * - Any non-trivial content (>100 chars)
 */
import { agentUpdateStatus } from './lib/algorithm-state';
import { emitMemoryTelemetry } from './lib/memory-telemetry';

interface HookInput {
  session_id?: string;
  transcript_path?: string;
  teammate_name?: string;
  team_name?: string;
  last_message?: string; // Legacy/future optional field; current Claude payload does not include it.
  cwd?: string;
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

    const { last_message, teammate_name } = input;

    // Current Claude payload exposes teammate/team identity but not last_message.
    // Do not return early before validating the current payload surface: at minimum,
    // a nameless teammate idle event is not actionable and should be fed back.
    if (!teammate_name?.trim()) {
      console.error(
        `TeammateIdle payload is missing teammate_name, so PAI cannot attribute the idle transition. ` +
        `Retry with a current Claude TeammateIdle payload that includes teammate_name.`
      );
      process.exit(2);
    }

    // If no message content is available, allow idle; current Claude payloads do not include it.
    if (!last_message) {
      emitIdle(input, false);
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
      console.error(
        `Your last message appears to be too brief or lacks structured output. ` +
        `Please provide a complete summary of what you accomplished, including: ` +
        `(1) what you found/built, (2) any key decisions made, (3) pass/fail status for your assigned criteria. ` +
        `Use markdown headers or bullet points to organize your response.`
      );
      process.exit(2);
    }

    // Allow idle
    emitIdle(input, true);
    process.exit(0);
  } catch (error) {
    // Never block on hook error
    console.error(`[TeammateIdle] Error: ${error}`);
    process.exit(0);
  }
}

main().catch((err) => { console.error(`[TeammateIdle] Error:`, err); process.exit(0); });

export {};

function emitIdle(input: HookInput, hadMessage: boolean): void {
  emitMemoryTelemetry('agent.idle', {
    session_id: input.session_id,
    project: projectName(input),
    teammate_name: input.teammate_name,
    team_name: input.team_name,
    had_message: hadMessage,
  });
  if (input.session_id && input.teammate_name) {
    agentUpdateStatus(input.session_id, input.teammate_name, 'idle');
  }
}

function projectName(input: HookInput): string {
  const dir = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
  return dir.split('/').filter(Boolean).pop() ?? 'unknown';
}
