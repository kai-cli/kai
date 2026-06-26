import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const HOOK = join(REPO, 'hooks', 'TurnTelemetry.hook.ts');

describe('TurnTelemetry hook', () => {
  test('emits metadata-only prompt heartbeat without prompt text', () => {
    const pai = mkdtempSync(join(tmpdir(), 'turn-telemetry-'));
    try {
      const result = spawnSync('bun', [HOOK], {
        input: JSON.stringify({
          hook_event_name: 'UserPromptSubmit',
          session_id: 's1',
          cwd: '/tmp/project-a',
          prompt: 'secret prompt body',
        }),
        env: { ...process.env, PAI_DIR: pai },
        encoding: 'utf8',
      });
      expect(result.status).toBe(0);
      const telemetry = join(pai, 'MEMORY', 'STATE', 'memory-telemetry.jsonl');
      expect(existsSync(telemetry)).toBe(true);
      const event = JSON.parse(readFileSync(telemetry, 'utf8').trim());
      expect(event.type).toBe('turn.prompt');
      expect(event.session_id).toBe('s1');
      expect(event.project).toBe('project-a');
      expect(event.prompt_chars).toBe(18);
      expect(JSON.stringify(event)).not.toContain('secret prompt body');
    } finally {
      rmSync(pai, { recursive: true, force: true });
    }
  });
});
