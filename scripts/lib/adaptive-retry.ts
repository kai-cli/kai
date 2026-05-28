/**
 * Adaptive Retry — Priority-based retry decisions
 *
 * Parses QA verdict severity and decides whether to retry:
 * - "Critical Blocker" → always retry
 * - "Standard Issue" → retry once, then escalate
 * - "Minor Concern" → skip retry, defer to report
 */

export type VerdictSeverity = 'critical' | 'standard' | 'minor' | 'unknown';

export interface RetryDecision {
  shouldRetry: boolean;
  reason: string;
  severity: VerdictSeverity;
  deferred: boolean;
}

export interface RetryConfig {
  strict: boolean;        // --strict: retry everything regardless
  maxRetries: number;     // default 2
  currentAttempt: number; // 0-indexed
}

export function parseSeverity(qaOutput: string): VerdictSeverity {
  const lower = qaOutput.toLowerCase();
  if (lower.includes('critical blocker')) return 'critical';
  if (lower.includes('standard issue')) return 'standard';
  if (lower.includes('minor concern')) return 'minor';
  return 'unknown';
}

export function shouldRetry(qaOutput: string, config: RetryConfig): RetryDecision {
  if (config.strict) {
    return {
      shouldRetry: config.currentAttempt < config.maxRetries,
      reason: '--strict: retrying regardless of severity',
      severity: parseSeverity(qaOutput),
      deferred: false,
    };
  }

  const severity = parseSeverity(qaOutput);

  switch (severity) {
    case 'critical':
      return {
        shouldRetry: config.currentAttempt < config.maxRetries,
        reason: 'Critical Blocker: must retry',
        severity,
        deferred: false,
      };

    case 'standard':
      return {
        shouldRetry: config.currentAttempt < 1,
        reason: config.currentAttempt < 1
          ? 'Standard Issue: retrying once'
          : 'Standard Issue: escalating after one retry',
        severity,
        deferred: false,
      };

    case 'minor':
      return {
        shouldRetry: false,
        reason: 'Minor Concern: deferring to report',
        severity,
        deferred: true,
      };

    default:
      return {
        shouldRetry: config.currentAttempt < config.maxRetries,
        reason: 'Unknown severity: retrying as precaution',
        severity,
        deferred: false,
      };
  }
}
