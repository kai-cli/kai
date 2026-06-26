#!/usr/bin/env bun
/**
 * ci-plan.ts — path-aware CI tier selector.
 *
 * This is intentionally conservative: it can over-run jobs, but it should not
 * under-run safety-relevant jobs. Repo Safety remains always-on in workflow YAML;
 * this script only decides the expensive/targeted tiers.
 */

import { appendFileSync } from 'fs';
import { execFileSync } from 'child_process';

export interface CiPlan {
  docs_only: boolean;
  run_docs_spec: boolean;
  run_tests: boolean;
  run_smoke: boolean;
  run_sync: boolean;
  reason: string;
  changed_files: string[];
}

function uniqueSorted(files: string[]): string[] {
  return [...new Set(files.filter(Boolean))].sort();
}

function runGit(args: string[], cwd = process.cwd()): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 10000,
  }).trim();
}

export function changedFilesFromGit(base?: string, head?: string, cwd = process.cwd()): string[] {
  const resolvedHead = head || process.env.GITHUB_SHA || 'HEAD';
  const resolvedBase = base
    || (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : undefined)
    || 'origin/main';

  try {
    const diff = runGit(['diff', '--name-only', `${resolvedBase}...${resolvedHead}`], cwd);
    return uniqueSorted(diff.split(/\r?\n/));
  } catch {
    try {
      const diff = runGit(['diff', '--name-only', `${resolvedBase}`, resolvedHead], cwd);
      return uniqueSorted(diff.split(/\r?\n/));
    } catch {
      return [];
    }
  }
}

function isDocsPath(path: string): boolean {
  return path.endsWith('.md')
    || path.startsWith('docs/')
    || path === 'CHANGELOG.md'
    || path === 'README.md';
}

function isGeneratedArtifactPath(path: string): boolean {
  return path === 'manifest.json'
    || path === 'skills-lock.json'
    || path.startsWith('docs/wiki/')
    || path.startsWith('wiki/');
}

function isWorkflowOrCiPath(path: string): boolean {
  return path.startsWith('.github/workflows/')
    || path === 'scripts/ci-plan.ts'
    || path === 'tests/CiPlan.test.ts';
}

function isHookConfigPath(path: string): boolean {
  return path.startsWith('hooks/')
    || path.startsWith('config/')
    || path === 'hooks.json'
    || path === 'settings.json'
    || path.startsWith('tests/Hook')
    || path.startsWith('tests/BuildSettings')
    || path.startsWith('tests/ReconcileWiring')
    || path === 'scripts/reconcile-wiring.ts';
}

function isSyncKaiPath(path: string): boolean {
  return path.startsWith('scripts/sync')
    || path === 'scripts/kai-temp-release-gate.ts'
    || path === 'scripts/literal-replace.ts'
    || path === 'scripts/repo-safety-ci.ts'
    || path === 'scripts/docs-spec-consistency.ts'
    || path === 'scripts/sync-manifest.json'
    || path.startsWith('tests/Sync')
    || path.startsWith('tests/LiteralReplace')
    || path.startsWith('tests/RepoSafety')
    || path.startsWith('tests/DocsSpecConsistency');
}

function isMemoryPath(path: string): boolean {
  return path.startsWith('hooks/Memory')
    || path.startsWith('hooks/Mem')
    || path.startsWith('hooks/lib/memory')
    || path.startsWith('hooks/lib/recall')
    || path.startsWith('scripts/memory')
    || path.startsWith('tests/Memory')
    || path.startsWith('tests/Mem')
    || path.startsWith('memcarry/');
}

function isBroadSourcePath(path: string): boolean {
  return path.startsWith('PAI/')
    || path.startsWith('agents/')
    || path.startsWith('skills/')
    || path.startsWith('scripts/')
    || path.startsWith('hooks/')
    || path.startsWith('tests/')
    || path.startsWith('memcarry/')
    || path === 'package.json'
    || path === 'bun.lock'
    || path === 'tsconfig.json';
}

export function planCi(files: string[], eventName = process.env.GITHUB_EVENT_NAME || 'pull_request'): CiPlan {
  const changed = uniqueSorted(files);

  if (eventName === 'push') {
    return {
      docs_only: false,
      run_docs_spec: true,
      run_tests: true,
      run_smoke: true,
      run_sync: true,
      reason: 'push event runs full CI',
      changed_files: changed,
    };
  }

  if (changed.length === 0) {
    return {
      docs_only: false,
      run_docs_spec: true,
      run_tests: true,
      run_smoke: true,
      run_sync: true,
      reason: 'no changed files detected; fail conservative',
      changed_files: changed,
    };
  }

  const docsOnly = changed.every(path => isDocsPath(path) && !isGeneratedArtifactPath(path));
  const workflowOrCi = changed.some(isWorkflowOrCiPath);
  const hookConfig = changed.some(isHookConfigPath);
  const syncKai = changed.some(isSyncKaiPath);
  const memory = changed.some(isMemoryPath);
  const broadSource = changed.some(path => isBroadSourcePath(path) && !isDocsPath(path));
  const generated = changed.some(isGeneratedArtifactPath);

  const runTests = !docsOnly || workflowOrCi || hookConfig || syncKai || memory || broadSource || generated;
  const runSmoke = workflowOrCi || hookConfig || broadSource || generated;
  const runSync = syncKai || workflowOrCi || generated;
  const runDocsSpec = docsOnly || workflowOrCi || changed.some(path => path.startsWith('docs/planning/')) || generated;

  const reasons: string[] = [];
  if (docsOnly) reasons.push('docs-only');
  if (workflowOrCi) reasons.push('workflow/ci');
  if (hookConfig) reasons.push('hook/config');
  if (syncKai) reasons.push('sync/kai');
  if (memory) reasons.push('memory');
  if (broadSource) reasons.push('broad-source');
  if (generated) reasons.push('generated-artifact');

  return {
    docs_only: docsOnly,
    run_docs_spec: runDocsSpec,
    run_tests: runTests,
    run_smoke: runSmoke,
    run_sync: runSync,
    reason: reasons.join(', ') || 'no tier matched',
    changed_files: changed,
  };
}

function bool(value: boolean): string {
  return value ? 'true' : 'false';
}

function writeGithubOutputs(plan: CiPlan): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;

  const lines = [
    `docs_only=${bool(plan.docs_only)}`,
    `run_docs_spec=${bool(plan.run_docs_spec)}`,
    `run_tests=${bool(plan.run_tests)}`,
    `run_smoke=${bool(plan.run_smoke)}`,
    `run_sync=${bool(plan.run_sync)}`,
    `reason=${plan.reason}`,
  ];

  appendFileSync(outputPath, `${lines.join('\n')}\n`);
}

if (import.meta.main) {
  const args = new Map<string, string>();
  for (let i = 2; i < Bun.argv.length; i++) {
    const arg = Bun.argv[i];
    if (arg.startsWith('--') && Bun.argv[i + 1] && !Bun.argv[i + 1].startsWith('--')) {
      args.set(arg.slice(2), Bun.argv[++i]);
    }
  }

  const filesArg = args.get('files');
  const files = filesArg
    ? uniqueSorted(filesArg.split(',').map(f => f.trim()))
    : changedFilesFromGit(args.get('base'), args.get('head'));
  const plan = planCi(files, args.get('event') || process.env.GITHUB_EVENT_NAME);

  console.log(JSON.stringify(plan, null, 2));
  writeGithubOutputs(plan);
}
