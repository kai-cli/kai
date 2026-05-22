/**
 * claude.ts — Anthropic API harness
 *
 * Calls the Anthropic API directly (not via Claude Code's embedded Agent tool).
 * Use this when you need a second Claude instance for sub-agent work outside
 * the current session context.
 *
 * Requires: ANTHROPIC_API_KEY environment variable.
 */

import type { Harness, HarnessCapabilities, HarnessResponse, ExecuteOptions, Message } from './harness';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'us.anthropic.claude-sonnet-4-6';
const ANTHROPIC_VERSION = '2023-06-01';

export class ClaudeHarness implements Harness {
  readonly name = 'claude';

  async isAvailable(): Promise<boolean> {
    return !!process.env.ANTHROPIC_API_KEY;
  }

  capabilities(): HarnessCapabilities {
    return {
      supportsTools: true,
      supportsStreaming: true,
      supportsImages: true,
      maxContextWindow: 200_000,
    };
  }

  async execute(opts: ExecuteOptions): Promise<HarnessResponse> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('[ClaudeHarness] ANTHROPIC_API_KEY not set');

    const messages: Array<{ role: string; content: string }> = [
      { role: 'user', content: opts.prompt },
    ];

    const body: Record<string, unknown> = {
      model: DEFAULT_MODEL,
      max_tokens: opts.maxTokens ?? 4096,
      messages,
    };

    if (opts.systemPrompt) {
      body['system'] = opts.systemPrompt;
    }

    if (opts.tools?.length) {
      body['tools'] = opts.tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
    }

    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`[ClaudeHarness] API error ${res.status}: ${text}`);
    }

    const data = await res.json() as any;
    const textContent = data.content?.find((b: any) => b.type === 'text');
    const toolUseBlocks = data.content?.filter((b: any) => b.type === 'tool_use') ?? [];

    return {
      content: textContent?.text ?? '',
      model: data.model,
      usage: data.usage ? {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
      } : undefined,
      toolCalls: toolUseBlocks.map((b: any) => ({
        name: b.name,
        input: b.input,
      })),
    };
  }

  async *chat(messages: Message[]): AsyncGenerator<string> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('[ClaudeHarness] ANTHROPIC_API_KEY not set');

    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: 4096,
        messages: messages.map(m => ({ role: m.role === 'system' ? 'user' : m.role, content: m.content })),
        stream: true,
      }),
    });

    if (!res.ok || !res.body) {
      throw new Error(`[ClaudeHarness] Stream error ${res.status}`);
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
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            yield event.delta.text;
          }
        } catch {
          // Skip malformed SSE lines
        }
      }
    }
  }
}
