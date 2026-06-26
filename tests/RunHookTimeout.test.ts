import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const RUN_HOOK_SOURCE = readFileSync(join(import.meta.dir, '../hooks/lib/run-hook.sh'), 'utf8');

describe('run-hook timeout defaults', () => {
  test('gives SessionEndComposite enough time to fan out substantial SessionEnd work', () => {
    expect(RUN_HOOK_SOURCE).toContain('SessionEndComposite)');
    expect(RUN_HOOK_SOURCE).toContain('SessionEndComposite)       DEFAULT_TIMEOUT=240');
  });
});
