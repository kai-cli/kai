import {
  type Decision,
  type Finding,
  validateDecision,
  validateFinding,
} from './schema';

export const COMMENT_MARKER_START = '<!-- pai-orchestrator:v1:start -->';
export const COMMENT_MARKER_END = '<!-- pai-orchestrator:v1:end -->';

export interface OrchestratorCommentState {
  version: 1;
  workItemId: string;
  source: string;
  updatedAt: string;
  findings: Finding[];
  decision: Decision;
}

export interface CommentParseResult {
  found: boolean;
  state?: OrchestratorCommentState;
  errors: string[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeState(state: Omit<OrchestratorCommentState, 'version' | 'updatedAt'> & Partial<Pick<OrchestratorCommentState, 'updatedAt'>>): OrchestratorCommentState {
  return {
    version: 1,
    workItemId: state.workItemId,
    source: state.source,
    updatedAt: state.updatedAt ?? nowIso(),
    findings: state.findings,
    decision: state.decision,
  };
}

export function emitOrchestratorComment(state: Omit<OrchestratorCommentState, 'version' | 'updatedAt'> & Partial<Pick<OrchestratorCommentState, 'updatedAt'>>): string {
  const normalized = normalizeState(state);
  const blockerCount = normalized.findings.filter((finding) =>
    finding.status === 'open' && (finding.severity === 'blocker' || finding.severity === 'high')
  ).length;
  const summary = [
    '### PAI Orchestration Review',
    '',
    `Work item: \`${normalized.workItemId}\``,
    `Source: \`${normalized.source}\``,
    `Decision: \`${normalized.decision.status}\` - ${normalized.decision.reason}`,
    `Open blocker/high findings: ${blockerCount}`,
    '',
    COMMENT_MARKER_START,
    '```json',
    JSON.stringify(normalized, null, 2),
    '```',
    COMMENT_MARKER_END,
  ];
  return `${summary.join('\n')}\n`;
}

export function parseOrchestratorComment(markdown: string): CommentParseResult {
  const start = markdown.indexOf(COMMENT_MARKER_START);
  const end = markdown.indexOf(COMMENT_MARKER_END);
  if (start < 0 || end < 0 || end <= start) return { found: false, errors: [] };

  const block = markdown.slice(start + COMMENT_MARKER_START.length, end);
  const fence = block.match(/```json\s*([\s\S]*?)\s*```/);
  const jsonText = fence ? fence[1] : block.trim();
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const errors: string[] = [];
    if (parsed.version !== 1) errors.push('version: must be 1');
    if (typeof parsed.workItemId !== 'string' || parsed.workItemId.length === 0) errors.push('workItemId: must be a non-empty string');
    if (typeof parsed.source !== 'string' || parsed.source.length === 0) errors.push('source: must be a non-empty string');
    if (typeof parsed.updatedAt !== 'string' || parsed.updatedAt.length === 0) errors.push('updatedAt: must be a non-empty string');
    if (!Array.isArray(parsed.findings)) {
      errors.push('findings: must be an array');
    } else {
      parsed.findings.forEach((finding, index) => {
        errors.push(...validateFinding(finding, `findings[${index}]`).errors);
      });
    }
    const decision = validateDecision(parsed.decision, 'decision');
    errors.push(...decision.errors);
    if (errors.length > 0) return { found: true, errors };
    return { found: true, state: parsed as unknown as OrchestratorCommentState, errors: [] };
  } catch (error) {
    return { found: true, errors: [`Failed to parse orchestrator marker JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }
}
