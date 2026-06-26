import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';

const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

function checkIgnore(path: string) {
  return spawnSync('git', ['check-ignore', '--no-index', '-v', path], {
    cwd: REPO,
    encoding: 'utf8',
  });
}

describe('memcarry runtime ignore rules', () => {
  test('ignores project resume-state atoms but not durable global lessons', () => {
    const projectAtom = checkIgnore('MEMORY/memcarry/store/atoms/project/example/resume-state/res_example_main.md');
    expect(projectAtom.status).toBe(0);
    expect(projectAtom.stdout).toContain('MEMORY/memcarry/store/atoms/project/');

    const globalLesson = checkIgnore('MEMORY/memcarry/store/atoms/global/lesson/lsn_example.md');
    expect(globalLesson.status).toBe(1);
  });
});
