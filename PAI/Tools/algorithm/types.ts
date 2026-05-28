/**
 * algorithm/types.ts - Core type definitions for The Algorithm CLI
 */

export interface PRDFrontmatter {
  prd: boolean;
  id: string;
  status: string;
  mode: string;
  effort_level: string;
  iteration: number;
  maxIterations: number;
  loopStatus: string | null;
  last_phase: string | null;
  failing_criteria: string[];
  verification_summary: string;
  [key: string]: unknown;
}

export interface CriteriaInfo {
  total: number;
  passing: number;
  failing: number;
  failingIds: string[];
  criteria: Array<{ id: string; description: string; status: "passing" | "failing" }>;
}

export interface LoopAlgorithmState {
  active: boolean;
  sessionId: string;
  taskDescription: string;
  currentPhase: string;
  phaseStartedAt: number;
  algorithmStartedAt: number;
  sla: string;
  effortLevel?: string;
  criteria: Array<{
    id: string;
    description: string;
    type: "criterion" | "anti-criterion";
    status: "pending" | "in_progress" | "completed" | "failed";
    createdInPhase: string;
  }>;
  agents: Array<{
    name: string;
    agentType: string;
    status: string;
    task?: string;
    criteriaIds?: string[];
    phase?: string;
  }>;
  capabilities: string[];
  prdPath?: string;
  phaseHistory: Array<{
    phase: string;
    startedAt: number;
    completedAt?: number;
    criteriaCount: number;
    agentCount: number;
  }>;
  completedAt?: number;
  summary?: string;
  // Loop-specific fields
  loopMode?: boolean;
  loopIteration?: number;
  loopMaxIterations?: number;
  loopPrdId?: string;
  loopPrdPath?: string;
  loopHistory?: Array<{
    iteration: number;
    startedAt: number;
    completedAt: number;
    criteriaPassing: number;
    criteriaTotal: number;
    sdkSessionId?: string;
  }>;
  // Parallel agent fields
  parallelAgents?: number;
  mode?: "loop" | "interactive" | "standard";
}

export interface ParsedArgs {
  subcommand: string | null;    // status, pause, resume, stop, new, or null (= run)
  mode: string | null;          // loop, interactive
  prdPath: string | null;       // -p value
  maxIterations: number | null; // -n value
  agentCount: number;           // -a value (default 1)
  title: string | null;         // -t value (for 'new' subcommand)
  effortLevel: string | null;   // -e value (for 'new' subcommand)
}

export interface AgentAssignment {
  agentId: number;
  criteriaIds: string[];
  criteriaDetails: Array<{ id: string; description: string }>;
}
