/**
 * hook-io.ts — Shared stdin reader for Stop hooks
 *
 * Eliminates duplicated stdin-reading boilerplate across individual hooks.
 * Each hook calls readHookInput() to get the parsed JSON payload, and
 * parseTranscriptFromInput() if it needs the full transcript.
 */

import { parseTranscript, type ParsedTranscript } from '../../PAI/Tools/TranscriptParser';
import { validatePayload } from './payload-schema';

export interface HookInput {
  session_id: string;
  transcript_path: string;
  hook_event_name: string;
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

    // Normalize: ensure both prompt and user_prompt are available
    const obj = parsed as any;
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
