import { writeArtifact, saveWorkItem } from '../ledger';
import { evaluatePolicy, type CheckState } from '../policy';
import {
  type AgentResult,
  type Decision,
  type Finding,
  type PolicyResult,
  type WorkArtifact,
  type WorkItem,
  type WorkItemStatus,
  type WorkPacket,
  type WorkRole,
  validateAgentResult,
  validateWorkItem,
} from '../schema';

export type AgentRunner = (packet: WorkPacket) => Promise<AgentResult | unknown>;

export interface AdversarialReviewOptions {
  dryRun?: boolean;
  runAgent?: AgentRunner;
  ledgerRoot?: string;
  checkState?: CheckState;
}

export interface AdversarialReviewResult {
  status: Decision['status'];
  workItemId: string;
  workflow: 'adversarial-review';
  packets: WorkPacket[];
  agentResults: AgentResult[];
  findings: Finding[];
  policyResult: PolicyResult;
  decision: Decision;
  artifacts: WorkArtifact[];
  warnings: string[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function roleId(role: WorkRole): string {
  return role.id ?? `${role.engine}-${role.role}`;
}

function packetForRole(workItem: WorkItem, role: WorkRole, suffix: string, artifacts: WorkArtifact[], findings?: Finding[]): WorkPacket {
  return {
    id: `${workItem.id}-${roleId(role)}-${suffix}`,
    workItemId: workItem.id,
    type: workItem.type,
    objective: workItem.objective,
    role,
    inputs: workItem.inputs,
    policy: workItem.policy,
    artifacts,
    findings,
  };
}

function packetArtifact(packet: WorkPacket): WorkArtifact {
  return {
    id: `${packet.id}-packet`,
    type: 'packet',
    source: 'orchestrator',
    createdAt: nowIso(),
    content: JSON.stringify(packet, null, 2),
    metadata: {
      role: packet.role.role,
      engine: packet.role.engine,
      workItemId: packet.workItemId,
    },
  };
}

function findingReportArtifact(workItem: WorkItem, findings: Finding[]): WorkArtifact {
  return {
    id: `${workItem.id}-findings`,
    type: 'finding-report',
    source: 'orchestrator',
    createdAt: nowIso(),
    content: JSON.stringify({ findings }, null, 2),
    metadata: {
      findingCount: findings.length,
      openBlockingCount: findings.filter((finding) =>
        finding.status === 'open' && (finding.severity === 'blocker' || finding.severity === 'high')
      ).length,
    },
  };
}

function decisionArtifact(workItem: WorkItem, policyResult: PolicyResult, agentResults: AgentResult[]): WorkArtifact {
  return {
    id: `${workItem.id}-decision`,
    type: 'decision',
    source: 'orchestrator',
    createdAt: nowIso(),
    content: JSON.stringify({ policyResult, agentSummaries: agentResults.map(({ status, summary }) => ({ status, summary })) }, null, 2),
    metadata: {
      status: policyResult.decision.status,
      allowed: policyResult.allowed,
      reasonCount: policyResult.reasons.length,
    },
  };
}

function artifactResult(status: AgentResult['status'], summary: string, packet: WorkPacket, finding?: Finding): AgentResult {
  return {
    status,
    summary,
    artifacts: [{
      id: `${packet.id}-fixture-agent-result`,
      type: 'agent-result',
      source: packet.role.engine,
      createdAt: nowIso(),
      content: JSON.stringify({ role: packet.role.role, summary }, null, 2),
      metadata: {
        dryRunFixture: true,
        role: packet.role.role,
        engine: packet.role.engine,
      },
    }],
    findings: finding ? [finding] : undefined,
  };
}

export async function fixtureAdversarialAgentRunner(packet: WorkPacket): Promise<AgentResult> {
  if (packet.role.role === 'red-team') {
    return artifactResult('findings', 'Fixture red-team found one medium design risk.', packet, {
      id: `${packet.id}-rollback-risk`,
      severity: 'medium',
      category: 'design',
      issue: 'The plan does not name a rollback checkpoint.',
      recommendation: 'Add a rollback checkpoint before unattended execution is enabled.',
      confidence: 'high',
      status: 'open',
    });
  }
  if (packet.role.role === 'reviewer') {
    return artifactResult('pass', 'Fixture reviewer found no blocking issues.', packet);
  }
  if (packet.role.role === 'judge') {
    return artifactResult('pass', `Fixture judge synthesized ${packet.findings?.length ?? 0} finding(s).`, packet);
  }
  return artifactResult('blocked', `Unsupported adversarial-review role: ${packet.role.role}`, packet);
}

function workflowStatus(decision: Decision): WorkItemStatus {
  if (decision.status === 'complete' || decision.status === 'fixed' || decision.status === 'merge-ready') return 'complete';
  if (decision.status === 'failed') return 'failed';
  return 'blocked';
}

function workItemPolicyPaths(workItem: WorkItem): string[] {
  const paths = new Set<string>();
  for (const input of workItem.inputs) {
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(input.source)) paths.add(input.source);
  }
  for (const artifact of workItem.artifacts) {
    if (artifact.path) paths.add(artifact.path);
  }
  return [...paths].sort();
}

function blockedResult(workItem: WorkItem, reason: string, artifacts: WorkArtifact[] = [], warnings: string[] = []): AdversarialReviewResult {
  const policyResult: PolicyResult = {
    allowed: false,
    decision: { status: 'blocked', reason, actions: ['fix-work-item'] },
    reasons: [reason],
    requiredActions: ['fix-work-item'],
  };
  return {
    status: 'blocked',
    workItemId: workItem.id,
    workflow: 'adversarial-review',
    packets: [],
    agentResults: [],
    findings: [],
    policyResult,
    decision: policyResult.decision,
    artifacts: [...artifacts, decisionArtifact(workItem, policyResult, [])],
    warnings,
  };
}

export async function runAdversarialReview(workItem: WorkItem, options: AdversarialReviewOptions = {}): Promise<AdversarialReviewResult> {
  const validation = validateWorkItem(workItem);
  if (!validation.value) {
    return blockedResult(workItem, `Work item validation failed: ${validation.errors.join('; ')}`, [], validation.warnings);
  }
  if (validation.value.type !== 'adversarial-review') {
    return blockedResult(validation.value, `Unsupported workflow for adversarial-review runner: ${validation.value.type}`, [], validation.warnings);
  }

  const runner = options.runAgent ?? (options.dryRun ? fixtureAdversarialAgentRunner : undefined);
  if (!runner) {
    return blockedResult(validation.value, 'No agent runner configured; live adversarial-review execution is disabled by default.', [], validation.warnings);
  }

  const reviewRoles = validation.value.roles.filter((role) => role.role === 'reviewer' || role.role === 'red-team');
  const judgeRole = validation.value.roles.find((role) => role.role === 'judge');
  if (reviewRoles.length === 0) return blockedResult(validation.value, 'Adversarial review requires at least one reviewer or red-team role.', [], validation.warnings);
  if (!judgeRole) return blockedResult(validation.value, 'Adversarial review requires a judge role.', [], validation.warnings);

  const artifacts: WorkArtifact[] = [...validation.value.artifacts];
  const packets: WorkPacket[] = [];
  const agentResults: AgentResult[] = [];
  const malformedReasons: string[] = [];

  const recordArtifact = (artifact: WorkArtifact): WorkArtifact => {
    const written = options.ledgerRoot ? writeArtifact(options.ledgerRoot, validation.value.id, artifact) : artifact;
    artifacts.push(written);
    return written;
  };

  for (const role of reviewRoles) {
    const packet = packetForRole(validation.value, role, 'review', artifacts);
    packets.push(packet);
    recordArtifact(packetArtifact(packet));
    try {
      const rawResult = await runner(packet);
      const result = validateAgentResult(rawResult);
      if (!result.value) {
        malformedReasons.push(`${packet.id}: ${result.errors.join('; ')}`);
        const errorResult = artifactResult('error', `Agent result failed validation: ${result.errors.join('; ')}`, packet);
        agentResults.push(errorResult);
        errorResult.artifacts.forEach(recordArtifact);
      } else {
        agentResults.push(result.value);
        result.value.artifacts.forEach(recordArtifact);
      }
    } catch (error) {
      const errorResult = artifactResult('error', `Agent runner threw: ${error instanceof Error ? error.message : String(error)}`, packet);
      agentResults.push(errorResult);
      errorResult.artifacts.forEach(recordArtifact);
    }
  }

  const reviewFindings = agentResults.flatMap((result) => result.findings ?? []);
  recordArtifact(findingReportArtifact(validation.value, reviewFindings));

  const judgePacket = packetForRole(validation.value, judgeRole, 'judge', artifacts, reviewFindings);
  packets.push(judgePacket);
  recordArtifact(packetArtifact(judgePacket));
  try {
    const rawJudgeResult = await runner(judgePacket);
    const judgeValidation = validateAgentResult(rawJudgeResult);
    if (!judgeValidation.value) {
      malformedReasons.push(`${judgePacket.id}: ${judgeValidation.errors.join('; ')}`);
      const errorResult = artifactResult('error', `Judge result failed validation: ${judgeValidation.errors.join('; ')}`, judgePacket);
      agentResults.push(errorResult);
      errorResult.artifacts.forEach(recordArtifact);
    } else {
      agentResults.push(judgeValidation.value);
      judgeValidation.value.artifacts.forEach(recordArtifact);
    }
  } catch (error) {
    const errorResult = artifactResult('error', `Judge runner threw: ${error instanceof Error ? error.message : String(error)}`, judgePacket);
    agentResults.push(errorResult);
    errorResult.artifacts.forEach(recordArtifact);
  }

  const findings = agentResults.flatMap((result) => result.findings ?? []);
  const badAgentResult = agentResults.find((result) => result.status === 'error' || result.status === 'blocked');
  const policyResult = evaluatePolicy({
    policy: validation.value.policy,
    requestedAction: 'advise',
    findings,
    checkState: options.checkState ?? 'green',
    changedPaths: workItemPolicyPaths(validation.value),
    agentResult: badAgentResult,
    malformedAgentOutput: malformedReasons.length > 0,
  });
  const finalDecisionArtifact = recordArtifact(decisionArtifact(validation.value, policyResult, agentResults));
  const finalArtifacts = artifacts.includes(finalDecisionArtifact) ? artifacts : [...artifacts, finalDecisionArtifact];
  const updatedWorkItem: WorkItem = {
    ...validation.value,
    artifacts: finalArtifacts,
    status: workflowStatus(policyResult.decision),
  };
  if (options.ledgerRoot) saveWorkItem(options.ledgerRoot, updatedWorkItem);

  return {
    status: policyResult.decision.status,
    workItemId: validation.value.id,
    workflow: 'adversarial-review',
    packets,
    agentResults,
    findings,
    policyResult,
    decision: policyResult.decision,
    artifacts: finalArtifacts,
    warnings: [...validation.warnings, ...malformedReasons],
  };
}
