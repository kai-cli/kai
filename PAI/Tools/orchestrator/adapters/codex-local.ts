import { type CommandAdapterConfig } from './command';

export function codexLocalAdapterConfig(overrides: Partial<CommandAdapterConfig> = {}): CommandAdapterConfig {
  return {
    id: 'codex-local',
    engine: 'codex-local',
    command: process.env.PAI_ORCHESTRATOR_CODEX_COMMAND ?? 'codex',
    args: ['exec', '{{prompt}}'],
    timeoutMs: 600_000,
    requireStructuredOutput: true,
    supportedRoles: ['implementer', 'fixer', 'judge', 'validator'],
    supportedCapabilities: ['implement', 'judge', 'validate'],
    envAllowlist: ['HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'OPENAI_API_KEY'],
    ...overrides,
  };
}
