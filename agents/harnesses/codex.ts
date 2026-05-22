/**
 * codex.ts — OpenAI API harness
 *
 * Dispatches to OpenAI's API (GPT-4o or compatible models).
 * Handles tool format translation from unified ToolDefinition → OpenAI function_calling.
 *
 * Requires: OPENAI_API_KEY environment variable.
 */

import type { Harness, HarnessCapabilities, HarnessResponse, ExecuteOptions, Message } from './harness';
import { toOpenAITools } from './tool-translator';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o';

export class CodexHarness implements Harness {
  readonly name = 'codex';

  async isAvailable(): Promise<boolean> {
    return !!process.env.OPENAI_API_KEY;
  }

  capabilities(): HarnessCapabilities {
    return {
      supportsTools: true,
      supportsStreaming: true,
      supportsImages: true,
      maxContextWindow: 128_000,
    };
  }

  async execute(opts: ExecuteOptions): Promise<HarnessResponse> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('[CodexHarness] OPENAI_API_KEY not set');

    const messages: Array<{ role: string; content: string }> = [];
    if (opts.systemPrompt) {
      messages.push({ role: 'system', content: opts.systemPrompt });
    }
    messages.push({ role: 'user', content: opts.prompt });

    const body: Record<string, unknown> = {
      model: DEFAULT_MODEL,
      max_tokens: opts.maxTokens ?? 4096,
      messages,
    };

    if (opts.tools?.length) {
      body['tools'] = toOpenAITools(opts.tools);
      body['tool_choice'] = 'auto';
    }

    const res = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`[CodexHarness] API error ${res.status}: ${text}`);
    }

    const data = await res.json() as any;
    const choice = data.choices?.[0];
    const msg = choice?.message ?? {};
    const toolCalls = (msg.tool_calls ?? []).map((tc: any) => ({
      name: tc.function.name,
      input: JSON.parse(tc.function.arguments ?? '{}'),
    }));

    return {
      content: msg.content ?? '',
      model: data.model,
      usage: data.usage ? {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
      } : undefined,
      toolCalls,
    };
  }

  async *chat(messages: Message[]): AsyncGenerator<string> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('[CodexHarness] OPENAI_API_KEY not set');

    const res = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: 4096,
        stream: true,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      }),
    });

    if (!res.ok || !res.body) {
      throw new Error(`[CodexHarness] Stream error ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6);
        if (payload === '[DONE]') return;
        try {
          const event = JSON.parse(payload);
          const delta = event.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // Skip malformed SSE lines
        }
      }
    }
  }
}
