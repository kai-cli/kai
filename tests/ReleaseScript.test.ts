import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const repoRoot = join(import.meta.dir, '..');
const releaseScript = readFileSync(join(repoRoot, 'scripts', 'release.sh'), 'utf-8');

describe('release.sh', () => {
  test('runs the temp KAI artifact gate before creating a git tag', () => {
    const gateIndex = releaseScript.indexOf('scripts/kai-temp-release-gate.ts');
    const tagIndex = releaseScript.indexOf('git tag -a "$VERSION"');

    expect(gateIndex).toBeGreaterThan(-1);
    expect(tagIndex).toBeGreaterThan(-1);
    expect(gateIndex).toBeLessThan(tagIndex);
  });
});
