import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('SessionStart context diet', () => {
  test('keeps on-demand capability reference out of startup file list', () => {
    const prefs = readFileSync(join(import.meta.dir, '..', 'config', 'preferences.jsonc'), 'utf-8');
    const startupFiles = prefs.match(/"loadAtStartup"\s*:\s*\{\s*"files"\s*:\s*\[([\s\S]*?)\]/)?.[1] ?? '';

    expect(startupFiles).not.toContain('"CAPABILITIES.md"');
  });
});
