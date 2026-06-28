import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const MANIFEST_PATH = join(REPO, 'scripts/version-targets.json');
const SCRIPT_PATH = join(REPO, 'PAI/Tools/bump-version.ts');

type Manifest = {
  version: number;
  targets: Array<{ file: string; kind: string; category: string; optional?: boolean }>;
  discover?: Array<{ roots: string[]; extensions: string[]; kind: string; category: string }>;
};

const KNOWN_KINDS = new Set([
  'json-version',
  'settings-pai-version',
  'preferences-pai-algo',
  'install-major-minor',
  'banner-pai-algo-fallback',
  'buildclaude-default-algo',
  'buildclaude-default-pai',
  'h1-kai-version',
  'readme-algo-inline',
  'whats-different-title',
  'whats-different-deploying',
  'whats-different-table-version',
  'whats-different-algo-table',
  'spinner-tip-pai-algo',
  'loadcontext-init-version',
  'recovery-block-algo',
  'architecture-version-banner',
  'stable-release-banner',
]);

function readManifest(): Manifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as Manifest;
}

function walk(root: string, extensions: Set<string>, out: string[] = []): string[] {
  const abs = join(REPO, root);
  if (!existsSync(abs)) return out;
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const rel = `${root}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === '.archive' || entry.name === 'archive') continue;
      walk(rel, extensions, out);
    } else if (extensions.has(entry.name.slice(entry.name.lastIndexOf('.')))) {
      out.push(rel);
    }
  }
  return out;
}

describe('bump-version target manifest', () => {
  test('manifest exists and every target uses a known kind/category', () => {
    const manifest = readManifest();
    expect(manifest.version).toBe(1);
    for (const target of [...manifest.targets, ...(manifest.discover ?? [])]) {
      expect(KNOWN_KINDS.has(target.kind)).toBe(true);
      expect(['config', 'fallback', 'docs']).toContain(target.category);
    }
  });

  test('fixed targets have no duplicate file+kind entries and exist on disk', () => {
    const manifest = readManifest();
    const seen = new Set<string>();
    for (const target of manifest.targets) {
      const key = `${target.file}:${target.kind}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      if (!target.optional) {
        expect(existsSync(join(REPO, target.file))).toBe(true);
      }
    }
  });

  test('stable-release banners are covered by manifest discovery, not hardcoded file targets', () => {
    const manifest = readManifest();
    const stableDiscover = (manifest.discover ?? []).find((d) => d.kind === 'stable-release-banner');
    expect(stableDiscover).toBeDefined();

    const roots = stableDiscover!.roots;
    const extensions = new Set(stableDiscover!.extensions);
    const discovered = roots.flatMap((root) => walk(root, extensions));
    const bannerFiles = discovered.filter((file) =>
      /> \*\*KAI \d+\.\d+\.\d+\*\* . Stable release/.test(readFileSync(join(REPO, file), 'utf-8'))
    );

    expect(bannerFiles.length).toBeGreaterThan(0);
    for (const file of bannerFiles) {
      expect(roots.some((root) => file === root || file.startsWith(`${root}/`))).toBe(true);
    }
    expect(manifest.targets.some((t) => t.kind === 'stable-release-banner')).toBe(false);
  });

  test('implementation loads the manifest instead of owning a static target list', () => {
    if (!existsSync(SCRIPT_PATH)) return;
    const script = readFileSync(SCRIPT_PATH, 'utf-8');
    expect(script).toContain('scripts/version-targets.json');
    expect(script).toContain('discoverTargets');
    expect(script).not.toContain('const TARGETS:');
  });
});
