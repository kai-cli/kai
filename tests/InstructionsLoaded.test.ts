import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const HOOK = join(REPO, 'hooks', 'InstructionsLoaded.hook.ts');

describe('InstructionsLoaded hook', () => {
  test('emits instruction-load telemetry and never includes file contents', () => {
    const pai = mkdtempSync(join(tmpdir(), 'instructions-loaded-'));
    try {
      const result = spawnSync('bun', [HOOK], {
        input: JSON.stringify({
          hook_event_name: 'InstructionsLoaded',
          session_id: 's1',
          cwd: '/tmp/project-a',
          file_path: '/tmp/project-a/CLAUDE.md',
          reason: 'changed',
          memory_type: 'project',
          source: 'native',
        }),
        env: { ...process.env, PAI_DIR: pai },
        encoding: 'utf8',
      });
      expect(result.status).toBe(0);
      const telemetry = join(pai, 'MEMORY', 'STATE', 'memory-telemetry.jsonl');
      expect(existsSync(telemetry)).toBe(true);
      const event = JSON.parse(readFileSync(telemetry, 'utf8').trim());
      expect(event.type).toBe('instructions.loaded');
      expect(event.session_id).toBe('s1');
      expect(event.project).toBe('project-a');
      expect(event.file).toBe('CLAUDE.md');
      expect(event.reason).toBe('changed');
      expect(JSON.stringify(event)).not.toContain('secret');
    } finally {
      rmSync(pai, { recursive: true, force: true });
    }
  });
});
