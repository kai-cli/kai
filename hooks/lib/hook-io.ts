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

import { parseTranscript, type ParsedTranscript } from '../../PAI/Tools/TranscriptParser';
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
      'tool_name', 'tool_input', 'tool_response', 'config_path', 'change_type'
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
 * Parse transcript from hook input. Waits 150ms for transcript to be
 * fully written to disk before parsing.
 */
export async function parseTranscriptFromInput(input: HookInput): Promise<ParsedTranscript> {
  await new Promise(resolve => setTimeout(resolve, 150));
  return parseTranscript(input.transcript_path);
}
