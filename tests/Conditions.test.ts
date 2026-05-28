import { describe, test, expect } from 'bun:test';
import { evaluateCondition, PhaseContext, getPhaseCondition, BUILTIN_CONDITIONS } from '../scripts/lib/conditions';

describe('evaluateCondition', () => {
  test('output.implement.length > 500 evaluates correctly', () => {
    const context: PhaseContext = {
      output: {
        implement: 'x'.repeat(600),
      },
      metrics: {},
    };

    expect(evaluateCondition('output.implement.length > 500', context)).toBe(true);
  });

  test('output.implement.length > 500 evaluates false when short', () => {
    const context: PhaseContext = {
      output: {
        implement: 'x'.repeat(400),
      },
      metrics: {},
    };

    expect(evaluateCondition('output.implement.length > 500', context)).toBe(false);
  });

  test('output.implement.length < 500 evaluates correctly', () => {
    const context: PhaseContext = {
      output: {
        implement: 'x'.repeat(300),
      },
      metrics: {},
    };

    expect(evaluateCondition('output.implement.length < 500', context)).toBe(true);
  });

  test('output.implement.length >= 500 evaluates correctly at boundary', () => {
    const context: PhaseContext = {
      output: {
        implement: 'x'.repeat(500),
      },
      metrics: {},
    };

    expect(evaluateCondition('output.implement.length >= 500', context)).toBe(true);
  });

  test('output.implement.length <= 500 evaluates correctly at boundary', () => {
    const context: PhaseContext = {
      output: {
        implement: 'x'.repeat(500),
      },
      metrics: {},
    };

    expect(evaluateCondition('output.implement.length <= 500', context)).toBe(true);
  });

  test('metrics.totalCostUsd > 0.50 evaluates correctly', () => {
    const context: PhaseContext = {
      output: {},
      metrics: {
        totalCostUsd: 0.75,
      },
    };

    expect(evaluateCondition('metrics.totalCostUsd > 0.50', context)).toBe(true);
  });

  test('metrics.totalCostUsd >= 0.50 evaluates correctly at boundary', () => {
    const context: PhaseContext = {
      output: {},
      metrics: {
        totalCostUsd: 0.50,
      },
    };

    expect(evaluateCondition('metrics.totalCostUsd >= 0.50', context)).toBe(true);
  });

  test('metrics.totalCostUsd < 0.50 evaluates correctly', () => {
    const context: PhaseContext = {
      output: {},
      metrics: {
        totalCostUsd: 0.30,
      },
    };

    expect(evaluateCondition('metrics.totalCostUsd < 0.50', context)).toBe(true);
  });

  test('metrics.qaVerdictSeverity == "Critical" evaluates correctly', () => {
    const context: PhaseContext = {
      output: {},
      metrics: {
        qaVerdictSeverity: 'Critical',
      },
    };

    expect(evaluateCondition('metrics.qaVerdictSeverity == "Critical"', context)).toBe(true);
  });

  test('metrics.qaVerdictSeverity != "Critical" evaluates correctly', () => {
    const context: PhaseContext = {
      output: {},
      metrics: {
        qaVerdictSeverity: 'Minor',
      },
    };

    expect(evaluateCondition('metrics.qaVerdictSeverity != "Critical"', context)).toBe(true);
  });

  test('invalid condition expression returns true (fail-open)', () => {
    const context: PhaseContext = {
      output: {},
      metrics: {},
    };

    expect(evaluateCondition('invalid syntax here', context)).toBe(true);
  });

  test('missing phase output fails open (returns true)', () => {
    const context: PhaseContext = {
      output: {},
      metrics: {},
    };

    // Phase 'implement' doesn't exist in output yet
    expect(evaluateCondition('output.implement.length > 500', context)).toBe(true);
  });

  test('missing metric fails open (returns true)', () => {
    const context: PhaseContext = {
      output: {},
      metrics: {},
    };

    expect(evaluateCondition('metrics.nonexistent > 100', context)).toBe(true);
  });

  test('equality operator works for metrics', () => {
    const context: PhaseContext = {
      output: {},
      metrics: {
        implementLines: 100,
      },
    };

    expect(evaluateCondition('metrics.implementLines == 100', context)).toBe(true);
    expect(evaluateCondition('metrics.implementLines == 200', context)).toBe(false);
  });

  test('inequality operator works for metrics', () => {
    const context: PhaseContext = {
      output: {},
      metrics: {
        implementLines: 100,
      },
    };

    expect(evaluateCondition('metrics.implementLines != 200', context)).toBe(true);
    expect(evaluateCondition('metrics.implementLines != 100', context)).toBe(false);
  });
});

describe('BUILTIN_CONDITIONS', () => {
  test('verify phase has builtin condition', () => {
    const condition = getPhaseCondition('verify');
    expect(condition).not.toBeNull();
    expect(condition?.phase).toBe('verify');
    expect(condition?.condition).toContain('output.implement.length');
  });

  test('review phase has builtin condition', () => {
    const condition = getPhaseCondition('review');
    expect(condition).not.toBeNull();
    expect(condition?.phase).toBe('review');
    expect(condition?.condition).toContain('metrics.totalCostUsd');
  });

  test('non-existent phase returns null', () => {
    expect(getPhaseCondition('nonexistent')).toBeNull();
  });

  test('custom conditions override builtins', () => {
    const custom = [
      {
        phase: 'verify',
        condition: 'output.implement.length > 1000',
        skipReason: 'Custom reason',
      },
    ];

    const condition = getPhaseCondition('verify', custom);
    expect(condition?.condition).toBe('output.implement.length > 1000');
    expect(condition?.skipReason).toBe('Custom reason');
  });
});

describe('Condition integration scenarios', () => {
  test('short output skips verify (condition false)', () => {
    const context: PhaseContext = {
      output: {
        implement: 'x'.repeat(300), // < 500
      },
      metrics: {},
    };

    const condition = getPhaseCondition('verify');
    expect(condition).not.toBeNull();

    const shouldRun = evaluateCondition(condition!.condition, context);
    expect(shouldRun).toBe(false);
  });

  test('long output runs verify (condition true)', () => {
    const context: PhaseContext = {
      output: {
        implement: 'x'.repeat(600), // >= 500
      },
      metrics: {},
    };

    const condition = getPhaseCondition('verify');
    expect(condition).not.toBeNull();

    const shouldRun = evaluateCondition(condition!.condition, context);
    expect(shouldRun).toBe(true);
  });

  test('low cost skips review (condition false)', () => {
    const context: PhaseContext = {
      output: {},
      metrics: {
        totalCostUsd: 0.30, // < 0.50
      },
    };

    const condition = getPhaseCondition('review');
    expect(condition).not.toBeNull();

    const shouldRun = evaluateCondition(condition!.condition, context);
    expect(shouldRun).toBe(false);
  });

  test('high cost runs review (condition true)', () => {
    const context: PhaseContext = {
      output: {},
      metrics: {
        totalCostUsd: 0.75, // >= 0.50
      },
    };

    const condition = getPhaseCondition('review');
    expect(condition).not.toBeNull();

    const shouldRun = evaluateCondition(condition!.condition, context);
    expect(shouldRun).toBe(true);
  });
});
