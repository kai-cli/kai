/**
 * gemini.ts — Google Gemini API harness
 *
 * Dispatches to Google's Generative AI API (Gemini 2.0 Flash or compatible).
 * Primary use: multimodal tasks, large context windows.
 * Handles tool format translation to Google functionDeclarations format.
 *
 * Requires: GOOGLE_AI_KEY environment variable.
 */

import type { Harness, HarnessCapabilities, HarnessResponse, ExecuteOptions, Message } from './harness';
import { toGoogleTools } from './tool-translator';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-2.0-flash';

export class GeminiHarness implements Harness {
  readonly name = 'gemini';

  async isAvailable(): Promise<boolean> {
    return !!process.env.GOOGLE_AI_KEY;
  }

  capabilities(): HarnessCapabilities {
    return {
      supportsTools: true,
      supportsStreaming: true,
      supportsImages: true,
      maxContextWindow: 1_000_000,
    };
  }

  async execute(opts: ExecuteOptions): Promise<HarnessResponse> {
    const apiKey = process.env.GOOGLE_AI_KEY;
    if (!apiKey) throw new Error('[GeminiHarness] GOOGLE_AI_KEY not set');

    const url = `${GEMINI_API_BASE}/${DEFAULT_MODEL}:generateContent?key=${apiKey}`;

    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
    if (opts.systemPrompt) {
      contents.push({ role: 'user', parts: [{ text: opts.systemPrompt }] });
      contents.push({ role: 'model', parts: [{ text: 'Understood.' }] });
    }
    contents.push({ role: 'user', parts: [{ text: opts.prompt }] });

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: opts.maxTokens ?? 4096,
        temperature: opts.temperature,
      },
    };

    if (opts.tools?.length) {
      body['tools'] = [toGoogleTools(opts.tools)];
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`[GeminiHarness] API error ${res.status}: ${text}`);
    }

    const data = await res.json() as any;
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const textPart = parts.find((p: any) => 'text' in p);
    const funcParts = parts.filter((p: any) => 'functionCall' in p);

    return {
      content: textPart?.text ?? '',
      model: DEFAULT_MODEL,
      usage: data.usageMetadata ? {
        inputTokens: data.usageMetadata.promptTokenCount,
        outputTokens: data.usageMetadata.candidatesTokenCount,
      } : undefined,
      toolCalls: funcParts.map((p: any) => ({
        name: p.functionCall.name,
        input: p.functionCall.args ?? {},
      })),
    };
  }

  async *chat(messages: Message[]): AsyncGenerator<string> {
    const apiKey = process.env.GOOGLE_AI_KEY;
    if (!apiKey) throw new Error('[GeminiHarness] GOOGLE_AI_KEY not set');

    const url = `${GEMINI_API_BASE}/${DEFAULT_MODEL}:streamGenerateContent?key=${apiKey}&alt=sse`;

    const contents = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents }),
    });

    if (!res.ok || !res.body) {
      throw new Error(`[GeminiHarness] Stream error ${res.status}`);
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
        try {
          const event = JSON.parse(line.slice(6));
          const text = event.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) yield text;
        } catch {
          // Skip malformed SSE lines
        }
      }
    }
  }
}
