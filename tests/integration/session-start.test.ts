/**
 * Integration test: session-start LoadContext pipeline with Features A+B
 *
 * Tests that the full session-start pipeline produces valid output
 * with both features enabled and disabled.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { loadIndexMemory, initializeMeta } from '../../hooks/lib/memory-disclosure';
import { createInstinct, surfaceInstincts, formatInstinctContext, reinforceInstinct } from '../../hooks/lib/instinct-store';

const TMP = join('/tmp', 'test-session-start-' + Date.now());

function mkPaiDir(): string {
  const dir = join(TMP, Math.random().toString(36).slice(2));
  mkdirSync(join(dir, 'MEMORY', 'STATE'), { recursive: true });
  mkdirSync(join(dir, 'MEMORY', 'LEARNING', 'INSTINCTS'), { recursive: true });
  mkdirSync(join(dir, 'projects', '-Users-your.name-Projects-kai', 'memory'), { recursive: true });
  return dir;
}

afterEach(() => {
  try { rmSync(TMP, { recursive: true, force: true }); } catch { }
});

describe('Feature A integration: index memory loading', () => {
  it('loads ≤50 lines from MEMORY.md', () => {
    const paiDir = mkPaiDir();
    const memPath = join(paiDir, 'projects', '-Users-your.name-Projects-kai', 'memory', 'MEMORY.md');

    // Write 60 lines
    const lines = Array.from({ length: 60 }, (_, i) => `- [Topic${i}](topic_${i}.md) — description ${i}`);
    writeFileSync(memPath, lines.join('\n') + '\n');

    const result = loadIndexMemory(paiDir);
    const resultLines = result.split('\n').filter(l => l.trim());
    expect(resultLines.length).toBeLessThanOrEqual(50);
  });

  it('initializes meta from MEMORY.md on first run', () => {
    const paiDir = mkPaiDir();
    const memMd = `## Active References
- [Project](project.md) — active

## Feedback
- [Rule](rule.md) — a rule

## Notes
- [Note](note.md) — note
`;
    initializeMeta(paiDir, memMd);
    const { loadMeta } = require('../../hooks/lib/memory-disclosure');
    const meta = loadMeta(paiDir);
    expect(meta.length).toBe(3);
    expect(meta.find((e: any) => e.file === 'project.md')?.priority).toBe('P0');
    expect(meta.find((e: any) => e.file === 'rule.md')?.priority).toBe('P1');
    expect(meta.find((e: any) => e.file === 'note.md')?.priority).toBe('P2');
  });
});

describe('Feature B integration: instinct surfacing', () => {
  it('surfaces instincts above 0.5 threshold at session start', () => {
    const paiDir = mkPaiDir();
    const cwd = '/Users/user/Projects/kai/hooks/';

    // Create and reinforce one instinct above threshold
    const inst = createInstinct(paiDir, 'Always run bun test before reporting done', 'correction', 'ctx', cwd);
    reinforceInstinct(paiDir, inst.id); // 0.3 + 0.2 = 0.5

    const surfaced = surfaceInstincts(paiDir, cwd);
    expect(surfaced.length).toBe(1);

    const formatted = formatInstinctContext(surfaced);
    expect(formatted).toContain('Always run bun test');
    expect(formatted).toContain('## Behavioral Instincts');
  });

  it('does not surface instincts below 0.5 threshold', () => {
    const paiDir = mkPaiDir();
    createInstinct(paiDir, 'New instinct below threshold test case', 'correction', 'ctx');
    const surfaced = surfaceInstincts(paiDir, '/Users/user/Projects/kai/');
    expect(surfaced.length).toBe(0);
  });

  it('full pipeline: create → decay → surface produces valid context', () => {
    const paiDir = mkPaiDir();
    const cwd = '/Users/user/Projects/kai/';
    let inst = createInstinct(paiDir, 'Use descriptive test names in all test files', 'correction', 'ctx', cwd);
    inst = reinforceInstinct(paiDir, inst.id); // 0.5

    const surfaced = surfaceInstincts(paiDir, cwd);
    const context = formatInstinctContext(surfaced);

    // Context should be non-empty and under ~500 tokens (~2000 chars)
    expect(context.length).toBeGreaterThan(0);
    expect(context.length).toBeLessThan(2000);
  });
});
