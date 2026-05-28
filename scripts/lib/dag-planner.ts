export interface PhaseNode {
  id: string;
  dependsOn: string[];
  condition?: string;
}

export interface ExecutionTier {
  tier: number;
  phases: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate that the DAG is well-formed:
 * - No circular dependencies
 * - All dependencies exist
 */
export function validateDAG(phases: PhaseNode[]): ValidationResult {
  const errors: string[] = [];
  const phaseIds = new Set(phases.map(p => p.id));

  // Check 1: All dependencies exist
  for (const phase of phases) {
    for (const dep of phase.dependsOn) {
      if (!phaseIds.has(dep)) {
        errors.push(`Phase "${phase.id}" depends on non-existent phase "${dep}"`);
      }
    }
  }

  // Check 2: No circular dependencies (cycle detection via DFS)
  const hasCycle = detectCycle(phases);
  if (hasCycle) {
    errors.push('Circular dependency detected in phase graph');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Detect cycles in the dependency graph using DFS
 */
function detectCycle(phases: PhaseNode[]): boolean {
  const adjacencyList = new Map<string, string[]>();
  for (const phase of phases) {
    adjacencyList.set(phase.id, phase.dependsOn);
  }

  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function dfs(nodeId: string): boolean {
    visited.add(nodeId);
    recursionStack.add(nodeId);

    const neighbors = adjacencyList.get(nodeId) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor)) return true;
      } else if (recursionStack.has(neighbor)) {
        // Back edge found — cycle detected
        return true;
      }
    }

    recursionStack.delete(nodeId);
    return false;
  }

  for (const phase of phases) {
    if (!visited.has(phase.id)) {
      if (dfs(phase.id)) return true;
    }
  }

  return false;
}

/**
 * Build an execution plan from a DAG of phases.
 * Returns tiers where phases in the same tier can run in parallel.
 * Uses topological sort (Kahn's algorithm) to group phases into tiers.
 */
export function buildExecutionPlan(phases: PhaseNode[]): ExecutionTier[] {
  // Validate first
  const validation = validateDAG(phases);
  if (!validation.valid) {
    throw new Error(`Invalid DAG: ${validation.errors.join('; ')}`);
  }

  if (phases.length === 0) {
    return [];
  }

  // Build adjacency list and in-degree map
  const adjacencyList = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  // Initialize
  for (const phase of phases) {
    adjacencyList.set(phase.id, []);
    inDegree.set(phase.id, 0);
  }

  // Build edges (reverse: dependent -> dependency becomes dependency -> dependent)
  for (const phase of phases) {
    for (const dep of phase.dependsOn) {
      adjacencyList.get(dep)?.push(phase.id);
      inDegree.set(phase.id, (inDegree.get(phase.id) || 0) + 1);
    }
  }

  // Topological sort by tiers (Kahn's algorithm, tier-aware)
  const tiers: ExecutionTier[] = [];
  const processed = new Set<string>();
  let tierNumber = 0;

  while (processed.size < phases.length) {
    // Find all nodes with in-degree 0 (no remaining dependencies)
    const currentTier: string[] = [];
    for (const phase of phases) {
      if (!processed.has(phase.id) && inDegree.get(phase.id) === 0) {
        currentTier.push(phase.id);
      }
    }

    if (currentTier.length === 0) {
      // Should not happen if validation passed, but defensive check
      throw new Error('Unable to build execution plan — possible cycle or dependency issue');
    }

    tiers.push({
      tier: tierNumber++,
      phases: currentTier,
    });

    // Mark as processed and reduce in-degree of dependents
    for (const phaseId of currentTier) {
      processed.add(phaseId);
      const dependents = adjacencyList.get(phaseId) || [];
      for (const dependent of dependents) {
        inDegree.set(dependent, (inDegree.get(dependent) || 0) - 1);
      }
    }
  }

  return tiers;
}

/**
 * Convert a linear phase list into PhaseNodes with sequential dependencies.
 * Useful for existing presets that assume sequential execution.
 */
export function linearToDAG(phaseIds: string[]): PhaseNode[] {
  return phaseIds.map((id, idx) => ({
    id,
    dependsOn: idx > 0 ? [phaseIds[idx - 1]] : [],
  }));
}
