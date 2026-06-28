import { type CommandAdapterConfig } from './command';

export function claudeLocalAdapterConfig(overrides: Partial<CommandAdapterConfig> = {}): CommandAdapterConfig {
  return {
    id: 'claude-local',
    engine: 'claude-local',
    command: process.env.PAI_ORCHESTRATOR_CLAUDE_COMMAND ?? 'claude',
    args: ['-p', '{{prompt}}', '--output-format', 'text'],
    timeoutMs: 600_000,
    requireStructuredOutput: true,
    supportedRoles: ['reviewer', 'red-team', 'judge', 'validator'],
    supportedCapabilities: ['review', 'red-team', 'judge', 'validate'],
    envAllowlist: ['HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'ANTHROPIC_API_KEY'],
    ...overrides,
  };
}
