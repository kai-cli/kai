/**
 * Cost Tracker — Per-Phase Token Cost Tracking
 *
 * Parses token usage from agent output, calculates cost using model pricing,
 * logs cost events, and enforces soft/hard budget limits.
 */

export interface CostEvent {
  phase: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  timestamp: string;
}

export interface BudgetConfig {
  softLimitUsd: number;  // default 2.00
  hardLimitUsd: number;  // default 5.00
}

interface CostSummaryRow {
  phase: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

// Model pricing per MTok (1M tokens)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  opus: { input: 15, output: 75 },
  sonnet: { input: 3, output: 15 },
  haiku: { input: 0.25, output: 1.25 },
};

/**
 * Parse token usage from Claude CLI output.
 * Expected patterns:
 * - "Input tokens: 1234"
 * - "Output tokens: 5678"
 * - "Usage: 1234 input, 5678 output"
 */
function parseTokenUsage(output: string): { inputTokens: number; outputTokens: number } | null {
  const patterns = [
    /Input tokens:\s*(\d+)/i,
    /Output tokens:\s*(\d+)/i,
    /Usage:\s*(\d+)\s*input,?\s*(\d+)\s*output/i,
    /(\d+)\s*input.*?(\d+)\s*output/i,
  ];

  let inputTokens = 0;
  let outputTokens = 0;

  // Try pattern 3: "Usage: X input, Y output"
  const usageMatch = output.match(/Usage:\s*(\d+)\s*input,?\s*(\d+)\s*output/i);
  if (usageMatch) {
    inputTokens = parseInt(usageMatch[1], 10);
    outputTokens = parseInt(usageMatch[2], 10);
    return { inputTokens, outputTokens };
  }

  // Try individual patterns
  const inputMatch = output.match(/Input tokens:\s*(\d+)/i);
  const outputMatch = output.match(/Output tokens:\s*(\d+)/i);

  if (inputMatch) inputTokens = parseInt(inputMatch[1], 10);
  if (outputMatch) outputTokens = parseInt(outputMatch[1], 10);

  if (inputTokens > 0 || outputTokens > 0) {
    return { inputTokens, outputTokens };
  }

  return null;
}

/**
 * Calculate cost in USD for given token usage and model.
 */
function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  // Normalize model name to base (opus/sonnet/haiku)
  const modelBase = model.toLowerCase().includes("opus")
    ? "opus"
    : model.toLowerCase().includes("sonnet")
    ? "sonnet"
    : model.toLowerCase().includes("haiku")
    ? "haiku"
    : "sonnet"; // default to sonnet if unknown

  const pricing = MODEL_PRICING[modelBase] || MODEL_PRICING.sonnet;

  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;

  return inputCost + outputCost;
}

export class CostTracker {
  private events: CostEvent[] = [];
  private config: BudgetConfig;

  constructor(config?: Partial<BudgetConfig>) {
    this.config = {
      softLimitUsd: config?.softLimitUsd ?? 2.0,
      hardLimitUsd: config?.hardLimitUsd ?? 5.0,
    };
  }

  /**
   * Record a phase execution and calculate cost.
   */
  recordPhase(phase: string, model: string, inputTokens: number, outputTokens: number): CostEvent {
    const costUsd = calculateCost(model, inputTokens, outputTokens);
    const event: CostEvent = {
      phase,
      model,
      inputTokens,
      outputTokens,
      costUsd,
      timestamp: new Date().toISOString(),
    };
    this.events.push(event);
    return event;
  }

  /**
   * Parse agent output and record cost.
   * Returns the cost event if tokens were found, otherwise null.
   */
  recordFromOutput(phase: string, model: string, output: string): CostEvent | null {
    const usage = parseTokenUsage(output);
    if (!usage) return null;
    return this.recordPhase(phase, model, usage.inputTokens, usage.outputTokens);
  }

  /**
   * Get total cost across all recorded phases.
   */
  getTotalCost(): number {
    return this.events.reduce((sum, e) => sum + e.costUsd, 0);
  }

  /**
   * Check if over soft limit (warning threshold).
   */
  isOverSoftLimit(): boolean {
    return this.getTotalCost() > this.config.softLimitUsd;
  }

  /**
   * Check if over hard limit (abort threshold).
   */
  isOverHardLimit(): boolean {
    return this.getTotalCost() > this.config.hardLimitUsd;
  }

  /**
   * Get summary of cost by phase.
   */
  getSummary(): CostSummaryRow[] {
    return this.events.map((e) => ({
      phase: e.phase,
      model: e.model,
      inputTokens: e.inputTokens,
      outputTokens: e.outputTokens,
      costUsd: e.costUsd,
    }));
  }

  /**
   * Format cost summary as a table.
   */
  formatTable(): string {
    if (this.events.length === 0) {
      return "No cost data recorded.";
    }

    const rows = this.getSummary();
    const total = this.getTotalCost();

    const lines: string[] = [];
    lines.push("## Cost Breakdown");
    lines.push("");
    lines.push("| Phase      | Model   | Input Tokens | Output Tokens | Cost (USD) |");
    lines.push("|------------|---------|--------------|---------------|------------|");

    for (const row of rows) {
      const phase = row.phase.padEnd(10);
      const model = row.model.padEnd(7);
      const input = row.inputTokens.toLocaleString().padStart(12);
      const output = row.outputTokens.toLocaleString().padStart(13);
      const cost = `$${row.costUsd.toFixed(4)}`.padStart(10);
      lines.push(`| ${phase} | ${model} | ${input} | ${output} | ${cost} |`);
    }

    lines.push("");
    lines.push(`**Total Cost:** $${total.toFixed(4)}`);

    if (this.isOverHardLimit()) {
      lines.push(`**⚠️  HARD LIMIT EXCEEDED** (limit: $${this.config.hardLimitUsd.toFixed(2)})`);
    } else if (this.isOverSoftLimit()) {
      lines.push(`**⚠️  Soft limit exceeded** (limit: $${this.config.softLimitUsd.toFixed(2)})`);
    }

    return lines.join("\n");
  }

  /**
   * Get all cost events (for logging to run.jsonl).
   */
  getEvents(): CostEvent[] {
    return [...this.events];
  }
}
