/**
 * NativeEventMigration.test.ts — 7.4.0 §0 regression coverage.
 *
 * Guards the current Claude native-event migration:
 * - Agent hooks use the current Agent tool, not retired Task matchers.
 * - current event payload fields are consumed instead of legacy aliases.
 * - blocking feedback for non-tool events is emitted on stderr with exit 2.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'bun';
import { parseJSONC } from '../hooks/handlers/BuildSettings.ts';
import { readState, writeState } from '../hooks/lib/algorithm-state';
import {
  buildBackgroundDelegationEnvelope,
  buildAgentContextHandoff,
  decideAgentContextHandoff,
} from '../hooks/lib/agent-context-handoff';

const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const HOOKS = join(REPO, 'hooks');

async function runHook(hookFile: string, payload: object, env: Record<string, string> = {}) {
  const proc = spawn(['bun', 'run', join(HOOKS, hookFile)], {
    stdin: new TextEncoder().encode(JSON.stringify(payload)),
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      PAI_DIR: env.PAI_DIR ?? mkdtempSync(join(tmpdir(), 'pai-native-event-')),
      ...env,
    },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe('Agent tool migration', () => {
  test('permissions allow current Agent tool without retired Task compatibility', () => {
    const config = parseJSONC(readFileSync(join(REPO, 'config/permissions.jsonc'), 'utf-8')) as any;
    expect(config.permissions.allow).toContain('Agent');
    expect(config.permissions.allow).not.toContain('Task');
  });

  test('config wires AgentExecutionGuard and AgentMemoryCapture to Agent, not retired Task', () => {
    const config = parseJSONC(readFileSync(join(REPO, 'config/hooks.jsonc'), 'utf-8')) as any;
    const preToolMatchers = config.hooks.PreToolUse.map((entry: any) => entry.matcher);
    const postToolMatchers = config.hooks.PostToolUse.map((entry: any) => entry.matcher);

    const agentGuard = config.hooks.PreToolUse.find((entry: any) =>
      JSON.stringify(entry).includes('AgentExecutionGuard.hook.ts')
    );
    expect(agentGuard?.matcher).toBe('Agent');
    expect(preToolMatchers).not.toContain('Task');

    const memoryCapture = config.hooks.PostToolUse.find((entry: any) =>
      JSON.stringify(entry).includes('AgentMemoryCapture.hook.ts')
    );
    expect(memoryCapture?.matcher).toBe('Agent');
    expect(postToolMatchers).not.toContain('Task');
  });

  test('AgentExecutionGuard warns on current Agent payload without background flag', async () => {
    const result = await runHook('AgentExecutionGuard.hook.ts', {
      session_id: 's',
      hook_event_name: 'PreToolUse',
      tool_name: 'Agent',
      tool_input: { subagent_type: 'Engineer', description: 'implement migration' },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('FOREGROUND AGENT DETECTED');
    expect(result.stdout).toContain('Agent call');
  });

  test('Agent context handoff policy keeps fast Explore prompts lean', () => {
    const decision = decideAgentContextHandoff({
      subagent_type: 'Explore',
      model: 'haiku',
      prompt: 'Find where AgentExecutionGuard is wired.\n## Scope\nTiming: FAST',
    });

    expect(decision.tier).toBe('none');
    expect(decision.hasHandoff).toBe(false);
  });

  test('Agent context handoff policy gives Explore/Plan narrow context for reach-sensitive work', () => {
    expect(decideAgentContextHandoff({
      subagent_type: 'Explore',
      prompt: 'Find the ADA REGISTRY and roadmap files that define delegation reach.',
    }).tier).toBe('rules');

    expect(decideAgentContextHandoff({
      subagent_type: 'Explore',
      prompt: 'Find the ADA REGISTRY file.\n## Scope\nTiming: FAST',
    }).tier).toBe('rules');

    expect(decideAgentContextHandoff({
      subagent_type: 'Plan',
      prompt: 'Plan the KAI release checklist and branch guard changes.',
    }).tier).toBe('rules');

    expect(decideAgentContextHandoff({
      subagent_type: 'Plan',
      prompt: 'Sketch a simple refactor plan for parser.ts.',
    }).tier).toBe('none');
  });

  test('Agent context handoff policy selects rules/full tiers for delegated work', () => {
    expect(decideAgentContextHandoff({
      subagent_type: 'Engineer',
      prompt: 'Implement the context handoff MVP.',
    }).tier).toBe('rules');

    expect(decideAgentContextHandoff({
      subagent_type: 'Pentester',
      prompt: 'Review delegation safety.\n## Scope\nTiming: DEEP',
    }).tier).toBe('full');

    const block = buildAgentContextHandoff('rules');
    expect(block).toContain('<pai-agent-context-handoff tier="rules">');
    expect(block).toContain('branch-only workflow');
    expect(block).toContain('Durable findings for parent checkpoint:');
  });

  test('background delegation envelope carries privacy and coordination boundaries', () => {
    const envelope = buildBackgroundDelegationEnvelope();
    expect(envelope).toContain('<pai-agent-context-handoff tier="rules">');
    expect(envelope).toContain('<pai-background-delegation-boundary>');
    expect(envelope).toContain('Do not include private conversation history');
    expect(envelope).toContain('Coordinate through commits, PR comments, or explicit task/status files');
  });

  test('AgentExecutionGuard surfaces missing context handoff for implementation agents', async () => {
    const result = await runHook('AgentExecutionGuard.hook.ts', {
      session_id: 's',
      hook_event_name: 'PreToolUse',
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'Engineer',
        description: 'implement handoff',
        run_in_background: true,
        prompt: 'Implement the context handoff MVP.',
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Agent context handoff missing');
    expect(result.stdout).toContain('<pai-agent-context-handoff tier="rules">');
    expect(result.stdout).not.toContain('FOREGROUND AGENT DETECTED');
  });

  test('AgentMemoryCapture emits reminder on substantive current Agent return', async () => {
    const result = await runHook('AgentMemoryCapture.hook.ts', {
      session_id: 's',
      hook_event_name: 'PostToolUse',
      tool_name: 'Agent',
      cwd: REPO,
      tool_input: { subagent_type: 'Researcher', description: 'survey hooks' },
      tool_response: { result: 'x'.repeat(450) },
    });

    expect(result.exitCode).toBe(0);
    const out = JSON.parse(result.stdout);
    expect(out.additionalContext).toContain('Researcher subagent');
    expect(out.additionalContext).toContain('checkpoint it now');
  });

  test('AgentMemoryCapture emits reminder on explicit durable checkpoint marker', async () => {
    const result = await runHook('AgentMemoryCapture.hook.ts', {
      session_id: 's',
      hook_event_name: 'PostToolUse',
      tool_name: 'Agent',
      cwd: REPO,
      tool_input: { subagent_type: 'Engineer', description: 'small durable result' },
      tool_response: { result: 'Durable findings for parent checkpoint: repo fact X was verified.' },
    });

    expect(result.exitCode).toBe(0);
    const out = JSON.parse(result.stdout);
    expect(out.additionalContext).toContain('Engineer subagent');
    expect(out.additionalContext).toContain('Durable findings for parent checkpoint');
  });

  test('AgentMemoryCapture prompts on failed concise Agent return', async () => {
    const result = await runHook('AgentMemoryCapture.hook.ts', {
      session_id: 's',
      hook_event_name: 'PostToolUse',
      tool_name: 'Agent',
      cwd: REPO,
      tool_input: { subagent_type: 'Engineer', description: 'timed out task' },
      tool_response: { status: 'timeout', error: 'Agent timed out before finishing.' },
    });

    expect(result.exitCode).toBe(0);
    const out = JSON.parse(result.stdout);
    expect(out.additionalContext).toContain('returned failed output');
    expect(out.additionalContext).toContain('inspect the result');
  });

  test('AgentMemoryCapture stays quiet on concise non-durable successful return', async () => {
    const result = await runHook('AgentMemoryCapture.hook.ts', {
      session_id: 's',
      hook_event_name: 'PostToolUse',
      tool_name: 'Agent',
      cwd: REPO,
      tool_input: { subagent_type: 'Explore', description: 'quick lookup' },
      tool_response: { result: 'No matching file found.' },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });
});

describe('current native event fields', () => {
  test('TaskCompleted blocks ISC closure using task_subject/task_description fields', async () => {
    const result = await runHook('TaskCompleted.hook.ts', {
      session_id: 's',
      hook_event_name: 'TaskCompleted',
      task_id: 't1',
      task_subject: 'ISC-1 verify gate',
      task_description: 'done',
      teammate_name: 'qa',
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('ISC task "ISC-1 verify gate"');
    expect(result.stdout).toBe('');
  });

  test('TaskCompleted marks matching tracked agent completed using current teammate_name', async () => {
    const paiDir = mkdtempSync(join(tmpdir(), 'pai-task-completed-agent-'));
    const savedPaiDir = process.env.PAI_DIR;
    try {
      process.env.PAI_DIR = paiDir;
      writeState({
        active: true,
        sessionId: 's-agent-complete',
        taskDescription: 'agent lifecycle test',
        currentPhase: 'BUILD',
        phaseStartedAt: Date.now(),
        algorithmStartedAt: Date.now(),
        sla: 'Standard',
        criteria: [],
        agents: [{ name: 'qa', agentType: 'QATester', status: 'active' }],
        capabilities: ['Agent'],
        phaseHistory: [],
      } as any);

      const result = await runHook('TaskCompleted.hook.ts', {
        session_id: 's-agent-complete',
        hook_event_name: 'TaskCompleted',
        task_id: 't1',
        task_subject: 'non-ISC QA task',
        task_description: 'done',
        teammate_name: 'qa',
      }, { PAI_DIR: paiDir });

      expect(result.exitCode).toBe(0);
      expect(readState('s-agent-complete')?.agents[0].status).toBe('completed');
    } finally {
      if (savedPaiDir === undefined) delete process.env.PAI_DIR; else process.env.PAI_DIR = savedPaiDir;
      rmSync(paiDir, { recursive: true, force: true });
    }
  });

  test('legacy TaskCompleted subject field no longer triggers ISC logic', async () => {
    const result = await runHook('TaskCompleted.hook.ts', {
      session_id: 's',
      hook_event_name: 'TaskCompleted',
      task_id: 't1',
      subject: 'ISC-legacy',
      description: 'done',
      owner: 'qa',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });

  test('TeammateIdle accepts current payload without nonexistent last_message', async () => {
    const result = await runHook('TeammateIdle.hook.ts', {
      session_id: 's',
      hook_event_name: 'TeammateIdle',
      teammate_name: 'qa',
      team_name: 'review',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });

  test('TeammateIdle marks matching tracked agent idle without legacy last_message', async () => {
    const paiDir = mkdtempSync(join(tmpdir(), 'pai-teammate-idle-agent-'));
    const savedPaiDir = process.env.PAI_DIR;
    try {
      process.env.PAI_DIR = paiDir;
      writeState({
        active: true,
        sessionId: 's-agent-idle',
        taskDescription: 'agent lifecycle test',
        currentPhase: 'BUILD',
        phaseStartedAt: Date.now(),
        algorithmStartedAt: Date.now(),
        sla: 'Standard',
        criteria: [],
        agents: [{ name: 'qa', agentType: 'QATester', status: 'active' }],
        capabilities: ['Agent'],
        phaseHistory: [],
      } as any);

      const result = await runHook('TeammateIdle.hook.ts', {
        session_id: 's-agent-idle',
        hook_event_name: 'TeammateIdle',
        teammate_name: 'qa',
        team_name: 'review',
      }, { PAI_DIR: paiDir });

      expect(result.exitCode).toBe(0);
      expect(readState('s-agent-idle')?.agents[0].status).toBe('idle');
    } finally {
      if (savedPaiDir === undefined) delete process.env.PAI_DIR; else process.env.PAI_DIR = savedPaiDir;
      rmSync(paiDir, { recursive: true, force: true });
    }
  });

  test('TeammateIdle blocks unattributable payloads through stderr exit-2 feedback', async () => {
    const result = await runHook('TeammateIdle.hook.ts', {
      session_id: 's',
      hook_event_name: 'TeammateIdle',
      team_name: 'review',
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('missing teammate_name');
    expect(result.stdout).toBe('');
  });

  test('ConfigChange reads file_path and blocks critical hook removal via stderr exit 2', async () => {
    const paiDir = mkdtempSync(join(tmpdir(), 'kai-change-'));
    try {
      const settingsPath = join(paiDir, 'settings.json');
      mkdirSync(join(paiDir, 'MEMORY', 'STATE'), { recursive: true });
      writeFileSync(settingsPath, JSON.stringify({ hooks: { Stop: [] } }));

      const result = await runHook('ConfigChange.hook.ts', {
        session_id: 's',
        hook_event_name: 'ConfigChange',
        file_path: settingsPath,
        source: 'project',
      }, { PAI_DIR: paiDir });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('Critical hook "SecurityValidator"');
      expect(result.stdout).toBe('');
    } finally {
      rmSync(paiDir, { recursive: true, force: true });
    }
  });
});
