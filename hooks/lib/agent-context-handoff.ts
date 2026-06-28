export type AgentContextTier = 'none' | 'rules' | 'full';

export interface AgentToolInput {
  subagent_type?: string;
  description?: string;
  prompt?: string;
  model?: string;
  run_in_background?: boolean;
}

export interface AgentContextDecision {
  tier: AgentContextTier;
  reason: string;
  hasHandoff: boolean;
}

const HANDOFF_OPEN_RE = /<pai-agent-context-handoff\b/i;
const EXPLICIT_TIER_RE = /\bPAI_CONTEXT_TIER\s*:\s*(none|rules|full)\b/i;
const LEAN_AGENT_TYPES = new Set(['Explore', 'Plan']);
const FULL_AGENT_TYPES = new Set([
  'Architect',
  'Pentester',
  'Researcher',
  'TechnicalReviewer',
  'CodexResearcher',
  'ClaudeResearcher',
  'GeminiResearcher',
  'MistralResearcher',
  'DeepSeekResearcher',
  'GrokResearcher',
  'PerplexityResearcher',
  'ProductStrategist',
  'Algorithm',
]);
const FAST_MODELS = new Set(['haiku']);
const REACH_CONTEXT_RE = /\b(ADA|ambient domain|REGISTRY|CLAUDE\.local|CLAUDE\.md|memory|memcarry|checkpoint|Durable findings|roadmap|release|KAI|branch|commit|push|PR|pull request|repo rules|project rules|delegation reach|ada-capture)\b/i;

function explicitTier(prompt: string): AgentContextTier | null {
  const match = prompt.match(EXPLICIT_TIER_RE);
  return match ? match[1].toLowerCase() as AgentContextTier : null;
}

function scopeTiming(prompt: string): 'FAST' | 'STANDARD' | 'DEEP' | null {
  const match = prompt.match(/##\s*Scope[\s\S]*?Timing:\s*(FAST|STANDARD|DEEP)\b/i);
  return match ? match[1].toUpperCase() as 'FAST' | 'STANDARD' | 'DEEP' : null;
}

export function hasAgentContextHandoff(prompt = ''): boolean {
  return HANDOFF_OPEN_RE.test(prompt);
}

export function needsDelegationReachContext(input: AgentToolInput = {}): boolean {
  const agentType = input.subagent_type ?? '';
  if (!LEAN_AGENT_TYPES.has(agentType)) return false;
  const prompt = input.prompt ?? '';
  return REACH_CONTEXT_RE.test(prompt);
}

export function decideAgentContextHandoff(input: AgentToolInput = {}): AgentContextDecision {
  const prompt = input.prompt ?? '';
  const forced = explicitTier(prompt);
  if (forced) {
    return { tier: forced, reason: `explicit PAI_CONTEXT_TIER:${forced}`, hasHandoff: hasAgentContextHandoff(prompt) };
  }

  const timing = scopeTiming(prompt);
  const agentType = input.subagent_type ?? '';
  const model = input.model ?? '';

  if (needsDelegationReachContext(input)) {
    return { tier: 'rules', reason: `${agentType} needs narrow delegation-reach context`, hasHandoff: hasAgentContextHandoff(prompt) };
  }
  if (timing === 'FAST') {
    return { tier: 'none', reason: 'FAST scope', hasHandoff: hasAgentContextHandoff(prompt) };
  }
  if (LEAN_AGENT_TYPES.has(agentType)) {
    return { tier: 'none', reason: `${agentType} is a lean lookup agent`, hasHandoff: hasAgentContextHandoff(prompt) };
  }
  if (FAST_MODELS.has(model)) {
    return { tier: 'none', reason: `${model} is a fast-tier model`, hasHandoff: hasAgentContextHandoff(prompt) };
  }
  if (timing === 'DEEP' || FULL_AGENT_TYPES.has(agentType) || model === 'opus') {
    return { tier: 'full', reason: timing === 'DEEP' ? 'DEEP scope' : `${agentType || model} needs broad project context`, hasHandoff: hasAgentContextHandoff(prompt) };
  }

  return { tier: 'rules', reason: 'default for implementation/review delegation', hasHandoff: hasAgentContextHandoff(prompt) };
}

export function buildAgentContextHandoff(tier: Exclude<AgentContextTier, 'none'>): string {
  const shared = [
    'Follow current repo rules before acting: branch-only workflow, read before modifying, minimal scope, verify before reporting done.',
    'Do not mutate public KAI, remotes, PRs, or release artifacts unless the parent prompt includes explicit current-turn approval.',
    'Preserve user and memory content. Never delete, move, or rewrite memory based on format judgment.',
    'Subagents cannot persist durable memory. If you learn something the parent should save, return a section named "Durable findings for parent checkpoint:" with only the facts worth keeping.',
    'ADA pointer: if the task touches ambient domain activation or delegation reach, read docs/planning/ambient-domain-activation-design.md and docs/planning/ROADMAP-7.x.md before changing behavior.',
  ];

  const full = [
    'For broad design/research/security work, first inspect the relevant repo docs and nearby tests, then state assumptions and evidence in the result.',
    'When changing code, include the verification commands you ran and any residual risk the parent must decide on.',
  ];

  const lines = tier === 'full' ? [...shared, ...full] : shared;
  return `<pai-agent-context-handoff tier="${tier}">\n${lines.map(line => `- ${line}`).join('\n')}\n</pai-agent-context-handoff>`;
}

export function buildBackgroundDelegationEnvelope(): string {
  return [
    buildAgentContextHandoff('rules'),
    `<pai-background-delegation-boundary>`,
    `- Background/SDK sessions do not share parent conversation state. Include only task-relevant paths, constraints, approvals, and this handoff block.`,
    `- Do not include private conversation history, unrelated memories, credentials, tokens, or public-KAI-prohibited content.`,
    `- Coordinate through commits, PR comments, or explicit task/status files; do not assume synchronous return to the parent session.`,
    `</pai-background-delegation-boundary>`,
  ].join('\n');
}

export function missingAgentContextMessage(input: AgentToolInput = {}): string | null {
  const decision = decideAgentContextHandoff(input);
  if (decision.tier === 'none' || decision.hasHandoff) return null;

  const label = input.subagent_type || input.description || 'Agent';
  return [
    `<system-reminder>`,
    `Agent context handoff missing for ${label} (tier: ${decision.tier}; ${decision.reason}).`,
    `Add this block near the top of the Agent prompt so delegated work receives the critical project rules:`,
    buildAgentContextHandoff(decision.tier),
    `Use PAI_CONTEXT_TIER:none only for intentionally lean lookup agents.`,
    `</system-reminder>`,
  ].join('\n');
}

export function agentCallId(input: AgentToolInput = {}, sessionId = ''): string {
  const stable = [
    sessionId,
    input.subagent_type ?? '',
    input.description ?? '',
    (input.prompt ?? '').slice(0, 240),
  ].join('\u001f');

  let hash = 2166136261;
  for (let i = 0; i < stable.length; i++) {
    hash ^= stable.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `agent_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
