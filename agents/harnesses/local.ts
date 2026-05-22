/**
 * local.ts — Ollama local model harness
 *
 * Dispatches to a locally-running Ollama instance (http://localhost:11434).
 * Primary use: privacy-sensitive tasks that should not leave the machine.
 *
 * Availability check: HTTP GET to Ollama API tags endpoint.
 * No API key required — Ollama runs locally.
 */

import type { Harness, HarnessCapabilities, HarnessResponse, ExecuteOptions, Message } from './harness';

const OLLAMA_BASE = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3.2';

export class LocalHarness implements Harness {
  readonly name = 'local';

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  capabilities(): HarnessCapabilities {
    return {
      supportsTools: false,
      supportsStreaming: true,
      supportsImages: false,
      maxContextWindow: 128_000,
    };
  }

  async execute(opts: ExecuteOptions): Promise<HarnessResponse> {
    const messages: Array<{ role: string; content: string }> = [];
    if (opts.systemPrompt) {
      messages.push({ role: 'system', content: opts.systemPrompt });
    }
    messages.push({ role: 'user', content: opts.prompt });

    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages,
        stream: false,
        options: {
          num_predict: opts.maxTokens ?? 4096,
          temperature: opts.temperature,
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`[LocalHarness] Ollama error ${res.status}: ${text}`);
    }

    const data = await res.json() as any;
    return {
      content: data.message?.content ?? '',
      model: data.model,
    };
  }

  async *chat(messages: Message[]): AsyncGenerator<string> {
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        stream: true,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      }),
    });

    if (!res.ok || !res.body) {
      throw new Error(`[LocalHarness] Ollama stream error ${res.status}`);
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
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          const text = event.message?.content;
          if (text) yield text;
          if (event.done) return;
        } catch {
          // Skip malformed lines
        }
      }
    }
  }
}
