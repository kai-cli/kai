import { emitOrchestratorComment } from '../comments';
import { type CheckState, evaluatePolicy } from '../policy';
import { fixtureGitHubClient, type GitHubClient, type PullRequestContext } from '../github';
import { saveWorkItem, writeArtifact } from '../ledger';
import {
  type AgentResult,
  type Decision,
  type Finding,
  type PolicyResult,
  type WorkArtifact,
  type WorkInput,
  type WorkItem,
  type WorkItemStatus,
  type WorkPacket,
  type WorkRole,
  validateAgentResult,
  validateWorkItem,
} from '../schema';

export type PrAgentRunner = (packet: WorkPacket) => Promise<AgentResult | unknown>;

export interface PrReviewOptions {
  dryRun?: boolean;
  runAgent?: PrAgentRunner;
  github?: GitHubClient;
  ledgerRoot?: string;
  ciWaitTimeoutMs?: number;
  emitComment?: boolean;
  allowGithubWrites?: boolean;
  liveWriteToken?: string;
}

export interface PrReviewResult {
  status: Decision['status'];
  workItemId: string;
  workflow: 'pr-review';
  packets: WorkPacket[];
  agentResults: AgentResult[];
  findings: Finding[];
  policyResult: PolicyResult;
  decision: Decision;
  artifacts: WorkArtifact[];
  checkState: CheckState;
  commentsWritten: number;
  warnings: string[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function roleId(role: WorkRole): string {
  return role.id ?? `${role.engine}-${role.role}`;
}

function workflowStatus(decision: Decision): WorkItemStatus {
  if (decision.status === 'complete' || decision.status === 'fixed' || decision.status === 'merge-ready') return 'complete';
  if (decision.status === 'failed') return 'failed';
  return 'blocked';
}

function packetForRole(workItem: WorkItem, role: WorkRole, suffix: string, inputs: WorkInput[], artifacts: WorkArtifact[], findings?: Finding[]): WorkPacket {
  return {
    id: `${workItem.id}-${roleId(role)}-${suffix}`,
    workItemId: workItem.id,
    type: workItem.type,
    objective: workItem.objective,
    role,
    inputs,
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

function findingReportArtifact(workItem: WorkItem, findings: Finding[], idSuffix: string): WorkArtifact {
  return {
    id: `${workItem.id}-${idSuffix}`,
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

function decisionArtifact(workItem: WorkItem, policyResult: PolicyResult, agentResults: AgentResult[], checkState: CheckState): WorkArtifact {
  return {
    id: `${workItem.id}-decision`,
    type: 'decision',
    source: 'orchestrator',
    createdAt: nowIso(),
    content: JSON.stringify({ policyResult, checkState, agentSummaries: agentResults.map(({ status, summary }) => ({ status, summary })) }, null, 2),
    metadata: {
      status: policyResult.decision.status,
      allowed: policyResult.allowed,
      checkState,
      reasonCount: policyResult.reasons.length,
    },
  };
}

function finalReportArtifact(workItem: WorkItem, policyResult: PolicyResult, findings: Finding[]): WorkArtifact {
  return {
    id: `${workItem.id}-final-report`,
    type: 'finding-report',
    source: 'orchestrator',
    createdAt: nowIso(),
    content: JSON.stringify({ decision: policyResult.decision, findings }, null, 2),
    metadata: {
      status: policyResult.decision.status,
      findingCount: findings.length,
    },
  };
}

function checkStateArtifact(workItem: WorkItem, checkState: CheckState, timeoutMs: number | undefined): WorkArtifact {
  return {
    id: `${workItem.id}-ci-state`,
    type: 'test-log',
    source: 'github-fixture',
    createdAt: nowIso(),
    content: JSON.stringify({ checkState, timeoutMs, blocked: checkState !== 'green' }, null, 2),
    metadata: { checkState, timeoutMs },
  };
}

function prInputs(workItem: WorkItem, context: PullRequestContext): WorkInput[] {
  return [
    ...workItem.inputs,
    {
      id: 'fixture-pr-diff',
      type: 'git-diff',
      source: context.pullRequest.url,
      content: context.diff,
      metadata: {
        repo: context.pullRequest.repo,
        number: context.pullRequest.number,
        head: context.pullRequest.head,
        base: context.pullRequest.base,
        labels: context.pullRequest.labels,
        changedPaths: context.changedPaths,
      },
    },
    {
      id: 'fixture-pr-check-state',
      type: 'test-output',
      source: 'github-checks',
      content: `checkState=${context.checkState}`,
      metadata: { checkState: context.checkState },
    },
    ...(context.paiComment ? [{
      id: 'existing-pai-comment',
      type: 'markdown' as const,
      source: 'github-comment',
      content: JSON.stringify(context.paiComment, null, 2),
      metadata: { parsedPaiMarker: true },
    }] : []),
  ];
}

function fixtureAgentResult(status: AgentResult['status'], summary: string, packet: WorkPacket, findings?: Finding[]): AgentResult {
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
    findings,
  };
}

export async function fixturePrAgentRunner(packet: WorkPacket): Promise<AgentResult> {
  if (packet.role.role === 'reviewer') {
    return fixtureAgentResult('findings', 'Fixture reviewer found one high test issue.', packet, [{
      id: `${packet.id}-missing-test`,
      severity: 'high',
      category: 'test',
      location: { path: 'tests/example.test.ts', line: 1 },
      issue: 'The PR changes behavior without a regression test.',
      recommendation: 'Add a focused regression test before merge.',
      confidence: 'high',
      status: 'open',
    }]);
  }
  if (packet.role.role === 'fixer') {
    const fixedFindings = (packet.findings ?? []).map((finding) => ({
      ...finding,
      status: 'fixed' as const,
      recommendation: `${finding.recommendation} Fixture fix added.`,
    }));
    return fixtureAgentResult('fixed', `Fixture fixer addressed ${fixedFindings.length} finding(s).`, packet, fixedFindings);
  }
  return fixtureAgentResult('blocked', `Unsupported pr-review role: ${packet.role.role}`, packet);
}

function reconcileFindings(current: Finding[], updates: Finding[]): Finding[] {
  const byId = new Map(current.map((finding) => [finding.id, finding]));
  for (const update of updates) byId.set(update.id, update);
  return [...byId.values()];
}

function openBlockingFindings(findings: Finding[]): Finding[] {
  return findings.filter((finding) =>
    finding.status === 'open' && (finding.severity === 'blocker' || finding.severity === 'high')
  );
}

function blockedResult(workItem: WorkItem, reason: string, artifacts: WorkArtifact[] = [], warnings: string[] = []): PrReviewResult {
  const policyResult: PolicyResult = {
    allowed: false,
    decision: { status: 'blocked', reason, actions: ['fix-work-item'] },
    reasons: [reason],
    requiredActions: ['fix-work-item'],
  };
  return {
    status: 'blocked',
    workItemId: workItem.id,
    workflow: 'pr-review',
    packets: [],
    agentResults: [],
    findings: [],
    policyResult,
    decision: policyResult.decision,
    artifacts: [...artifacts, decisionArtifact(workItem, policyResult, [], 'unknown')],
    checkState: 'unknown',
    commentsWritten: 0,
    warnings,
  };
}

export async function runPrReview(workItem: WorkItem, options: PrReviewOptions = {}): Promise<PrReviewResult> {
  const validation = validateWorkItem(workItem);
  if (!validation.value) {
    return blockedResult(workItem, `Work item validation failed: ${validation.errors.join('; ')}`, [], validation.warnings);
  }
  if (validation.value.type !== 'pr-review') {
    return blockedResult(validation.value, `Unsupported workflow for pr-review runner: ${validation.value.type}`, [], validation.warnings);
  }

  const github = options.github ?? fixtureGitHubClient();
  const runner = options.runAgent ?? (options.dryRun ? fixturePrAgentRunner : undefined);
  if (!runner) {
    return blockedResult(validation.value, 'No agent runner configured; live pr-review execution is disabled by default.', [], validation.warnings);
  }

  const reviewer = validation.value.roles.find((role) => role.role === 'reviewer');
  const fixer = validation.value.roles.find((role) => role.role === 'fixer');
  if (!reviewer) return blockedResult(validation.value, 'PR review requires a reviewer role.', [], validation.warnings);
  if (!fixer) return blockedResult(validation.value, 'PR review requires a fixer role.', [], validation.warnings);

  const artifacts: WorkArtifact[] = [...validation.value.artifacts];
  const packets: WorkPacket[] = [];
  const agentResults: AgentResult[] = [];
  const malformedReasons: string[] = [];
  let commentsWritten = 0;

  const recordArtifact = (artifact: WorkArtifact): WorkArtifact => {
    const written = options.ledgerRoot ? writeArtifact(options.ledgerRoot, validation.value.id, artifact) : artifact;
    artifacts.push(written);
    return written;
  };

  let context: PullRequestContext;
  try {
    context = await github.getPullRequest(validation.value);
  } catch (error) {
    return blockedResult(validation.value, `Failed to load PR fixture context: ${error instanceof Error ? error.message : String(error)}`, artifacts, validation.warnings);
  }

  recordArtifact(checkStateArtifact(validation.value, context.checkState, options.ciWaitTimeoutMs));
  const inputs = prInputs(validation.value, context);
  const reviewPacket = packetForRole(validation.value, reviewer, 'review', inputs, artifacts);
  packets.push(reviewPacket);
  recordArtifact(packetArtifact(reviewPacket));

  let findings: Finding[] = [];
  try {
    const rawReviewResult = await runner(reviewPacket);
    const reviewResult = validateAgentResult(rawReviewResult);
    if (!reviewResult.value) {
      malformedReasons.push(`${reviewPacket.id}: ${reviewResult.errors.join('; ')}`);
      const errorResult = fixtureAgentResult('error', `Review result failed validation: ${reviewResult.errors.join('; ')}`, reviewPacket);
      agentResults.push(errorResult);
      errorResult.artifacts.forEach(recordArtifact);
    } else {
      agentResults.push(reviewResult.value);
      reviewResult.value.artifacts.forEach(recordArtifact);
      findings = reconcileFindings(findings, reviewResult.value.findings ?? []);
    }
  } catch (error) {
    const errorResult = fixtureAgentResult('error', `Review runner threw: ${error instanceof Error ? error.message : String(error)}`, reviewPacket);
    agentResults.push(errorResult);
    errorResult.artifacts.forEach(recordArtifact);
  }

  recordArtifact(findingReportArtifact(validation.value, findings, 'review-findings'));
  let policyResult = evaluatePolicy({
    policy: validation.value.policy,
    requestedAction: 'iterate',
    findings,
    checkState: context.checkState,
    changedPaths: context.changedPaths,
    malformedAgentOutput: malformedReasons.length > 0,
    agentResult: agentResults.find((result) => result.status === 'error' || result.status === 'blocked'),
  });

  const fixableFindings = openBlockingFindings(findings);
  if (fixableFindings.length > 0 && validation.value.policy.maxRounds > 1) {
    const fixPacket = packetForRole(validation.value, fixer, 'fix', inputs, artifacts, findings);
    packets.push(fixPacket);
    recordArtifact(packetArtifact(fixPacket));
    try {
      const rawFixResult = await runner(fixPacket);
      const fixResult = validateAgentResult(rawFixResult);
      if (!fixResult.value) {
        malformedReasons.push(`${fixPacket.id}: ${fixResult.errors.join('; ')}`);
        const errorResult = fixtureAgentResult('error', `Fix result failed validation: ${fixResult.errors.join('; ')}`, fixPacket);
        agentResults.push(errorResult);
        errorResult.artifacts.forEach(recordArtifact);
      } else {
        agentResults.push(fixResult.value);
        fixResult.value.artifacts.forEach(recordArtifact);
        findings = reconcileFindings(findings, fixResult.value.findings ?? []);
      }
    } catch (error) {
      const errorResult = fixtureAgentResult('error', `Fix runner threw: ${error instanceof Error ? error.message : String(error)}`, fixPacket);
      agentResults.push(errorResult);
      errorResult.artifacts.forEach(recordArtifact);
    }
    recordArtifact(findingReportArtifact(validation.value, findings, 'post-fix-findings'));
    policyResult = evaluatePolicy({
      policy: validation.value.policy,
      requestedAction: 'iterate',
      findings,
      checkState: context.checkState,
      changedPaths: context.changedPaths,
      malformedAgentOutput: malformedReasons.length > 0,
      agentResult: agentResults.find((result) => result.status === 'error' || result.status === 'blocked'),
    });
    if (policyResult.allowed) {
      policyResult = {
        ...policyResult,
        decision: {
          ...policyResult.decision,
          status: 'fixed',
          reason: 'Fix round completed and policy permits iterate.',
        },
      };
    }
  }

  if (options.emitComment) {
    const markdown = emitOrchestratorComment({
      workItemId: validation.value.id,
      source: context.pullRequest.url,
      findings,
      decision: policyResult.decision,
    });
    const commentArtifact: WorkArtifact = {
      id: `${validation.value.id}-pr-comment`,
      type: 'pr-comment',
      source: 'orchestrator',
      createdAt: nowIso(),
      content: markdown,
      metadata: { dryRun: options.dryRun === true },
    };
    recordArtifact(commentArtifact);
    try {
      await github.upsertComment(markdown, {
        allowLiveWrites: options.allowGithubWrites,
        liveWriteToken: options.liveWriteToken,
      });
      commentsWritten += 1;
    } catch (error) {
      policyResult = {
        allowed: false,
        decision: {
          status: 'blocked',
          reason: `GitHub comment write blocked: ${error instanceof Error ? error.message : String(error)}`,
          actions: ['rerun-with-explicit-live-write-approval'],
        },
        reasons: [...policyResult.reasons, 'GitHub comment write blocked.'],
        requiredActions: ['rerun-with-explicit-live-write-approval'],
      };
    }
  }

  const decision = recordArtifact(decisionArtifact(validation.value, policyResult, agentResults, context.checkState));
  const final = recordArtifact(finalReportArtifact(validation.value, policyResult, findings));
  const finalArtifacts = artifacts.includes(final) && artifacts.includes(decision) ? artifacts : [...artifacts, decision, final];
  const updatedWorkItem: WorkItem = {
    ...validation.value,
    artifacts: finalArtifacts,
    status: workflowStatus(policyResult.decision),
  };
  if (options.ledgerRoot) saveWorkItem(options.ledgerRoot, updatedWorkItem);

  return {
    status: policyResult.decision.status,
    workItemId: validation.value.id,
    workflow: 'pr-review',
    packets,
    agentResults,
    findings,
    policyResult,
    decision: policyResult.decision,
    artifacts: finalArtifacts,
    checkState: context.checkState,
    commentsWritten,
    warnings: [...validation.warnings, ...malformedReasons],
  };
}
