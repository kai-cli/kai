#!/usr/bin/env bun
/**
 * AgentMemoryCapture.hook.ts — Phase-0 capture-loss guard (MEMORY-ARCHITECTURE-PLAN.md §7 Phase 0).
 *
 * THE PROBLEM IT PLUGS: subagents (the Agent tool; formerly Task) cannot persist memory themselves — no
 * CLAUDE.md, no memory hooks fire inside them (#69260). So when an Agent subagent returns, whatever it
 * learned dies unless the PARENT checkpoints it. The rayhunter loss was exactly this class amplified.
 *
 * TRIGGER: PostToolUse:Agent (fires IN THE PARENT when a subagent returns).
 * Verified payload shape: tool_input.{subagent_type,description}, result in tool_response.
 *
 * WHAT IT DOES (non-blocking, advisory): emits an agent.return + agent.checkpoint telemetry event, and
 * surfaces a terse additionalContext reminder nudging the parent to persist any durable learning from
 * the returned subagent (memcarry capture-lesson / project memory). It NEVER blocks and NEVER writes
 * memory itself — it makes the loss visible + prompts the only actor that can save (the parent).
 *
 * NON-NEGOTIABLE: exits 0 on every path; any error is swallowed (mirrors ReadActivity hygiene).
 */
import { agentCallId } from './lib/agent-context-handoff';
import { emitMemoryTelemetry } from './lib/memory-telemetry';

interface HookInput {
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: { subagent_type?: string; description?: string; prompt?: string; run_in_background?: boolean };
  tool_response?: unknown;
}

function readStdin(): HookInput {
  try {
    return JSON.parse(require('node:fs').readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function projectName(input: HookInput): string {
  const dir = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
  return dir.split('/').filter(Boolean).pop() ?? 'unknown';
}

/** Rough size of the returned result — a proxy for "did the subagent produce substantive output worth keeping". */
function resultSize(resp: unknown): number {
  try {
    if (typeof resp === 'string') return resp.length;
    if (resp == null) return 0;
    return JSON.stringify(resp).length;
  } catch {
    return 0;
  }
}

function resultText(resp: unknown): string {
  try {
    if (typeof resp === 'string') return resp;
    if (resp == null) return '';
    return JSON.stringify(resp);
  } catch {
    return '';
  }
}

function hasDurableCheckpointMarker(resp: unknown): boolean {
  return /Durable findings for parent checkpoint\s*:/i.test(resultText(resp));
}

type AgentReturnStatus = 'ok' | 'partial' | 'failed' | 'malformed';

function statusField(resp: unknown): string {
  if (!resp || typeof resp !== 'object' || Array.isArray(resp)) return '';
  const obj = resp as Record<string, unknown>;
  for (const key of ['status', 'state', 'exit_status', 'conclusion']) {
    if (typeof obj[key] === 'string') return obj[key].toLowerCase();
  }
  return '';
}

function classifyReturnStatus(resp: unknown): AgentReturnStatus {
  if (resp === undefined) return 'malformed';
  const explicit = statusField(resp);
  if (/^(failed|failure|error|errored|timeout|timed_out|cancelled|canceled|aborted)$/.test(explicit)) {
    return 'failed';
  }
  if (/^(partial|incomplete|truncated|stalled)$/.test(explicit)) return 'partial';

  const text = resultText(resp);
  if (!text.trim()) return 'malformed';
  if (/"error"\s*:|"exception"\s*:|timed out|timeout|failed|aborted|cancelled|canceled/i.test(text)) return 'failed';
  if (/partial result|partially complete|incomplete|truncated|stalled/i.test(text)) return 'partial';
  return 'ok';
}

function main(): void {
  try {
    const input = readStdin();

    // Only act on genuine Agent-tool returns. The matcher gates this in production, but never assume
    // the payload: require either tool_name==='Agent' OR a subagent_type (the Agent-input signature).
    // Anything else (empty/malformed/other-tool) is a clean no-op — no telemetry noise.
    const isAgentReturn =
      input.tool_name === 'Agent' || typeof input.tool_input?.subagent_type === 'string';
    if (!isAgentReturn) process.exit(0);

    const agentType = input.tool_input?.subagent_type ?? '';
    const description = input.tool_input?.description ?? '';
    const size = resultSize(input.tool_response);
    const project = projectName(input);
    const returnStatus = classifyReturnStatus(input.tool_response);
    const durableMarker = hasDurableCheckpointMarker(input.tool_response);
    const agent_call_id = agentCallId(input.tool_input, input.session_id);

    // Always record the return (the save-gap signal). Cheap, swallows errors.
    emitMemoryTelemetry('agent.return', {
      session_id: input.session_id,
      project,
      agent_call_id,
      agent_type: agentType,
      description,
      result_chars: size,
      return_status: returnStatus,
      durable_marker: durableMarker,
      run_in_background: input.tool_input?.run_in_background === true,
    });

    // Background agents return asynchronously and the parent often isn't at a checkpoint boundary —
    // and trivially-small returns rarely carry durable lessons. Gate the *reminder* (not the telemetry)
    // to substantive, foreground returns to keep the already-busy context chain quiet.
    const needsParentAttention = returnStatus !== 'ok' || size >= 400 || durableMarker;
    const substantive = needsParentAttention && input.tool_input?.run_in_background !== true;
    if (!substantive) process.exit(0);

    emitMemoryTelemetry('agent.checkpoint', {
      session_id: input.session_id,
      project,
      agent_call_id,
      agent_type: agentType,
      return_status: returnStatus,
      durable_marker: durableMarker,
    });

    const label = agentType ? `${agentType} subagent` : 'a subagent';
    const failureClause = returnStatus !== 'ok'
      ? ` It appears to have returned ${returnStatus} output; inspect the result before delegating more work.`
      : '';
    const reminder =
      `<system-reminder>\n` +
      `🧠 ${label} just returned${description ? ` ("${description}")` : ''}. Subagents cannot persist ` +
      `memory themselves — YOU are the only actor that can. If it established anything durable ` +
      `(a cross-project lesson, a project fact, a resolved gotcha, or a ` +
      `"Durable findings for parent checkpoint:" section), checkpoint it now: offer a ` +
      `\`memcarry capture-lesson\` (per the steering rule) or a project-memory note before moving on. ` +
      `If nothing durable was learned, ignore this.${failureClause}\n</system-reminder>`;

    // PostToolUse additionalContext contract (same shape MemoryRecall/LocalContextFirst use).
    console.log(JSON.stringify({ additionalContext: reminder }));
    process.exit(0);
  } catch {
    process.exit(0);
  }
}

if (import.meta.main) { main(); }
