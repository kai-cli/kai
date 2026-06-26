#!/usr/bin/env bun
/**
 * kai-temp-release-gate.ts — build and inspect a scrubbed temp KAI artifact.
 *
 * This gate is deliberately non-mutating for the developer's live KAI checkout:
 * it creates a fresh temporary KAI git repo, runs the real sync-to-kai.sh --apply
 * against that repo, then verifies the artifact contains no known private/runtime
 * surfaces. Dependency closure is delegated to sync-ci-gate.ts so public→private
 * import checks stay single-sourced.
 */

import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';

export const FORBIDDEN_ARTIFACT_PATHS = [
  'auto-memory',
  '.last-update-result.json',
  'devices.json',
  'scripts/pii-patterns.json',
  'scripts/pii-replacements.json',
  'scripts/sync-to-kai.sh',
  'scripts/verify-release.sh',
  'scripts/kai-release-audit.ts',
  'scripts/literal-replace.ts',
  'scripts/board-config.json',
  'MEMORY/STATE/ada-branch-guard-overrides.jsonl',
  'MEMORY/STAGING/.staging-state.json',
  'MEMORY/SECURITY/security.md',
  'projects',
  '.claude',
  'USER',
  'Plans',
  'teams',
];

function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env, timeout = 120000): string {
  return execFileSync(cmd, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
  });
}

function repoRoot(): string {
  return process.env.PAI_DIR || process.cwd();
}

function ensureFile(root: string, rel: string, body: string): void {
  const path = join(root, rel);
  mkdirSync(path.split('/').slice(0, -1).join('/'), { recursive: true });
  writeFileSync(path, body);
}

export function seedTempKaiRepo(kaiDir: string): void {
  const files: Record<string, string> = {
    'README.md': '# KAI\n',
    'CHANGELOG.md': '# Changelog\n',
    'CONTRIBUTING.md': '# Contributing\n',
    'LICENSE': 'MIT\n',
    'LICENSE-UPSTREAM': 'Upstream license placeholder\n',
    'get-kai.sh': '#!/usr/bin/env bash\n',
    '.github/workflows/test.yml': 'name: KAI CI\n',
    'config/domains.jsonc': '{}\n',
    'config/identity.jsonc.template': '{}\n',
    'config/user-hooks.jsonc.example': '{}\n',
    'docs/CUSTOMIZATION.md': '# Customization\n',
    'docs/WHATS-DIFFERENT.md': '# What is different\n',
    'docs/planning/deliberate-research-mode.md': '# Deliberate research mode\n',
    'PAI/CONTEXT_ROUTING.md': '# Context routing\n',
    'hooks/user/.gitkeep': '',
    'tests/ConfigLoader.test.ts': 'import { test } from "bun:test"; test("placeholder", () => {});\n',
    'tests/Installer.test.ts': 'import { test } from "bun:test"; test("placeholder", () => {});\n',
    'tests/OncePerSession.test.ts': 'import { test } from "bun:test"; test("placeholder", () => {});\n',
  };

  for (const dir of ['KNOWLEDGE', 'LEARNING', 'RELATIONSHIP', 'SECURITY', 'STAGING', 'STATE', 'WORK']) {
    files[`MEMORY/${dir}/.gitkeep`] = '';
  }

  for (const [rel, body] of Object.entries(files)) ensureFile(kaiDir, rel, body);

  run('git', ['init', '-b', 'main'], kaiDir);
  run('git', ['config', 'user.name', 'KAI Maintainer'], kaiDir);
  run('git', ['config', 'user.email', 'maintainer@kai-cli.com'], kaiDir);
  run('git', ['add', '-A'], kaiDir);
  run('git', ['commit', '-m', 'Seed temp KAI artifact repo'], kaiDir);
}

function walk(root: string, rel = ''): string[] {
  const full = join(root, rel);
  if (!existsSync(full)) return [];
  const st = statSync(full);
  if (!st.isDirectory()) return [rel];

  const out: string[] = [];
  for (const entry of readdirSync(full)) {
    if (entry === '.git' || entry === 'node_modules') continue;
    out.push(...walk(root, rel ? `${rel}/${entry}` : entry));
  }
  return out;
}

export function findForbiddenArtifactPaths(kaiDir: string, forbidden = FORBIDDEN_ARTIFACT_PATHS): string[] {
  const all = new Set(walk(kaiDir));
  const dirs = new Set<string>();
  for (const file of all) {
    const parts = file.split('/');
    for (let i = 1; i <= parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }

  return forbidden.filter(path => all.has(path) || dirs.has(path));
}

export function assertNoScrubSentinel(kaiDir: string): string[] {
  const sentinel = join(kaiDir, '.git', '.sync-scrub-in-progress');
  return existsSync(sentinel) ? ['.git/.sync-scrub-in-progress'] : [];
}

export function buildTempKaiArtifact(paiDir = repoRoot()): string {
  const tempRoot = mkdtempSync(join(tmpdir(), 'pai-kai-artifact-'));
  const kaiDir = join(tempRoot, 'kai');
  mkdirSync(kaiDir, { recursive: true });
  seedTempKaiRepo(kaiDir);

  run('bash', ['scripts/sync-to-kai.sh', '--apply'], paiDir, {
    ...process.env,
    PAI_DIR: paiDir,
    KAI_DIR: kaiDir,
    KAI_SYNC_SKIP_VERIFY: '1',
  }, 600000);

  return kaiDir;
}

export function runTempKaiReleaseGate(paiDir = repoRoot()): { kaiDir: string; failures: string[] } {
  const kaiDir = buildTempKaiArtifact(paiDir);
  const failures = [
    ...assertNoScrubSentinel(kaiDir),
    ...findForbiddenArtifactPaths(kaiDir),
  ];

  // Dependency closure / public→private import gate remains single-sourced.
  run('bun', ['scripts/sync-ci-gate.ts', '--warn-pii', '--strict'], paiDir, {
    ...process.env,
    PAI_DIR: paiDir,
    KAI_DIR: kaiDir,
  });

  return { kaiDir, failures };
}

if (import.meta.main) {
  console.log('\n=== Temp KAI Release Artifact Gate ===');
  const { kaiDir, failures } = runTempKaiReleaseGate();
  console.log(`Temp artifact: ${kaiDir}`);

  if (failures.length > 0) {
    console.error('\nForbidden private/runtime surfaces found in temp KAI artifact:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.log('✓ temp sync completed without mutating live KAI');
  console.log('✓ scrub sentinel cleared');
  console.log('✓ no forbidden private/runtime paths found');
  console.log('✓ dependency closure gate passed');
}
