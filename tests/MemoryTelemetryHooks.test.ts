import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { encodeProjectDir } from '../hooks/lib/paths';

const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const MEM_CAPTURE = join(REPO, 'hooks', 'MemCapture.hook.ts');
const MEM_RECALL = join(REPO, 'hooks', 'MemRecall.hook.ts');
const MEMORY_RECALL = join(REPO, 'hooks', 'MemoryRecall.hook.ts');
const TELEMETRY_REPORT = join(REPO, 'scripts', 'memory-telemetry-report.ts');

function runHook(script: string, payload: object, env: Record<string, string>) {
  return spawnSync('bun', [script], {
    input: JSON.stringify(payload),
    env: { ...process.env, ...env },
    encoding: 'utf-8',
  });
}

function telemetryEvents(paiDir: string): any[] {
  const path = join(paiDir, 'MEMORY', 'STATE', 'memory-telemetry.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe('memory telemetry hook emitters', () => {
  test('MemCapture emits capture.latency and memory.save when capture succeeds', () => {
    const root = mkdtempSync(join(tmpdir(), 'memcapture-telemetry-'));
    try {
      const paiDir = join(root, 'pai');
      const fakeCli = join(root, 'fake-memcarry-cli.ts');
      const transcript = join(root, 'transcript.jsonl');
      mkdirSync(paiDir, { recursive: true });
      writeFileSync(transcript, '{}\n');
      writeFileSync(fakeCli, 'console.log(JSON.stringify({ captured: true }));\n');

      const res = runHook(MEM_CAPTURE, {
        session_id: 's-capture',
        cwd: join(root, 'project-a'),
        transcript_path: transcript,
      }, {
        PAI_DIR: paiDir,
        MEMCARRY_CLI: fakeCli,
        CLAUDE_PROJECT_DIR: join(root, 'project-a'),
      });

      expect(res.status).toBe(0);
      const events = telemetryEvents(paiDir);
      expect(events.some(e => e.type === 'capture.latency' && e.project === 'project-a' && e.captured === true)).toBe(true);
      expect(events.some(e => e.type === 'memory.save' && e.project === 'project-a' && e.kind === 'resume-state')).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('MemRecall emits structured recall.latency on degraded no-store path', () => {
    const root = mkdtempSync(join(tmpdir(), 'memrecall-telemetry-'));
    try {
      const paiDir = join(root, 'pai');
      mkdirSync(paiDir, { recursive: true });

      const res = runHook(MEM_RECALL, {
        session_id: 's-recall',
        cwd: join(root, 'project-b'),
        prompt: 'patch quilt workflow',
      }, {
        PAI_DIR: paiDir,
        MEMCARRY_STORE: join(root, 'missing-store'),
        MEMCARRY_VEC_CACHE: join(root, 'missing-cache.json'),
        CLAUDE_PROJECT_DIR: join(root, 'project-b'),
      });

      expect(res.status).toBe(0);
      const events = telemetryEvents(paiDir);
      expect(events.some(e =>
        e.type === 'recall.latency'
        && e.project === 'project-b'
        && e.provider === 'MemRecall'
        && e.source === 'memcarry'
        && e.hits === 0
      )).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('MemoryRecall emits surfaced and end-to-end latency telemetry', () => {
    const root = mkdtempSync(join(tmpdir(), 'memoryrecall-telemetry-'));
    try {
      const paiDir = join(root, 'pai');
      const home = join(root, 'home');
      const projectDir = join(root, 'feed-bbf');
      const memDir = join(home, '.claude', 'projects', encodeProjectDir(projectDir), 'memory');
      mkdirSync(memDir, { recursive: true });
      mkdirSync(paiDir, { recursive: true });
      writeFileSync(join(memDir, 'MEMORY.md'), '- [Patch Workflow](patch-workflow.md) — quilt patch workflow branch validation\n');
      writeFileSync(join(memDir, 'patch-workflow.md'), '---\ncreated: 2026-06-24\n---\nUse quilt patch workflow validation before branch pushes.\n');

      const res = runHook(MEMORY_RECALL, {
        hook_event_name: 'UserPromptSubmit',
        session_id: 's-memory-recall',
        cwd: projectDir,
        prompt: 'validate the quilt patch workflow branch before pushing',
      }, {
        PAI_DIR: paiDir,
        HOME: home,
        CLAUDE_PROJECT_DIR: projectDir,
      });

      expect(res.status).toBe(0);
      expect(res.stdout).toContain('<memory-recall>');
      const events = telemetryEvents(paiDir);
      expect(events.some(e =>
        e.type === 'recall.surfaced'
        && e.provider === 'MemoryRecall'
        && e.source_type === 'project-memory'
        && e.count === 1
      )).toBe(true);
      expect(events.some(e =>
        e.type === 'recall.latency'
        && e.provider === 'MemoryRecall'
        && e.path === 'keyword'
        && e.hits === 1
        && e.degraded === false
      )).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('memory telemetry report exposes recall latency by provider', () => {
    const root = mkdtempSync(join(tmpdir(), 'memorytelemetry-report-'));
    try {
      const paiDir = join(root, 'pai');
      const stateDir = join(paiDir, 'MEMORY', 'STATE');
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, 'memory-telemetry.jsonl'), [
        JSON.stringify({ ts: '2026-06-24T00:00:00.000Z', type: 'recall.latency', project: 'rayhunter', provider: 'MemoryRecall', ms: 10 }),
        JSON.stringify({ ts: '2026-06-24T00:00:01.000Z', type: 'recall.latency', project: 'rayhunter', provider: 'MemoryRecall', ms: 30 }),
        JSON.stringify({ ts: '2026-06-24T00:00:02.000Z', type: 'recall.latency', project: 'kai', source: 'memcarry', ms: 20 }),
        JSON.stringify({ ts: '2026-06-24T00:00:03.000Z', type: 'memory.save', project: 'kai', path: 'MEMORY.md', kind: 'memory' }),
      ].join('\n') + '\n');

      const res = spawnSync('bun', [TELEMETRY_REPORT, '--json'], {
        env: { ...process.env, PAI_DIR: paiDir },
        encoding: 'utf-8',
      });

      expect(res.status).toBe(0);
      const report = JSON.parse(res.stdout);
      expect(report.recall_latency_by_provider.MemoryRecall.count).toBe(2);
      expect(report.recall_latency_by_provider.memcarry.count).toBe(1);
      expect(report.active_projects).toEqual(['kai', 'rayhunter']);
      expect(report.zero_save_projects).toEqual(['rayhunter']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('memory telemetry report exposes agent return size pressure', () => {
    const root = mkdtempSync(join(tmpdir(), 'memorytelemetry-agent-report-'));
    try {
      const paiDir = join(root, 'pai');
      const stateDir = join(paiDir, 'MEMORY', 'STATE');
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, 'memory-telemetry.jsonl'), [
        JSON.stringify({ ts: '2026-06-25T00:00:00.000Z', type: 'agent.spawn', project: 'Instant-Help', agent_call_id: 'a1', agent_type: 'general-purpose', description: 'Validate nav bugs', context_handoff_missing: true }),
        JSON.stringify({ ts: '2026-06-25T00:00:01.000Z', type: 'agent.spawn', project: 'Instant-Help', agent_call_id: 'a2', agent_type: 'general-purpose', description: 'Validate naming bugs' }),
        JSON.stringify({ ts: '2026-06-25T00:00:03.000Z', type: 'agent.return', project: 'Instant-Help', agent_call_id: 'a1', agent_type: 'general-purpose', description: 'Validate nav bugs', result_chars: 11070, return_status: 'ok' }),
        JSON.stringify({ ts: '2026-06-25T00:00:05.000Z', type: 'agent.return', project: 'Instant-Help', agent_call_id: 'a2', agent_type: 'general-purpose', description: 'Validate naming bugs', result_chars: 10480, return_status: 'failed' }),
        JSON.stringify({ ts: '2026-06-25T00:00:06.000Z', type: 'agent.checkpoint', project: 'Instant-Help', agent_call_id: 'a1', agent_type: 'general-purpose' }),
        JSON.stringify({ ts: '2026-06-25T00:00:07.000Z', type: 'agent.task_completed', project: 'Instant-Help', teammate_name: 'qa' }),
        JSON.stringify({ ts: '2026-06-25T00:00:08.000Z', type: 'agent.idle', project: 'Instant-Help', teammate_name: 'qa' }),
      ].join('\n') + '\n');

      const res = spawnSync('bun', [TELEMETRY_REPORT, '--json'], {
        env: { ...process.env, PAI_DIR: paiDir },
        encoding: 'utf-8',
      });

      expect(res.status).toBe(0);
      const report = JSON.parse(res.stdout);
      expect(report.agent_return.spawns).toBe(2);
      expect(report.agent_return.returns).toBe(2);
      expect(report.agent_return.checkpoints).toBe(1);
      expect(report.agent_return.task_completed).toBe(1);
      expect(report.agent_return.idle).toBe(1);
      expect(report.agent_return.returns_without_checkpoint_prompt).toBe(1);
      expect(report.agent_return.return_status.failed).toBe(1);
      expect(report.agent_return.missing_context_handoff).toBe(1);
      expect(report.agent_return.spawn_to_return_latency.count).toBe(2);
      expect(report.agent_return.spawn_to_return_latency.p50).toBe(4000);
      expect(report.agent_return.result_chars.total).toBe(21550);
      expect(report.agent_return.by_project['Instant-Help'].total_chars).toBe(21550);
      expect(report.agent_return.largest_returns[0].description).toBe('Validate nav bugs');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('memory telemetry report exposes prompt heartbeat coverage', () => {
    const root = mkdtempSync(join(tmpdir(), 'memorytelemetry-turn-report-'));
    const paiDir = join(root, 'pai');
    const stateDir = join(paiDir, 'MEMORY', 'STATE');
    mkdirSync(stateDir, { recursive: true });
    try {
      writeFileSync(join(stateDir, 'memory-telemetry.jsonl'), [
        JSON.stringify({ ts: '2026-06-25T00:00:00.000Z', type: 'turn.prompt', project: 'Instant_Help', session_id: 's1', prompt_chars: 42 }),
        JSON.stringify({ ts: '2026-06-25T00:01:00.000Z', type: 'turn.prompt', project: 'kai', session_id: 's2', prompt_chars: 12 }),
        JSON.stringify({ ts: '2026-06-25T00:02:00.000Z', type: 'turn.prompt', project: 'Instant_Help', session_id: 's1', prompt_chars: 7 }),
      ].join('\n') + '\n');
      const report = JSON.parse(execFileSync('bun', [TELEMETRY_REPORT, '--json'], {
        cwd: REPO,
        env: { ...process.env, PAI_DIR: paiDir },
        encoding: 'utf8',
      }));
      expect(report.turn_prompt.count).toBe(3);
      expect(report.turn_prompt.by_project.Instant_Help).toBe(2);
      expect(report.turn_prompt.by_project['kai']).toBe(1);
      expect(report.turn_prompt.last_ts).toBe('2026-06-25T00:02:00.000Z');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
