/**
 * tool-translator.ts — Unified tool definition ↔ provider-specific format translation
 *
 * Each provider has a different tool/function calling format:
 *   - Anthropic: { name, description, input_schema }
 *   - OpenAI:    { type: "function", function: { name, description, parameters } }
 *   - Google:    { name, description, parameters }  (functionDeclarations)
 *
 * Callers work with ToolDefinition; each harness calls toProvider() before sending.
 */

import type { ToolDefinition } from './harness';

// ─── Anthropic ────────────────────────────────────────────────────────────────

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

export function toAnthropicTools(tools: ToolDefinition[]): AnthropicTool[] {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
}

export function fromAnthropicTools(tools: AnthropicTool[]): ToolDefinition[] {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.input_schema,
  }));
}

// ─── OpenAI ──────────────────────────────────────────────────────────────────

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description?: string }>;
      required?: string[];
    };
  };
}

export function toOpenAITools(tools: ToolDefinition[]): OpenAITool[] {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

export function fromOpenAITools(tools: OpenAITool[]): ToolDefinition[] {
  return tools.map(t => ({
    name: t.function.name,
    description: t.function.description,
    inputSchema: t.function.parameters,
  }));
}

// ─── Google (Gemini) ──────────────────────────────────────────────────────────

export interface GoogleFunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: 'OBJECT';
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

export interface GoogleTool {
  function_declarations: GoogleFunctionDeclaration[];
}

export function toGoogleTools(tools: ToolDefinition[]): GoogleTool {
  return {
    function_declarations: tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: {
        type: 'OBJECT' as const,
        properties: t.inputSchema.properties,
        required: t.inputSchema.required,
      },
    })),
  };
}

export function fromGoogleTools(decls: GoogleFunctionDeclaration[]): ToolDefinition[] {
  return decls.map(d => ({
    name: d.name,
    description: d.description,
    inputSchema: {
      type: 'object' as const,
      properties: d.parameters.properties,
      required: d.parameters.required,
    },
  }));
}
