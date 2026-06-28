import { describe, expect, test } from 'bun:test';
import { codexLocalAdapterConfig } from '../PAI/Tools/orchestrator/adapters/codex-local';
import {
  describeCommandRun,
  runCommandAdapter,
  structuredPrompt,
  type CommandAdapterConfig,
} from '../PAI/Tools/orchestrator/adapters/command';
import { claudeLocalAdapterConfig } from '../PAI/Tools/orchestrator/adapters/claude-local';
import { type WorkPacket } from '../PAI/Tools/orchestrator/schema';

function packet(overrides: Partial<WorkPacket> = {}): WorkPacket {
  return {
    id: 'packet-1',
    workItemId: 'work-1',
    type: 'adversarial-review',
    objective: 'Review the fixture plan.',
    role: {
      id: 'reviewer-1',
      role: 'reviewer',
      engine: 'stub-engine',
      capabilities: ['review'],
    },
    inputs: [
      {
        id: 'input-1',
        type: 'markdown',
        source: 'fixture.md',
        content: '# Fixture',
      },
    ],
    policy: {
      autonomy: 'advise',
      maxRounds: 1,
      allowedPaths: ['**'],
      blockedPaths: ['MEMORY/**'],
      requireGreenCI: true,
      allowPush: false,
      allowMerge: false,
      stopOnPrivateBoundaryRisk: true,
    },
    artifacts: [],
    ...overrides,
  };
}

function stubConfig(code: string, overrides: Partial<CommandAdapterConfig> = {}): CommandAdapterConfig {
  return {
    id: 'stub',
    engine: 'stub-engine',
    command: process.execPath,
    args: ['-e', code],
    timeoutMs: 2_000,
    requireStructuredOutput: true,
    envAllowlist: ['PATH'],
    supportedRoles: ['reviewer', 'validator'],
    supportedCapabilities: ['review', 'validate'],
    ...overrides,
  };
}

describe('orchestrator command adapters', () => {
  test('runs a stub command and parses structured AgentResult output', async () => {
    const code = `
      let input = '';
      process.stdin.on('data', chunk => input += chunk);
      process.stdin.on('end', () => {
        const packet = JSON.parse(input);
        console.log(JSON.stringify({
          status: 'findings',
          summary: 'reviewed ' + packet.id,
          artifacts: [],
          findings: [{
            id: 'finding-1',
            severity: 'medium',
            category: 'design',
            issue: 'Fixture issue',
            recommendation: 'Tighten the plan',
            confidence: 'high',
            status: 'open'
          }]
        }));
      });
    `;

    const result = await runCommandAdapter(packet(), stubConfig(code));
    expect(result.status).toBe('findings');
    expect(result.summary).toBe('reviewed packet-1');
    expect(result.findings?.[0].id).toBe('finding-1');
    expect(result.artifacts.at(-1)?.metadata?.exitCode).toBe(0);
  });

  test('returns error artifacts for malformed structured output instead of throwing', async () => {
    const result = await runCommandAdapter(packet(), stubConfig("console.log('not json')"));
    expect(result.status).toBe('error');
    expect(result.summary).toContain('not valid JSON');
    expect(result.artifacts[0].content).toContain('not json');
  });

  test('returns error artifacts for nonzero exit codes', async () => {
    const result = await runCommandAdapter(packet(), stubConfig("console.error('boom'); process.exit(7)"));
    expect(result.status).toBe('error');
    expect(result.summary).toContain('code 7');
    expect(result.artifacts[0].metadata?.stderr).toContain('boom');
  });

  test('returns blocked artifacts on timeout', async () => {
    const result = await runCommandAdapter(packet(), stubConfig('setTimeout(() => {}, 500)', { timeoutMs: 25 }));
    expect(result.status).toBe('blocked');
    expect(result.summary).toContain('timed out');
    expect(result.artifacts[0].metadata?.timedOut).toBe(true);
  });

  test('escalates timed-out commands that ignore SIGTERM', async () => {
    const startedAt = Date.now();
    const result = await runCommandAdapter(
      packet(),
      stubConfig("process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)", {
        timeoutMs: 30,
        killGraceMs: 30,
      }),
    );
    const elapsedMs = Date.now() - startedAt;

    expect(result.status).toBe('blocked');
    expect(result.summary).toContain('timed out');
    expect(result.artifacts[0].metadata?.timedOut).toBe(true);
    expect(result.artifacts[0].metadata?.killGraceMs).toBe(30);
    expect(elapsedMs).toBeLessThan(1_000);
  });

  test('bounds buffered command output and blocks on overflow', async () => {
    const result = await runCommandAdapter(
      packet(),
      stubConfig("process.stdout.write('x'.repeat(2048)); setTimeout(() => {}, 500)", {
        maxOutputBytes: 128,
        timeoutMs: 1_000,
        killGraceMs: 30,
      }),
    );

    expect(result.status).toBe('blocked');
    expect(result.summary).toContain('exceeded max output');
    expect(result.artifacts[0].content.length).toBeLessThanOrEqual(128);
    expect(result.artifacts[0].metadata?.outputExceeded).toBe(true);
    expect(result.artifacts[0].metadata?.maxOutputBytes).toBe(128);
  });

  test('does not expose unallowlisted environment variables to commands', async () => {
    const previous = process.env.PAI_ORCHESTRATOR_SECRET_TEST;
    process.env.PAI_ORCHESTRATOR_SECRET_TEST = 'must-not-leak';
    try {
      const code = `
        console.log(JSON.stringify({
          status: process.env.PAI_ORCHESTRATOR_SECRET_TEST ? 'error' : 'pass',
          summary: process.env.PAI_ORCHESTRATOR_SECRET_TEST ? 'secret visible' : 'secret hidden',
          artifacts: []
        }));
      `;
      const result = await runCommandAdapter(packet(), stubConfig(code, { envAllowlist: ['PATH'] }));
      expect(result.status).toBe('pass');
      expect(result.summary).toBe('secret hidden');
    } finally {
      if (previous === undefined) {
        delete process.env.PAI_ORCHESTRATOR_SECRET_TEST;
      } else {
        process.env.PAI_ORCHESTRATOR_SECRET_TEST = previous;
      }
    }
  });

  test('blocks unsupported roles before spawning a command', async () => {
    const result = await runCommandAdapter(
      packet({
        role: {
          role: 'fixer',
          engine: 'stub-engine',
          capabilities: ['implement'],
        },
      }),
      stubConfig('throw new Error("should not spawn")'),
    );
    expect(result.status).toBe('blocked');
    expect(result.summary).toContain('Role fixer is not supported');
  });

  test('renders structured prompts and command descriptions deterministically', () => {
    const workPacket = packet();
    const config = stubConfig('console.log(process.argv[1])', { args: ['{{packet.id}}', '{{packet.role.role}}', '{{prompt}}'] });
    const run = describeCommandRun(workPacket, config);
    expect(run.args[0]).toBe('packet-1');
    expect(run.args[1]).toBe('reviewer');
    expect(run.args[2]).toContain('Return ONLY JSON');
    expect(run.envKeys).toEqual(['PATH']);
    expect(structuredPrompt(workPacket)).toContain('"workItemId": "work-1"');
  });

  test('claude-local config supports review, red-team, judge, and validator roles with structured output', () => {
    const config = claudeLocalAdapterConfig({ command: process.execPath });
    expect(config.engine).toBe('claude-local');
    expect(config.requireStructuredOutput).toBe(true);
    expect(config.supportedRoles).toEqual(['reviewer', 'red-team', 'judge', 'validator']);
    expect(config.supportedCapabilities).toEqual(['review', 'red-team', 'judge', 'validate']);
  });

  test('codex-local config supports implementation, fix, judge, and validation roles with structured output', () => {
    const config = codexLocalAdapterConfig({ command: process.execPath });
    expect(config.engine).toBe('codex-local');
    expect(config.requireStructuredOutput).toBe(true);
    expect(config.supportedRoles).toEqual(['implementer', 'fixer', 'judge', 'validator']);
    expect(config.supportedCapabilities).toEqual(['implement', 'judge', 'validate']);
  });
});
