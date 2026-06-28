import { describe, expect, test } from 'bun:test';
import { loadSyncManifest, isExcluded } from '../scripts/sync-drift';

const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

describe('sync-drift manifest classification', () => {
  test('loads private and kai-only paths from sync-manifest.json', () => {
    const manifest = loadSyncManifest(REPO);

    expect(manifest.private).toContain('/CLAUDE.md');
    expect(manifest.private).toContain('scripts/pii-patterns.json');
    expect(manifest.kai_only).toContain('/README.md');
    expect(manifest.stale_kai_paths).toContain('tests/SyncToKaiStagingArtifact.test.ts');
  });

  test('matches root anchors, directories, and globs consistently', () => {
    expect(isExcluded('CLAUDE.md', ['/CLAUDE.md'])).toBe(true);
    expect(isExcluded('skills/Foo/CLAUDE.md', ['/CLAUDE.md'])).toBe(false);
    expect(isExcluded('Plans/next.md', ['Plans/'])).toBe(true);
    expect(isExcluded('MEMORY/STAGING/2026-06-26.json', ['MEMORY/STAGING/2026-*'])).toBe(true);
  });

  test('treats regex metacharacters literally in manifest paths', () => {
    expect(isExcluded('docs/v1.0.md', ['docs/v1.0.md'])).toBe(true);
    expect(isExcluded('docs/v1x0.md', ['docs/v1.0.md'])).toBe(false);
  });

  test('supports globstar patterns via the shared matcher', () => {
    expect(isExcluded('memcarry/packages/lib/src/w6.test.ts', ['memcarry/**/*.test.ts'])).toBe(true);
    expect(isExcluded('memcarry/packages/lib/src/w6.ts', ['memcarry/**/*.test.ts'])).toBe(false);
  });
});
