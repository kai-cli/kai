import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { compareKaiArtifacts } from '../scripts/kai-artifact-fidelity';

function makePair() {
  const root = mkdtempSync(join(tmpdir(), 'kai-fidelity-'));
  const expected = join(root, 'expected');
  const actual = join(root, 'actual');
  mkdirSync(expected, { recursive: true });
  mkdirSync(actual, { recursive: true });
  return { expected, actual };
}

function write(root: string, rel: string, content: string) {
  const path = join(root, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

describe('kai-artifact-fidelity', () => {
  test('passes for identical artifact trees', () => {
    const { expected, actual } = makePair();
    write(expected, 'README.md', '# KAI\n');
    write(actual, 'README.md', '# KAI\n');

    expect(compareKaiArtifacts(expected, actual).ok).toBe(true);
  });

  test('reports files missing from live KAI', () => {
    const { expected, actual } = makePair();
    write(expected, 'PAI/Tools/BuildDocs.ts', 'export {};\n');

    const result = compareKaiArtifacts(expected, actual);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['PAI/Tools/BuildDocs.ts']);
  });

  test('reports live-only extra files', () => {
    const { expected, actual } = makePair();
    write(actual, 'unexpected.md', 'live drift\n');

    const result = compareKaiArtifacts(expected, actual);
    expect(result.ok).toBe(false);
    expect(result.extra).toEqual(['unexpected.md']);
  });

  test('reports changed content', () => {
    const { expected, actual } = makePair();
    write(expected, 'manifest.json', '{"version":"1"}\n');
    write(actual, 'manifest.json', '{"version":"2"}\n');

    const result = compareKaiArtifacts(expected, actual);
    expect(result.ok).toBe(false);
    expect(result.different).toEqual(['manifest.json']);
  });

  test('ignores git and runtime files excluded from sync', () => {
    const { expected, actual } = makePair();
    write(expected, 'README.md', '# KAI\n');
    write(actual, 'README.md', '# KAI\n');
    write(actual, '.git/config', '[core]\n');
    write(actual, 'settings.json.backup-2026', '{}\n');
    write(actual, '.env.test.local', 'TOKEN=x\n');

    expect(compareKaiArtifacts(expected, actual).ok).toBe(true);
  });

  test('ignores nested generated dependency directories', () => {
    const { expected, actual } = makePair();
    write(expected, 'memcarry/package.json', '{"name":"memcarry"}\n');
    write(actual, 'memcarry/package.json', '{"name":"memcarry"}\n');
    write(actual, 'memcarry/node_modules/.bin/tsc', 'generated\n');
    write(actual, 'skills/Browser/node_modules/bun-types/index.d.ts', 'generated\n');

    expect(compareKaiArtifacts(expected, actual).ok).toBe(true);
  });

  test('still reports real similarly named source files', () => {
    const { actual } = makePair();
    write(actual, 'docs/node_modules-note.md', 'not generated\n');

    const result = compareKaiArtifacts('', actual);
    expect(result.ok).toBe(false);
    expect(result.extra).toEqual(['docs/node_modules-note.md']);
  });
});
