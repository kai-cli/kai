/**
 * hook-io.ts — Shared stdin reader for Stop hooks
 *
 * Eliminates duplicated stdin-reading boilerplate across individual hooks.
 * Each hook calls readHookInput() to get the parsed JSON payload, and
 * parseTranscriptFromInput() if it needs the full transcript.
 *
 * Protocol versioning: Hooks expect hookProtocolVersion 1.0. Future versions
 * may introduce new fields; hooks should log warnings but not fail on
 * unexpected fields (forward compatibility).
 */

import { type ParsedTranscript } from './transcript-parser';
import { getCachedTranscript } from './transcript-cache';
import { validatePayload } from './payload-schema';

export const HOOK_PROTOCOL_VERSION = "1.0";

export interface HookInput {
  session_id: string;
  transcript_path: string;
  hook_event_name: string;
  hookProtocolVersion?: string;
  last_assistant_message?: string;
  prompt?: string;
  user_prompt?: string;
}

/**
 * Read and parse JSON from stdin with a 500ms timeout.
 * Validates the parsed payload against the known hook event schemas.
 * Returns null if stdin is empty, malformed, or missing required fields.
 */
export async function readHookInput(): Promise<HookInput | null> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  try {
    const decoder = new TextDecoder();
    reader = Bun.stdin.stream().getReader();
    let input = '';

    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), 500);
    });

    const readPromise = (async () => {
      while (true) {
        const { done, value } = await reader!.read();
        if (done) break;
        input += decoder.decode(value, { stream: true });
      }
      return 'complete';
    })();

    const result = await Promise.race([readPromise, timeoutPromise]);

    // If timeout won, cancel the reader so process can exit cleanly
    if (result === 'timeout') {
      try {
        await reader.cancel();
      } catch {
        // cancel() may throw if stream is already closed — ignore
      }
    }

    if (!input.trim()) return null;

    const parsed = JSON.parse(input);
    const validation = validatePayload(parsed);

    for (const w of validation.warnings) {
      console.error(`[hook-io] Payload warning: ${w}`);
    }
    if (!validation.valid) {
      console.error(`[hook-io] Invalid payload — missing required fields: ${validation.missing.join(', ')}`);
      return null;
    }

    // Check protocol version
    const obj = parsed as any;
    if (obj.hookProtocolVersion && obj.hookProtocolVersion !== HOOK_PROTOCOL_VERSION) {
      console.error(`[hook-io] Protocol version mismatch: expected ${HOOK_PROTOCOL_VERSION}, got ${obj.hookProtocolVersion}`);
    }

    // Detect unexpected fields (forward compatibility check)
    const knownFields = new Set([
      'session_id', 'transcript_path', 'hook_event_name', 'hookProtocolVersion',
      'last_assistant_message', 'prompt', 'user_prompt', 'cwd', 'stop_hook_active',
      'tool_name', 'tool_input', 'tool_response', 'source', 'file_path',
      'task_id', 'task_subject', 'task_description', 'teammate_name', 'team_name',
      'worktree_path', 'trigger', 'custom_instructions'
    ]);
    const unknownFields = Object.keys(obj).filter(k => !knownFields.has(k));
    if (unknownFields.length > 0) {
      console.error(`[hook-io] Unexpected fields in payload (forward compatibility): ${unknownFields.join(', ')}`);
    }

    // Normalize: ensure both prompt and user_prompt are available
    if (obj.prompt && !obj.user_prompt) {
      obj.user_prompt = obj.prompt;
    } else if (obj.user_prompt && !obj.prompt) {
      obj.prompt = obj.user_prompt;
    }

    return obj as HookInput;
  } catch (error) {
    console.error('[hook-io] Error reading stdin:', error);
  } finally {
    // Ensure reader is released even if an error occurs
    if (reader) {
      try {
        await reader.cancel();
      } catch {
        // Ignore cancel errors — reader may already be closed
      }
    }
  }
  return null;
}

/**
 * Read RAW stdin text (unparsed, unvalidated) with a timeout. Rejects on timeout/error.
 *
 * For hooks that need the raw payload string and do their own JSON.parse — distinct from
 * readHookInput() (which parses + schema-validates + returns null on bad input). Consolidated from 3
 * byte-identical copies (RatingCapture, RelationshipMemory, UpdateTabTitle).
 */
export async function readStdinRaw(timeout: number = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    const timer = setTimeout(() => reject(new Error('Timeout')), timeout);
    process.stdin.on('data', (chunk) => { data += chunk.toString(); });
    process.stdin.on('end', () => { clearTimeout(timer); resolve(data); });
    process.stdin.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

/**
 * Parse transcript from hook input. Waits 150ms for transcript to be
 * fully written to disk before parsing.
 */
export async function parseTranscriptFromInput(input: HookInput): Promise<ParsedTranscript> {
  // Keep the 150ms wait so the transcript is fully written before we parse/cache.
  await new Promise(resolve => setTimeout(resolve, 150));
  // W3: route through the shared disk cache (one parse per session transcript).
  return getCachedTranscript(input.transcript_path);
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook output contracts (Claude Code 2.1.185)
//
// SINGLE SOURCE for the correct PreToolUse / UserPromptSubmit decision shapes.
// Hooks MUST build escalation output through these helpers, never by hand —
// that is what keeps PAI-SR-005 / PAI-SR-030 from regressing (a contract test
// asserts no PreToolUse hook emits the legacy top-level `{decision:"ask"}`).
//
// Verified against the installed 2.1.185 binary schema:
//   PreToolUse: { hookSpecificOutput: { hookEventName: "PreToolUse",
//                 permissionDecision: "allow"|"deny"|"ask"|"defer",
//                 permissionDecisionReason: string } }
//   Top-level `decision` is honored ONLY for "block".
//   UserPromptSubmit has NO ask outcome — escalation must be
//   { decision: "block", reason, suppressOriginalPrompt?: true }.
// ─────────────────────────────────────────────────────────────────────────────

export interface PreToolUseDecision {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse';
    permissionDecision: 'allow' | 'deny' | 'ask' | 'defer';
    permissionDecisionReason: string;
  };
}

/**
 * Build a PreToolUse "ask" (user-confirmation) decision in the current 2.1.185 shape.
 * Replaces the legacy top-level `{decision:"ask", message}` that 2.1.185 silently ignores.
 */
export function askPreToolUse(reason: string): PreToolUseDecision {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: reason,
    },
  };
}

export interface UserPromptBlock {
  decision: 'block';
  reason: string;
  suppressOriginalPrompt: true;
}

/**
 * Build a UserPromptSubmit "block" decision (the event has no "ask" outcome).
 * `suppressOriginalPrompt:true` omits the original prompt from the transcript —
 * used by SecretScanner so a detected secret is not persisted. The caller must
 * never put the secret value into `reason`.
 */
export function blockUserPrompt(reason: string): UserPromptBlock {
  return { decision: 'block', reason, suppressOriginalPrompt: true };
}
