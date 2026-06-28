export type WorkItemType =
  | 'pr-review'
  | 'adversarial-review'
  | 'plan-validation'
  | 'roadmap-review'
  | 'idea-stress-test'
  | 'implementation'
  | 'release-readiness';

export type WorkItemStatus = 'queued' | 'running' | 'blocked' | 'complete' | 'failed';
export type WorkInputType = 'github-pr' | 'git-diff' | 'file' | 'markdown' | 'prompt' | 'test-output' | 'transcript';
export type WorkRoleName = 'reviewer' | 'red-team' | 'implementer' | 'fixer' | 'judge' | 'validator';
export type AgentCapability = 'plan' | 'review' | 'red-team' | 'implement' | 'judge' | 'validate';
export type AutonomyLevel = 'advise' | 'fix' | 'iterate' | 'merge';
export type ArtifactType = 'packet' | 'agent-result' | 'finding-report' | 'patch' | 'commit' | 'test-log' | 'decision' | 'pr-comment';
export type AgentResultStatus = 'pass' | 'findings' | 'fixed' | 'blocked' | 'error';
export type FindingSeverity = 'blocker' | 'high' | 'medium' | 'low' | 'note';
export type FindingCategory = 'bug' | 'test' | 'security' | 'privacy' | 'design' | 'docs' | 'process';
export type FindingConfidence = 'low' | 'medium' | 'high';
export type FindingStatus = 'open' | 'fixed' | 'wontfix' | 'needs-human';
export type DecisionStatus = 'complete' | 'fixed' | 'blocked' | 'failed' | 'merge-ready';

export interface WorkInput {
  id?: string;
  type: WorkInputType;
  source: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

export interface WorkRole {
  id?: string;
  role: WorkRoleName;
  engine: string;
  capabilities: AgentCapability[];
}

export interface WorkPolicy {
  autonomy: AutonomyLevel;
  maxRounds: number;
  allowedPaths: string[];
  blockedPaths: string[];
  requireGreenCI: boolean;
  allowPush: boolean;
  allowMerge: boolean;
  stopOnPrivateBoundaryRisk: boolean;
}

export interface WorkArtifact {
  id: string;
  type: ArtifactType;
  source: string;
  createdAt?: string;
  path?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

export interface Finding {
  id: string;
  severity: FindingSeverity;
  category: FindingCategory;
  location?: { path: string; line?: number };
  issue: string;
  recommendation: string;
  confidence: FindingConfidence;
  status: FindingStatus;
}

export interface AgentResult {
  status: AgentResultStatus;
  artifacts: WorkArtifact[];
  findings?: Finding[];
  summary: string;
}

export interface Decision {
  status: DecisionStatus;
  reason: string;
  actions?: string[];
  metadata?: Record<string, unknown>;
}

export interface PolicyResult {
  allowed: boolean;
  decision: Decision;
  reasons: string[];
  requiredActions?: string[];
}

export interface WorkItem {
  id: string;
  type: WorkItemType;
  objective: string;
  inputs: WorkInput[];
  roles: WorkRole[];
  policy: WorkPolicy;
  artifacts: WorkArtifact[];
  status: WorkItemStatus;
}

export interface WorkPacket {
  id: string;
  workItemId: string;
  type: WorkItemType;
  objective: string;
  role: WorkRole;
  inputs: WorkInput[];
  policy: WorkPolicy;
  artifacts: WorkArtifact[];
  findings?: Finding[];
}

export interface SchemaValidationResult<T> {
  valid: boolean;
  value?: T;
  errors: string[];
  warnings: string[];
}

const WORK_ITEM_TYPES: WorkItemType[] = [
  'pr-review',
  'adversarial-review',
  'plan-validation',
  'roadmap-review',
  'idea-stress-test',
  'implementation',
  'release-readiness',
];
const WORK_STATUSES: WorkItemStatus[] = ['queued', 'running', 'blocked', 'complete', 'failed'];
const INPUT_TYPES: WorkInputType[] = ['github-pr', 'git-diff', 'file', 'markdown', 'prompt', 'test-output', 'transcript'];
const ROLE_NAMES: WorkRoleName[] = ['reviewer', 'red-team', 'implementer', 'fixer', 'judge', 'validator'];
const CAPABILITIES: AgentCapability[] = ['plan', 'review', 'red-team', 'implement', 'judge', 'validate'];
const AUTONOMY_LEVELS: AutonomyLevel[] = ['advise', 'fix', 'iterate', 'merge'];
const ARTIFACT_TYPES: ArtifactType[] = ['packet', 'agent-result', 'finding-report', 'patch', 'commit', 'test-log', 'decision', 'pr-comment'];
const AGENT_STATUSES: AgentResultStatus[] = ['pass', 'findings', 'fixed', 'blocked', 'error'];
const DECISION_STATUSES: DecisionStatus[] = ['complete', 'fixed', 'blocked', 'failed', 'merge-ready'];
const FINDING_SEVERITIES: FindingSeverity[] = ['blocker', 'high', 'medium', 'low', 'note'];
const FINDING_CATEGORIES: FindingCategory[] = ['bug', 'test', 'security', 'privacy', 'design', 'docs', 'process'];
const FINDING_CONFIDENCES: FindingConfidence[] = ['low', 'medium', 'high'];
const FINDING_STATUSES: FindingStatus[] = ['open', 'fixed', 'wontfix', 'needs-human'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function error(errors: string[], path: string, message: string): void {
  errors.push(`${path}: ${message}`);
}

function validateInput(value: unknown, path: string, errors: string[]): value is WorkInput {
  if (!isObject(value)) {
    error(errors, path, 'must be an object');
    return false;
  }
  if (!enumValue(value.type, INPUT_TYPES)) error(errors, `${path}.type`, `must be one of ${INPUT_TYPES.join(', ')}`);
  if (!isString(value.source)) error(errors, `${path}.source`, 'must be a non-empty string');
  if (value.content !== undefined && typeof value.content !== 'string') error(errors, `${path}.content`, 'must be a string when present');
  if (value.metadata !== undefined && !isObject(value.metadata)) error(errors, `${path}.metadata`, 'must be an object when present');
  return true;
}

function validateRole(value: unknown, path: string, errors: string[]): value is WorkRole {
  if (!isObject(value)) {
    error(errors, path, 'must be an object');
    return false;
  }
  if (!enumValue(value.role, ROLE_NAMES)) error(errors, `${path}.role`, `must be one of ${ROLE_NAMES.join(', ')}`);
  if (!isString(value.engine)) error(errors, `${path}.engine`, 'must be a non-empty string');
  if (!Array.isArray(value.capabilities) || !value.capabilities.every((entry) => enumValue(entry, CAPABILITIES))) {
    error(errors, `${path}.capabilities`, `must be an array of ${CAPABILITIES.join(', ')}`);
  }
  return true;
}

export function conservativeDefaultPolicy(): WorkPolicy {
  return {
    autonomy: 'advise',
    maxRounds: 1,
    allowedPaths: ['**'],
    blockedPaths: ['docs/planning/**', 'specs/**', 'MEMORY/**', 'USER/**', 'Plans/**'],
    requireGreenCI: true,
    allowPush: false,
    allowMerge: false,
    stopOnPrivateBoundaryRisk: true,
  };
}

export function validatePolicy(value: unknown): SchemaValidationResult<WorkPolicy> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isObject(value)) {
    return { valid: false, errors: ['policy: must be an object'], warnings };
  }
  if (!enumValue(value.autonomy, AUTONOMY_LEVELS)) error(errors, 'policy.autonomy', `must be one of ${AUTONOMY_LEVELS.join(', ')}`);
  if (typeof value.maxRounds !== 'number' || !Number.isInteger(value.maxRounds) || value.maxRounds < 1) {
    error(errors, 'policy.maxRounds', 'must be a positive integer');
  }
  if (!isStringArray(value.allowedPaths)) error(errors, 'policy.allowedPaths', 'must be an array of strings');
  if (!isStringArray(value.blockedPaths)) error(errors, 'policy.blockedPaths', 'must be an array of strings');
  for (const key of ['requireGreenCI', 'allowPush', 'allowMerge', 'stopOnPrivateBoundaryRisk'] as const) {
    if (typeof value[key] !== 'boolean') error(errors, `policy.${key}`, 'must be a boolean');
  }
  if (value.autonomy === 'merge' && value.allowMerge !== true) {
    warnings.push('policy.autonomy is merge, but allowMerge is false; merge will remain blocked.');
  }
  if (value.allowMerge === true && value.requireGreenCI !== true) {
    warnings.push('allowMerge without requireGreenCI is unsafe; policy evaluation must still fail closed.');
  }
  if (value.stopOnPrivateBoundaryRisk !== true) {
    warnings.push('stopOnPrivateBoundaryRisk is false; default policy should keep it true.');
  }

  return { valid: errors.length === 0, value: errors.length === 0 ? value as WorkPolicy : undefined, errors, warnings };
}

export function validateArtifact(value: unknown, path = 'artifact'): SchemaValidationResult<WorkArtifact> {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObject(value)) return { valid: false, errors: [`${path}: must be an object`], warnings };
  if (!isString(value.id)) error(errors, `${path}.id`, 'must be a non-empty string');
  if (!enumValue(value.type, ARTIFACT_TYPES)) error(errors, `${path}.type`, `must be one of ${ARTIFACT_TYPES.join(', ')}`);
  if (!isString(value.source)) error(errors, `${path}.source`, 'must be a non-empty string');
  if (value.path !== undefined && typeof value.path !== 'string') error(errors, `${path}.path`, 'must be a string when present');
  if (value.content !== undefined && typeof value.content !== 'string') error(errors, `${path}.content`, 'must be a string when present');
  if (value.metadata !== undefined && !isObject(value.metadata)) error(errors, `${path}.metadata`, 'must be an object when present');
  return { valid: errors.length === 0, value: errors.length === 0 ? value as WorkArtifact : undefined, errors, warnings };
}

export function validateFinding(value: unknown, path = 'finding'): SchemaValidationResult<Finding> {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObject(value)) return { valid: false, errors: [`${path}: must be an object`], warnings };
  if (!isString(value.id)) error(errors, `${path}.id`, 'must be a non-empty string');
  if (!enumValue(value.severity, FINDING_SEVERITIES)) error(errors, `${path}.severity`, `must be one of ${FINDING_SEVERITIES.join(', ')}`);
  if (!enumValue(value.category, FINDING_CATEGORIES)) error(errors, `${path}.category`, `must be one of ${FINDING_CATEGORIES.join(', ')}`);
  if (!isString(value.issue)) error(errors, `${path}.issue`, 'must be a non-empty string');
  if (!isString(value.recommendation)) error(errors, `${path}.recommendation`, 'must be a non-empty string');
  if (!enumValue(value.confidence, FINDING_CONFIDENCES)) error(errors, `${path}.confidence`, `must be one of ${FINDING_CONFIDENCES.join(', ')}`);
  if (!enumValue(value.status, FINDING_STATUSES)) error(errors, `${path}.status`, `must be one of ${FINDING_STATUSES.join(', ')}`);
  if (value.location !== undefined) {
    if (!isObject(value.location)) {
      error(errors, `${path}.location`, 'must be an object when present');
    } else {
      if (!isString(value.location.path)) error(errors, `${path}.location.path`, 'must be a non-empty string');
      if (value.location.line !== undefined && (typeof value.location.line !== 'number' || value.location.line < 1)) {
        error(errors, `${path}.location.line`, 'must be a positive number when present');
      }
    }
  }
  return { valid: errors.length === 0, value: errors.length === 0 ? value as Finding : undefined, errors, warnings };
}

export function validateAgentResult(value: unknown): SchemaValidationResult<AgentResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObject(value)) return { valid: false, errors: ['agentResult: must be an object'], warnings };
  if (!enumValue(value.status, AGENT_STATUSES)) error(errors, 'agentResult.status', `must be one of ${AGENT_STATUSES.join(', ')}`);
  if (!isString(value.summary)) error(errors, 'agentResult.summary', 'must be a non-empty string');
  if (!Array.isArray(value.artifacts)) {
    error(errors, 'agentResult.artifacts', 'must be an array');
  } else {
    value.artifacts.forEach((artifact, index) => errors.push(...validateArtifact(artifact, `agentResult.artifacts[${index}]`).errors));
  }
  if (value.findings !== undefined) {
    if (!Array.isArray(value.findings)) {
      error(errors, 'agentResult.findings', 'must be an array when present');
    } else {
      value.findings.forEach((finding, index) => errors.push(...validateFinding(finding, `agentResult.findings[${index}]`).errors));
    }
  }
  return { valid: errors.length === 0, value: errors.length === 0 ? value as AgentResult : undefined, errors, warnings };
}

export function validateDecision(value: unknown, path = 'decision'): SchemaValidationResult<Decision> {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObject(value)) return { valid: false, errors: [`${path}: must be an object`], warnings };
  if (!enumValue(value.status, DECISION_STATUSES)) error(errors, `${path}.status`, `must be one of ${DECISION_STATUSES.join(', ')}`);
  if (!isString(value.reason)) error(errors, `${path}.reason`, 'must be a non-empty string');
  if (value.actions !== undefined && !isStringArray(value.actions)) error(errors, `${path}.actions`, 'must be an array of strings when present');
  if (value.metadata !== undefined && !isObject(value.metadata)) error(errors, `${path}.metadata`, 'must be an object when present');
  return { valid: errors.length === 0, value: errors.length === 0 ? value as Decision : undefined, errors, warnings };
}

export function validatePolicyResult(value: unknown): SchemaValidationResult<PolicyResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObject(value)) return { valid: false, errors: ['policyResult: must be an object'], warnings };
  if (typeof value.allowed !== 'boolean') error(errors, 'policyResult.allowed', 'must be a boolean');
  const decision = validateDecision(value.decision, 'policyResult.decision');
  errors.push(...decision.errors);
  warnings.push(...decision.warnings);
  if (!isStringArray(value.reasons)) error(errors, 'policyResult.reasons', 'must be an array of strings');
  if (value.requiredActions !== undefined && !isStringArray(value.requiredActions)) {
    error(errors, 'policyResult.requiredActions', 'must be an array of strings when present');
  }
  if (value.allowed === true && decision.value?.status === 'blocked') {
    warnings.push('policyResult allows a blocked decision; callers should treat this as fail-closed.');
  }
  return { valid: errors.length === 0, value: errors.length === 0 ? value as PolicyResult : undefined, errors, warnings };
}

export function validateWorkPacket(value: unknown): SchemaValidationResult<WorkPacket> {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObject(value)) return { valid: false, errors: ['workPacket: must be an object'], warnings };
  if (!isString(value.id)) error(errors, 'workPacket.id', 'must be a non-empty string');
  if (!isString(value.workItemId)) error(errors, 'workPacket.workItemId', 'must be a non-empty string');
  if (!enumValue(value.type, WORK_ITEM_TYPES)) error(errors, 'workPacket.type', `must be one of ${WORK_ITEM_TYPES.join(', ')}`);
  if (!isString(value.objective)) error(errors, 'workPacket.objective', 'must be a non-empty string');
  validateRole(value.role, 'workPacket.role', errors);
  if (!Array.isArray(value.inputs) || value.inputs.length === 0) {
    error(errors, 'workPacket.inputs', 'must be a non-empty array');
  } else {
    value.inputs.forEach((input, index) => validateInput(input, `workPacket.inputs[${index}]`, errors));
  }
  const policyResult = validatePolicy(value.policy);
  errors.push(...policyResult.errors);
  warnings.push(...policyResult.warnings);
  if (!Array.isArray(value.artifacts)) {
    error(errors, 'workPacket.artifacts', 'must be an array');
  } else {
    value.artifacts.forEach((artifact, index) => errors.push(...validateArtifact(artifact, `workPacket.artifacts[${index}]`).errors));
  }
  if (value.findings !== undefined) {
    if (!Array.isArray(value.findings)) {
      error(errors, 'workPacket.findings', 'must be an array when present');
    } else {
      value.findings.forEach((finding, index) => errors.push(...validateFinding(finding, `workPacket.findings[${index}]`).errors));
    }
  }
  return { valid: errors.length === 0, value: errors.length === 0 ? value as WorkPacket : undefined, errors, warnings };
}

export function validateWorkItem(value: unknown): SchemaValidationResult<WorkItem> {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObject(value)) return { valid: false, errors: ['workItem: must be an object'], warnings };
  if (!isString(value.id)) error(errors, 'workItem.id', 'must be a non-empty string');
  if (!enumValue(value.type, WORK_ITEM_TYPES)) error(errors, 'workItem.type', `must be one of ${WORK_ITEM_TYPES.join(', ')}`);
  if (!isString(value.objective)) error(errors, 'workItem.objective', 'must be a non-empty string');
  if (!Array.isArray(value.inputs) || value.inputs.length === 0) {
    error(errors, 'workItem.inputs', 'must be a non-empty array');
  } else {
    value.inputs.forEach((input, index) => validateInput(input, `workItem.inputs[${index}]`, errors));
  }
  if (!Array.isArray(value.roles) || value.roles.length === 0) {
    error(errors, 'workItem.roles', 'must be a non-empty array');
  } else {
    value.roles.forEach((role, index) => validateRole(role, `workItem.roles[${index}]`, errors));
  }
  const policyResult = validatePolicy(value.policy);
  errors.push(...policyResult.errors);
  warnings.push(...policyResult.warnings);
  if (!Array.isArray(value.artifacts)) {
    error(errors, 'workItem.artifacts', 'must be an array');
  } else {
    value.artifacts.forEach((artifact, index) => errors.push(...validateArtifact(artifact, `workItem.artifacts[${index}]`).errors));
  }
  if (!enumValue(value.status, WORK_STATUSES)) error(errors, 'workItem.status', `must be one of ${WORK_STATUSES.join(', ')}`);
  return { valid: errors.length === 0, value: errors.length === 0 ? value as WorkItem : undefined, errors, warnings };
}
