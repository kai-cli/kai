export interface PhaseCondition {
  phase: string;
  condition: string;
  skipReason: string;
}

export interface PhaseContext {
  output: Record<string, string>;
  metrics: {
    implementLines?: number;
    qaVerdictSeverity?: string;
    totalCostUsd?: number;
  };
}

/**
 * Evaluate a condition expression against the current phase context.
 * Returns true if the condition is satisfied (phase should run).
 * Returns false if the condition is not satisfied (phase should skip).
 *
 * Supported patterns:
 * - output.X.length > N
 * - output.X.length < N
 * - output.X.length >= N
 * - output.X.length <= N
 * - metrics.X == Y
 * - metrics.X != Y
 * - metrics.X > N
 * - metrics.X < N
 * - metrics.X >= N
 * - metrics.X <= N
 *
 * Fails open: invalid conditions return true (run the phase).
 */
export function evaluateCondition(condition: string, context: PhaseContext): boolean {
  try {
    const trimmed = condition.trim();

    // Pattern: output.X.length <op> N
    const outputLengthMatch = trimmed.match(/^output\.(\w+)\.length\s*(>=?|<=?|==|!=)\s*(\d+)$/);
    if (outputLengthMatch) {
      const [, phaseName, op, valueStr] = outputLengthMatch;
      const phaseOutput = context.output[phaseName];
      if (phaseOutput === undefined) {
        // Phase hasn't run yet — fail open (run the phase)
        return true;
      }
      const actualLength = phaseOutput.length;
      const expectedValue = parseInt(valueStr, 10);
      return compareValues(actualLength, op, expectedValue);
    }

    // Pattern: metrics.X <op> N (numeric)
    const metricsNumericMatch = trimmed.match(/^metrics\.(\w+)\s*(>=?|<=?|==|!=)\s*(\d+(?:\.\d+)?)$/);
    if (metricsNumericMatch) {
      const [, metricName, op, valueStr] = metricsNumericMatch;
      const metricValue = (context.metrics as any)[metricName];
      if (metricValue === undefined) {
        // Metric not available — fail open
        return true;
      }
      const expectedValue = parseFloat(valueStr);
      return compareValues(metricValue, op, expectedValue);
    }

    // Pattern: metrics.X == "Y" (string)
    const metricsStringMatch = trimmed.match(/^metrics\.(\w+)\s*(==|!=)\s*"([^"]+)"$/);
    if (metricsStringMatch) {
      const [, metricName, op, expectedValue] = metricsStringMatch;
      const metricValue = (context.metrics as any)[metricName];
      if (metricValue === undefined) {
        return true;
      }
      if (op === '==') {
        return metricValue === expectedValue;
      } else {
        return metricValue !== expectedValue;
      }
    }

    // Unknown pattern — fail open (run the phase)
    return true;
  } catch {
    // Parse error — fail open
    return true;
  }
}

/**
 * Compare two numeric values with the given operator
 */
function compareValues(actual: number, op: string, expected: number): boolean {
  switch (op) {
    case '>': return actual > expected;
    case '<': return actual < expected;
    case '>=': return actual >= expected;
    case '<=': return actual <= expected;
    case '==': return actual === expected;
    case '!=': return actual !== expected;
    default: return true; // Unknown operator — fail open
  }
}

/**
 * Built-in conditions for standard presets
 */
export const BUILTIN_CONDITIONS: PhaseCondition[] = [
  {
    phase: 'verify',
    condition: 'output.implement.length >= 500',
    skipReason: 'Implementation too small to warrant verification (< 500 chars)',
  },
  {
    phase: 'review',
    condition: 'metrics.totalCostUsd >= 0.50',
    skipReason: 'Total cost too low to warrant review (< $0.50)',
  },
];

/**
 * Get the condition for a given phase (if any)
 * Custom conditions override builtins
 */
export function getPhaseCondition(phase: string, customConditions?: PhaseCondition[]): PhaseCondition | null {
  // Custom conditions first to allow overrides
  const conditions = [...(customConditions || []), ...BUILTIN_CONDITIONS];
  return conditions.find(c => c.phase === phase) || null;
}
