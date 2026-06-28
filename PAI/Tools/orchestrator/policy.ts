import {
  type AgentResult,
  type Decision,
  type Finding,
  type PolicyResult,
  type WorkPolicy,
  validateAgentResult,
  validatePolicy,
} from './schema';
import { posix } from 'path';

export type CheckState = 'green' | 'red' | 'pending' | 'missing' | 'unknown';
export type RequestedAction = 'advise' | 'fix' | 'iterate' | 'push' | 'merge';

export interface PolicyEvaluationInput {
  policy: WorkPolicy;
  requestedAction: RequestedAction;
  changedPaths?: string[];
  findings?: Finding[];
  checkState?: CheckState;
  privateBoundaryRisk?: boolean;
  agentResult?: AgentResult | unknown;
  malformedAgentOutput?: boolean;
}

function block(reason: string, reasons: string[], requiredActions?: string[]): PolicyResult {
  const decision: Decision = { status: 'blocked', reason, actions: requiredActions };
  return { allowed: false, decision, reasons, requiredActions };
}

function pass(reason: string, reasons: string[]): PolicyResult {
  return {
    allowed: true,
    decision: { status: 'complete', reason },
    reasons,
  };
}

function globToRegExp(glob: string): RegExp {
  const globstar = '\u0000';
  const escaped = glob
    .replace(/\*\*/g, globstar)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped
    .replace(/\*/g, '[^/]*')
    .replaceAll(globstar, '.*');
  return new RegExp(`^${pattern}$`);
}

function normalizePolicyPath(path: string): string {
  return posix.normalize(path.replace(/\\/g, '/').replace(/^[ab]\//, '').replace(/^\/+/, ''));
}

function matchesAny(path: string, patterns: string[]): boolean {
  const normalized = normalizePolicyPath(path);
  return patterns.some((pattern) => pattern === '**' || globToRegExp(pattern).test(normalizePolicyPath(normalized)));
}

function openBlockingFindings(findings: Finding[]): Finding[] {
  return findings.filter((finding) =>
    finding.status === 'open' &&
    (finding.severity === 'blocker' || finding.severity === 'high')
  );
}

export function evaluatePolicy(input: PolicyEvaluationInput): PolicyResult {
  const reasons: string[] = [];
  const policyValidation = validatePolicy(input.policy);
  if (!policyValidation.value) {
    return block('Policy is invalid.', [`Policy validation failed: ${policyValidation.errors.join('; ')}`], ['fix-policy']);
  }
  const policy = policyValidation.value;
  reasons.push(...policyValidation.warnings);

  if (input.privateBoundaryRisk && policy.stopOnPrivateBoundaryRisk) {
    return block('Private/public boundary risk detected.', [...reasons, 'Private/public boundary risk detected.'], ['remove-private-boundary-risk']);
  }

  const changedPaths = (input.changedPaths ?? []).map(normalizePolicyPath);
  const blockedPath = changedPaths.find((path) => matchesAny(path, policy.blockedPaths));
  if (blockedPath) {
    return block(`Changed path is blocked by policy: ${blockedPath}`, [...reasons, `Blocked path changed: ${blockedPath}`], ['remove-blocked-path-change']);
  }

  const disallowedPath = changedPaths.find((path) => !matchesAny(path, policy.allowedPaths));
  if (disallowedPath) {
    return block(`Changed path is outside allowed paths: ${disallowedPath}`, [...reasons, `Path outside allowedPaths: ${disallowedPath}`], ['narrow-changes-to-allowed-paths']);
  }

  if (policy.requireGreenCI && input.checkState !== 'green') {
    return block(`CI is not green: ${input.checkState ?? 'missing'}`, [...reasons, `CI state is ${input.checkState ?? 'missing'}`], ['wait-for-green-ci']);
  }

  const findings = input.findings ?? [];
  const blockingFindings = openBlockingFindings(findings);
  if (blockingFindings.length > 0) {
    return block(
      `Open blocker/high findings remain: ${blockingFindings.map((finding) => finding.id).join(', ')}`,
      [...reasons, `Open blocker/high findings: ${blockingFindings.map((finding) => finding.id).join(', ')}`],
      ['fix-or-triage-blocking-findings'],
    );
  }

  if (input.malformedAgentOutput) {
    return block('Agent output is malformed.', [...reasons, 'Agent output is malformed.'], ['rerun-or-inspect-agent-output']);
  }
  if (input.agentResult !== undefined) {
    const result = validateAgentResult(input.agentResult);
    if (!result.value) {
      return block('Agent result failed schema validation.', [...reasons, `Agent result invalid: ${result.errors.join('; ')}`], ['fix-agent-output']);
    }
    if (result.value.status === 'error' || result.value.status === 'blocked') {
      return block(`Agent result is ${result.value.status}.`, [...reasons, `Agent result is ${result.value.status}.`], ['inspect-agent-result']);
    }
  }

  if (input.requestedAction === 'merge') {
    if (policy.autonomy !== 'merge') {
      return block('Merge requested but policy autonomy is not merge.', [...reasons, `Policy autonomy is ${policy.autonomy}.`], ['raise-autonomy-if-intended']);
    }
    if (!policy.allowMerge) {
      return block('Merge requested but allowMerge is false.', [...reasons, 'allowMerge is false.'], ['enable-allowMerge-if-intended']);
    }
    if (input.checkState !== 'green') {
      return block(
        `Merge requested but CI is not green: ${input.checkState ?? 'missing'}`,
        [...reasons, `Merge requires green CI; state is ${input.checkState ?? 'missing'}.`],
        ['wait-for-green-ci'],
      );
    }
    return {
      allowed: true,
      decision: { status: 'merge-ready', reason: 'Policy permits merge.' },
      reasons,
    };
  }

  if (input.requestedAction === 'push') {
    if (policy.autonomy === 'advise') {
      return block('Push requested but policy autonomy is advise.', [...reasons, 'Policy autonomy is advise.'], ['raise-autonomy-if-intended']);
    }
    if (!policy.allowPush) {
      return block('Push requested but allowPush is false.', [...reasons, 'allowPush is false.'], ['enable-allowPush-if-intended']);
    }
    if (input.checkState !== 'green') {
      return block(
        `Push requested but CI is not green: ${input.checkState ?? 'missing'}`,
        [...reasons, `Push requires green CI; state is ${input.checkState ?? 'missing'}.`],
        ['wait-for-green-ci'],
      );
    }
  }

  if ((input.requestedAction === 'fix' || input.requestedAction === 'iterate') && policy.autonomy === 'advise') {
    return block(`${input.requestedAction} requested but policy autonomy is advise.`, [...reasons, 'Policy autonomy is advise.'], ['raise-autonomy-if-intended']);
  }

  return pass(`Policy permits ${input.requestedAction}.`, reasons);
}
