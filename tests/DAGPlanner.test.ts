import { describe, test, expect } from 'bun:test';
import { buildExecutionPlan, validateDAG, PhaseNode, linearToDAG } from '../scripts/lib/dag-planner';

describe('validateDAG', () => {
  test('valid linear DAG passes validation', () => {
    const phases: PhaseNode[] = [
      { id: 'scope', dependsOn: [] },
      { id: 'implement', dependsOn: ['scope'] },
      { id: 'verify', dependsOn: ['implement'] },
    ];

    const result = validateDAG(phases);
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  test('valid parallel DAG passes validation', () => {
    const phases: PhaseNode[] = [
      { id: 'scope', dependsOn: [] },
      { id: 'implement', dependsOn: ['scope'] },
      { id: 'verify', dependsOn: ['implement'] },
      { id: 'security', dependsOn: ['implement'] },
      { id: 'review', dependsOn: ['verify', 'security'] },
    ];

    const result = validateDAG(phases);
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  test('circular dependency detected', () => {
    const phases: PhaseNode[] = [
      { id: 'scope', dependsOn: ['verify'] },
      { id: 'implement', dependsOn: ['scope'] },
      { id: 'verify', dependsOn: ['implement'] },
    ];

    const result = validateDAG(phases);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Circular'))).toBe(true);
  });

  test('self-dependency detected as cycle', () => {
    const phases: PhaseNode[] = [
      { id: 'scope', dependsOn: ['scope'] },
    ];

    const result = validateDAG(phases);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Circular'))).toBe(true);
  });

  test('missing dependency detected', () => {
    const phases: PhaseNode[] = [
      { id: 'scope', dependsOn: [] },
      { id: 'implement', dependsOn: ['nonexistent'] },
    ];

    const result = validateDAG(phases);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('non-existent'))).toBe(true);
  });

  test('multiple errors reported', () => {
    const phases: PhaseNode[] = [
      { id: 'scope', dependsOn: ['nonexistent1'] },
      { id: 'implement', dependsOn: ['nonexistent2'] },
    ];

    const result = validateDAG(phases);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  test('empty phase list is valid', () => {
    const result = validateDAG([]);
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });
});

describe('buildExecutionPlan', () => {
  test('linear phases produce sequential tiers', () => {
    const phases: PhaseNode[] = [
      { id: 'scope', dependsOn: [] },
      { id: 'implement', dependsOn: ['scope'] },
      { id: 'verify', dependsOn: ['implement'] },
    ];

    const plan = buildExecutionPlan(phases);
    expect(plan.length).toBe(3);
    expect(plan[0].phases).toEqual(['scope']);
    expect(plan[1].phases).toEqual(['implement']);
    expect(plan[2].phases).toEqual(['verify']);
  });

  test('parallel-eligible phases grouped in same tier', () => {
    const phases: PhaseNode[] = [
      { id: 'scope', dependsOn: [] },
      { id: 'implement', dependsOn: ['scope'] },
      { id: 'verify', dependsOn: ['implement'] },
      { id: 'security', dependsOn: ['implement'] },
      { id: 'review', dependsOn: ['verify', 'security'] },
    ];

    const plan = buildExecutionPlan(phases);
    expect(plan.length).toBe(4);
    expect(plan[0].phases).toEqual(['scope']);
    expect(plan[1].phases).toEqual(['implement']);
    // Tier 2 should have both verify and security (they're parallel)
    expect(plan[2].phases.sort()).toEqual(['security', 'verify']);
    expect(plan[3].phases).toEqual(['review']);
  });

  test('circular dependency throws error', () => {
    const phases: PhaseNode[] = [
      { id: 'scope', dependsOn: ['verify'] },
      { id: 'verify', dependsOn: ['scope'] },
    ];

    expect(() => buildExecutionPlan(phases)).toThrow('Invalid DAG');
  });

  test('missing dependency throws error', () => {
    const phases: PhaseNode[] = [
      { id: 'scope', dependsOn: ['nonexistent'] },
    ];

    expect(() => buildExecutionPlan(phases)).toThrow('Invalid DAG');
  });

  test('empty phase list produces empty plan', () => {
    const plan = buildExecutionPlan([]);
    expect(plan.length).toBe(0);
  });

  test('single phase with no dependencies', () => {
    const phases: PhaseNode[] = [
      { id: 'scope', dependsOn: [] },
    ];

    const plan = buildExecutionPlan(phases);
    expect(plan.length).toBe(1);
    expect(plan[0].phases).toEqual(['scope']);
  });

  test('multiple root phases (no dependencies) in same tier', () => {
    const phases: PhaseNode[] = [
      { id: 'scope', dependsOn: [] },
      { id: 'research', dependsOn: [] },
      { id: 'implement', dependsOn: ['scope', 'research'] },
    ];

    const plan = buildExecutionPlan(phases);
    expect(plan.length).toBe(2);
    expect(plan[0].phases.sort()).toEqual(['research', 'scope']);
    expect(plan[1].phases).toEqual(['implement']);
  });

  test('complex diamond DAG', () => {
    const phases: PhaseNode[] = [
      { id: 'scope', dependsOn: [] },
      { id: 'dev1', dependsOn: ['scope'] },
      { id: 'dev2', dependsOn: ['scope'] },
      { id: 'integrate', dependsOn: ['dev1', 'dev2'] },
    ];

    const plan = buildExecutionPlan(phases);
    expect(plan.length).toBe(3);
    expect(plan[0].phases).toEqual(['scope']);
    expect(plan[1].phases.sort()).toEqual(['dev1', 'dev2']);
    expect(plan[2].phases).toEqual(['integrate']);
  });

  test('tier numbers are sequential starting from 0', () => {
    const phases: PhaseNode[] = [
      { id: 'scope', dependsOn: [] },
      { id: 'implement', dependsOn: ['scope'] },
      { id: 'verify', dependsOn: ['implement'] },
    ];

    const plan = buildExecutionPlan(phases);
    expect(plan[0].tier).toBe(0);
    expect(plan[1].tier).toBe(1);
    expect(plan[2].tier).toBe(2);
  });
});

describe('linearToDAG', () => {
  test('converts linear phase list to sequential DAG', () => {
    const phases = linearToDAG(['scope', 'implement', 'verify']);

    expect(phases.length).toBe(3);
    expect(phases[0]).toEqual({ id: 'scope', dependsOn: [] });
    expect(phases[1]).toEqual({ id: 'implement', dependsOn: ['scope'] });
    expect(phases[2]).toEqual({ id: 'verify', dependsOn: ['implement'] });
  });

  test('single phase has no dependencies', () => {
    const phases = linearToDAG(['scope']);

    expect(phases.length).toBe(1);
    expect(phases[0]).toEqual({ id: 'scope', dependsOn: [] });
  });

  test('empty list produces empty DAG', () => {
    const phases = linearToDAG([]);
    expect(phases.length).toBe(0);
  });

  test('result is valid and produces sequential plan', () => {
    const phases = linearToDAG(['scope', 'implement', 'verify', 'review']);

    const validation = validateDAG(phases);
    expect(validation.valid).toBe(true);

    const plan = buildExecutionPlan(phases);
    expect(plan.length).toBe(4);
    expect(plan[0].phases).toEqual(['scope']);
    expect(plan[1].phases).toEqual(['implement']);
    expect(plan[2].phases).toEqual(['verify']);
    expect(plan[3].phases).toEqual(['review']);
  });
});
