/**
 * algorithm/observer.ts - Planning Observer for adaptive replanning
 *
 * Evaluates divergence between expected and actual outcomes after each phase.
 * Triggers replanning when divergence exceeds threshold.
 */

export interface PhaseOutcome {
  phase: string;           // 'observe' | 'orient' | 'decide' | 'act' | 'verify'
  expectedOutcome: string; // What we expected from this phase
  actualOutcome: string;   // What actually happened
  timestamp: string;
}

export interface DivergenceResult {
  score: number;           // 0.0 (perfectly aligned) to 1.0 (completely divergent)
  factors: DivergenceFactor[];
  shouldReplan: boolean;
  reason?: string;
}

export interface DivergenceFactor {
  name: string;
  weight: number;
  score: number;
  detail: string;
}

export interface ReplanDecision {
  trigger: string;         // Which phase triggered replan
  divergenceScore: number;
  originalPlan: string[];  // Remaining planned phases
  revisedPlan: string[];   // New phases after replan
  reason: string;
}

export interface ObserverConfig {
  divergenceThreshold: number;  // default 0.3
  enableReplanning: boolean;    // default true
  maxReplans: number;           // default 2 (prevent infinite replanning)
}

const DEFAULT_CONFIG: ObserverConfig = {
  divergenceThreshold: 0.3,
  enableReplanning: true,
  maxReplans: 2,
};

export class PlanningObserver {
  private config: ObserverConfig;
  private expectations: Map<string, string>;
  private outcomes: PhaseOutcome[];
  private replanCount: number;
  private lastReplanDecision: ReplanDecision | null;

  constructor(config?: Partial<ObserverConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.expectations = new Map();
    this.outcomes = [];
    this.replanCount = 0;
    this.lastReplanDecision = null;
  }

  /**
   * Record what we expected from a phase
   */
  setExpectation(phase: string, expected: string): void {
    this.expectations.set(phase, expected);
  }

  /**
   * After phase completes, evaluate divergence
   */
  evaluatePhase(phase: string, actual: string): DivergenceResult {
    const expected = this.expectations.get(phase) || "";

    // Record the outcome
    this.outcomes.push({
      phase,
      expectedOutcome: expected,
      actualOutcome: actual,
      timestamp: new Date().toISOString(),
    });

    // Calculate divergence factors
    const factors = this.calculateDivergenceFactors(expected, actual);

    // Compute weighted score
    const score = this.computeDivergenceScore(factors);

    // Determine if we should replan
    const shouldReplan =
      this.config.enableReplanning &&
      score > this.config.divergenceThreshold &&
      this.replanCount < this.config.maxReplans;

    const reason = shouldReplan
      ? `Divergence score ${score.toFixed(2)} exceeds threshold ${this.config.divergenceThreshold}`
      : undefined;

    // Increment replan count if this evaluation triggers a replan
    if (shouldReplan) {
      this.replanCount++;
    }

    return {
      score,
      factors,
      shouldReplan,
      reason,
    };
  }

  /**
   * Get replan decision if divergence is high
   */
  getReplanDecision(remainingPhases: string[]): ReplanDecision | null {
    if (this.outcomes.length === 0) {
      return null;
    }

    const lastOutcome = this.outcomes[this.outcomes.length - 1];

    // Re-evaluate the last outcome to get current divergence
    const expected = this.expectations.get(lastOutcome.phase) || "";
    const factors = this.calculateDivergenceFactors(expected, lastOutcome.actualOutcome);
    const score = this.computeDivergenceScore(factors);

    // Check if should replan (note: replanCount already incremented in evaluatePhase if needed)
    const shouldReplan =
      this.config.enableReplanning &&
      score > this.config.divergenceThreshold &&
      this.lastReplanDecision?.trigger !== lastOutcome.phase; // Don't replan same phase twice

    if (!shouldReplan) {
      return null;
    }

    // Determine revised plan (remove phases that depend on wrong assumptions)
    const revisedPlan = this.revisePlan(remainingPhases, lastOutcome);

    const reason = `Divergence score ${score.toFixed(2)} exceeds threshold ${this.config.divergenceThreshold}`;

    const decision: ReplanDecision = {
      trigger: lastOutcome.phase,
      divergenceScore: score,
      originalPlan: remainingPhases,
      revisedPlan,
      reason,
    };

    this.lastReplanDecision = decision;

    return decision;
  }

  /**
   * Get history of all evaluations
   */
  getHistory(): PhaseOutcome[] {
    return [...this.outcomes];
  }

  /**
   * Get count of replans triggered
   */
  getReplanCount(): number {
    return this.replanCount;
  }

  /**
   * Reset for new algorithm run
   */
  reset(): void {
    this.expectations.clear();
    this.outcomes = [];
    this.replanCount = 0;
    this.lastReplanDecision = null;
  }

  /**
   * Calculate individual divergence factors
   */
  private calculateDivergenceFactors(expected: string, actual: string): DivergenceFactor[] {
    const factors: DivergenceFactor[] = [];

    // 1. Length divergence (weight 0.2)
    const lengthDivergence = this.calculateLengthDivergence(expected, actual);
    factors.push({
      name: "length_divergence",
      weight: 0.2,
      score: lengthDivergence,
      detail: `Expected length: ${expected.length}, Actual length: ${actual.length}`,
    });

    // 2. Error signals (weight 0.4)
    const errorSignals = this.detectErrorSignals(expected, actual);
    factors.push({
      name: "error_signals",
      weight: 0.4,
      score: errorSignals,
      detail: errorSignals > 0
        ? "Error keywords detected in actual but not expected"
        : "No unexpected error signals",
    });

    // 3. Topic drift (weight 0.2)
    const topicDrift = this.calculateTopicDrift(expected, actual);
    factors.push({
      name: "topic_drift",
      weight: 0.2,
      score: topicDrift,
      detail: `${Math.round(topicDrift * 100)}% of expected topics missing`,
    });

    // 4. New discoveries (weight 0.2)
    const newDiscoveries = this.detectNewDiscoveries(actual);
    factors.push({
      name: "new_discoveries",
      weight: 0.2,
      score: newDiscoveries,
      detail: newDiscoveries > 0
        ? "Discovery signals suggesting pivoted understanding"
        : "No discovery signals detected",
    });

    return factors;
  }

  /**
   * Compute weighted divergence score
   */
  private computeDivergenceScore(factors: DivergenceFactor[]): number {
    const weightedSum = factors.reduce(
      (sum, factor) => sum + factor.score * factor.weight,
      0
    );
    return Math.max(0, Math.min(1, weightedSum));
  }

  /**
   * Calculate length divergence score
   */
  private calculateLengthDivergence(expected: string, actual: string): number {
    if (expected.length === 0) return 0;

    const ratio = actual.length / expected.length;

    // High divergence if >3x or <0.3x expected length
    if (ratio > 3.0 || ratio < 0.3) {
      return 1.0;
    }

    // Moderate divergence if >2x or <0.5x
    if (ratio > 2.0 || ratio < 0.5) {
      return 0.5;
    }

    return 0.0;
  }

  /**
   * Detect error signals in actual output
   */
  private detectErrorSignals(expected: string, actual: string): number {
    const errorKeywords = [
      "failed",
      "error",
      "unexpected",
      "wrong assumption",
      "cannot",
      "unable",
      "exception",
    ];

    const expectedLower = expected.toLowerCase();
    const actualLower = actual.toLowerCase();

    // Count error keywords that appear in actual but not in expected
    const unexpectedErrors = errorKeywords.filter(keyword => {
      const inActual = actualLower.includes(keyword);
      const inExpected = expectedLower.includes(keyword);
      return inActual && !inExpected;
    });

    return unexpectedErrors.length > 0 ? 1.0 : 0.0;
  }

  /**
   * Calculate topic drift (missing key terms from expected)
   */
  private calculateTopicDrift(expected: string, actual: string): number {
    // Extract words from expected (filter out common words)
    const stopWords = new Set([
      "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
      "of", "with", "by", "from", "up", "about", "into", "through", "during",
      "before", "after", "above", "below", "between", "under", "is", "are",
      "was", "were", "be", "been", "being", "have", "has", "had", "do", "does",
      "did", "will", "would", "should", "could", "may", "might", "must", "can",
    ]);

    const extractWords = (text: string): Set<string> => {
      return new Set(
        text
          .toLowerCase()
          .split(/\W+/)
          .filter(word => word.length > 3 && !stopWords.has(word))
      );
    };

    const expectedWords = extractWords(expected);
    const actualWords = extractWords(actual);

    if (expectedWords.size === 0) return 0;

    // Count how many expected words are missing in actual
    let missingCount = 0;
    for (const word of expectedWords) {
      if (!actualWords.has(word)) {
        missingCount++;
      }
    }

    return missingCount / expectedWords.size;
  }

  /**
   * Detect discovery signals suggesting pivoted understanding
   */
  private detectNewDiscoveries(actual: string): number {
    const discoverySignals = [
      "actually",
      "instead",
      "turns out",
      "contrary to",
      "however",
      "surprisingly",
      "unexpectedly",
      "in fact",
    ];

    const actualLower = actual.toLowerCase();

    const signalsFound = discoverySignals.filter(signal =>
      actualLower.includes(signal)
    ).length;

    // Return normalized score (cap at 1.0)
    return Math.min(1.0, signalsFound / 2);
  }

  /**
   * Revise plan based on divergence
   */
  private revisePlan(remainingPhases: string[], lastOutcome: PhaseOutcome): string[] {
    // Simple heuristic: if we're in early phases (observe, orient), keep all phases
    // If we're in later phases (decide, act), we may need to go back to orient
    const earlyPhases = ["observe", "orient"];

    if (earlyPhases.includes(lastOutcome.phase)) {
      // Early divergence: re-observe/re-orient
      return ["observe", "orient", ...remainingPhases];
    } else {
      // Late divergence: go back to orient, then continue
      return ["orient", ...remainingPhases];
    }
  }
}
