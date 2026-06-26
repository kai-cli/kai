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
