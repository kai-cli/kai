/**
 * harness.ts — Harness interface and shared types for multi-provider AI dispatch
 *
 * A Harness wraps an AI provider (Claude, Codex, Gemini, Ollama) behind a
 * unified interface. The caller works with prompts and HarnessResponses;
 * each concrete harness handles provider-specific formats internally.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface HarnessCapabilities {
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsImages: boolean;
  maxContextWindow: number;
}

export interface ExecuteOptions {
  prompt: string;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
}

export interface HarnessResponse {
  content: string;
  model?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  toolCalls?: Array<{
    name: string;
    input: Record<string, unknown>;
  }>;
}

export interface Harness {
  readonly name: string;

  /** Returns true if this harness is usable (API key set, binary available, etc.) */
  isAvailable(): Promise<boolean>;

  /** Execute a single prompt and return the full response. */
  execute(opts: ExecuteOptions): Promise<HarnessResponse>;

  /** Stream a multi-turn conversation, yielding text chunks. */
  chat(messages: Message[]): AsyncGenerator<string>;

  /** Static capabilities declaration for routing decisions. */
  capabilities(): HarnessCapabilities;
}

// ─── Routing types ───────────────────────────────────────────────────────────

export type PrivacyLevel = 'public' | 'internal' | 'sensitive';
export type TaskType = 'code-gen' | 'reasoning' | 'research' | 'multimodal' | 'general';
export type BudgetLevel = 'low' | 'medium' | 'high';

export interface RoutingSignals {
  hasImages?: boolean;
  privacyLevel?: PrivacyLevel;
  taskType?: TaskType;
  preferredHarness?: string;
  maxBudget?: BudgetLevel;
}

export interface OrchestrationConfig {
  harness: string;
  executionMode: 'local' | 'remote';
  model?: string;
  fallback?: string;
}
