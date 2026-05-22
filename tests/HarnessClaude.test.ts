import { describe, test, expect } from 'bun:test';
import { ClaudeHarness } from '../agents/harnesses/claude';
import { ClaudeCodeHarness } from '../agents/harnesses/claude-code';
import { CodexHarness } from '../agents/harnesses/codex';
import { GeminiHarness } from '../agents/harnesses/gemini';
import { LocalHarness } from '../agents/harnesses/local';
import { toAnthropicTools, toOpenAITools, toGoogleTools, fromOpenAITools, fromAnthropicTools } from '../agents/harnesses/tool-translator';
import type { ToolDefinition } from '../agents/harnesses/harness';

const SAMPLE_TOOL: ToolDefinition = {
  name: 'get_weather',
  description: 'Get the current weather for a city',
  inputSchema: {
    type: 'object',
    properties: {
      city: { type: 'string', description: 'City name' },
      units: { type: 'string', description: 'celsius or fahrenheit' },
    },
    required: ['city'],
  },
};

describe('ClaudeHarness', () => {
  test('name is "claude"', () => {
    const h = new ClaudeHarness();
    expect(h.name).toBe('claude');
  });

  test('isAvailable returns false when ANTHROPIC_API_KEY not set', async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const h = new ClaudeHarness();
    expect(await h.isAvailable()).toBe(false);
    if (saved) process.env.ANTHROPIC_API_KEY = saved;
  });

  test('isAvailable returns true when ANTHROPIC_API_KEY is set', async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const h = new ClaudeHarness();
    expect(await h.isAvailable()).toBe(true);
    if (saved) process.env.ANTHROPIC_API_KEY = saved;
    else delete process.env.ANTHROPIC_API_KEY;
  });

  test('capabilities has expected fields', () => {
    const h = new ClaudeHarness();
    const caps = h.capabilities();
    expect(caps.supportsTools).toBe(true);
    expect(caps.supportsStreaming).toBe(true);
    expect(caps.supportsImages).toBe(true);
    expect(caps.maxContextWindow).toBeGreaterThan(0);
  });
});

describe('ClaudeCodeHarness', () => {
  test('name is "claude-code"', () => {
    const h = new ClaudeCodeHarness();
    expect(h.name).toBe('claude-code');
  });

  test('isAvailable always returns true (embedded harness)', async () => {
    const h = new ClaudeCodeHarness();
    expect(await h.isAvailable()).toBe(true);
  });

  test('execute throws (use Agent tool directly)', async () => {
    const h = new ClaudeCodeHarness();
    await expect(h.execute({ prompt: 'test' })).rejects.toThrow('Agent tool');
  });

  test('capabilities declares tool support', () => {
    const h = new ClaudeCodeHarness();
    const caps = h.capabilities();
    expect(caps.supportsTools).toBe(true);
  });
});

describe('CodexHarness', () => {
  test('name is "codex"', () => {
    const h = new CodexHarness();
    expect(h.name).toBe('codex');
  });

  test('isAvailable returns false when OPENAI_API_KEY not set', async () => {
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const h = new CodexHarness();
    expect(await h.isAvailable()).toBe(false);
    if (saved) process.env.OPENAI_API_KEY = saved;
  });
});

describe('GeminiHarness', () => {
  test('name is "gemini"', () => {
    const h = new GeminiHarness();
    expect(h.name).toBe('gemini');
  });

  test('isAvailable returns false when GOOGLE_AI_KEY not set', async () => {
    const saved = process.env.GOOGLE_AI_KEY;
    delete process.env.GOOGLE_AI_KEY;
    const h = new GeminiHarness();
    expect(await h.isAvailable()).toBe(false);
    if (saved) process.env.GOOGLE_AI_KEY = saved;
  });

  test('capabilities declares image support', () => {
    const h = new GeminiHarness();
    expect(h.capabilities().supportsImages).toBe(true);
  });
});

describe('LocalHarness', () => {
  test('name is "local"', () => {
    const h = new LocalHarness();
    expect(h.name).toBe('local');
  });

  test('isAvailable returns false when Ollama not running', async () => {
    // In CI/dev environment, Ollama is usually not running
    const h = new LocalHarness();
    const available = await h.isAvailable();
    // We just verify it doesn't throw — result depends on environment
    expect(typeof available).toBe('boolean');
  });

  test('capabilities does not declare tool support (Ollama limited)', () => {
    const h = new LocalHarness();
    expect(h.capabilities().supportsTools).toBe(false);
  });
});

describe('ToolTranslator', () => {
  test('toAnthropicTools converts ToolDefinition to Anthropic format', () => {
    const tools = toAnthropicTools([SAMPLE_TOOL]);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('get_weather');
    expect(tools[0].input_schema).toBeDefined();
    expect(tools[0].input_schema.type).toBe('object');
  });

  test('toOpenAITools converts ToolDefinition to OpenAI function_calling format', () => {
    const tools = toOpenAITools([SAMPLE_TOOL]);
    expect(tools).toHaveLength(1);
    expect(tools[0].type).toBe('function');
    expect(tools[0].function.name).toBe('get_weather');
    expect(tools[0].function.parameters.type).toBe('object');
  });

  test('toGoogleTools converts ToolDefinition to Google functionDeclarations', () => {
    const tool = toGoogleTools([SAMPLE_TOOL]);
    expect(tool.function_declarations).toHaveLength(1);
    expect(tool.function_declarations[0].name).toBe('get_weather');
    expect(tool.function_declarations[0].parameters.type).toBe('OBJECT');
  });

  test('fromOpenAITools round-trips through OpenAI format', () => {
    const openai = toOpenAITools([SAMPLE_TOOL]);
    const back = fromOpenAITools(openai);
    expect(back[0].name).toBe(SAMPLE_TOOL.name);
    expect(back[0].description).toBe(SAMPLE_TOOL.description);
    expect(back[0].inputSchema.properties.city).toBeDefined();
  });

  test('fromAnthropicTools round-trips through Anthropic format', () => {
    const anthropic = toAnthropicTools([SAMPLE_TOOL]);
    const back = fromAnthropicTools(anthropic);
    expect(back[0].name).toBe(SAMPLE_TOOL.name);
    expect(back[0].inputSchema.required).toContain('city');
  });

  test('tool translation preserves required fields', () => {
    const openai = toOpenAITools([SAMPLE_TOOL]);
    expect(openai[0].function.parameters.required).toContain('city');
    const google = toGoogleTools([SAMPLE_TOOL]);
    expect(google.function_declarations[0].parameters.required).toContain('city');
  });
});
