/**
 * claude-code.ts — Claude Code embedded harness
 *
 * Wraps the existing Claude Code Agent tool behavior.
 * This is the default harness — always available since we're running inside
 * Claude Code. Routes to this harness when no routing signals are present.
 *
 * The actual Agent tool is invoked by Claude during session execution;
 * this harness provides the interface contract and availability metadata.
 */

import type { Harness, HarnessCapabilities, HarnessResponse, ExecuteOptions, Message } from './harness';

export class ClaudeCodeHarness implements Harness {
  readonly name = 'claude-code';

  async isAvailable(): Promise<boolean> {
    // Always available — we're running inside Claude Code
    return true;
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
    // The Claude Code harness delegates to the Agent tool, which is invoked
    // by Claude directly in session context. This method is a placeholder for
    // programmatic callers that need to dispatch through the harness interface.
    // In practice, callers inside Claude sessions use the Agent tool directly.
    throw new Error(
      '[ClaudeCodeHarness] Programmatic execution not supported. ' +
      'Use the Agent tool directly when inside a Claude Code session.'
    );
  }

  // eslint-disable-next-line require-yield
  async *chat(_messages: Message[]): AsyncGenerator<string> {
    throw new Error('[ClaudeCodeHarness] Chat not supported. Use Agent tool directly.');
  }
}
