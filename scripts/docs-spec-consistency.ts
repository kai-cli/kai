#!/usr/bin/env bun
/**
 * docs-spec-consistency.ts — lightweight roadmap/spec drift gate.
 *
 * Offline by design: CI should not need GitHub API access to verify planning docs.
 * "Merged PR" is approximated by "the PR number appears in the checked-out main
 * history", which is the signal this repo can validate deterministically.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { execFileSync } from 'child_process';

export interface Finding {
  file: string;
  line?: number;
  message: string;
}

export interface ConsistencyResult {
  ok: boolean;
  findings: Finding[];
}

function repoRoot(): string {
  return process.env.PAI_DIR || process.cwd();
}

function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

function markdownFiles(dir: string, root = dir): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'Archive' || entry === '.archive') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...markdownFiles(full, root));
    else if (entry.endsWith('.md')) out.push(relative(root, full));
  }
  return out.sort();
}

export function mergedPrNumbersFromGit(root = repoRoot()): Set<number> {
  try {
    const log = execFileSync('git', ['log', '--format=%s'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });
    return prNumbersFromText(log);
  } catch {
    return new Set();
  }
}

export function prNumbersFromText(text: string): Set<number> {
  const prs = new Set<number>();
  for (const match of text.matchAll(/#(\d+)/g)) {
    prs.add(Number(match[1]));
  }
  return prs;
}

function isShippedPrReference(line: string): boolean {
  if (!/\bPR\s+#\d+/.test(line)) return false;
  if (/\b(pending|not merged|closed|close pr|poisoned|superseded)\b/i.test(line)) return false;
  return /\[x\]|✅|\b(shipped|merged|in main|implemented|done|complete|prevention)\b/i.test(line);
}

export function checkShippedPrReferences(
  files: Record<string, string>,
  mergedPrs: Set<number>,
): Finding[] {
  const findings: Finding[] = [];
  for (const [file, text] of Object.entries(files)) {
    text.split(/\r?\n/).forEach((line, idx) => {
      if (!isShippedPrReference(line)) return;
      for (const match of line.matchAll(/\bPR\s+#(\d+)/g)) {
        const pr = Number(match[1]);
        if (!mergedPrs.has(pr)) {
          findings.push({
            file,
            line: idx + 1,
            message: `shipped PR reference PR #${pr} is not present in main history`,
          });
        }
      }
    });
  }
  return findings;
}

const STALE_TASK_PATTERNS: RegExp[] = [
  /\bPostToolUse\s+`Task`(?:-matcher)?\b/i,
  /\bmatcher\s+`Task`\b/i,
  /\bTask-spawned subagents\b/i,
  /\bTask subagents\b/i,
];

function isAllowedTaskTerminology(line: string): boolean {
  return /\b(retired|legacy|historical|was wrong|old|archive|do not reintroduce)\b/i.test(line);
}

export function checkStaleTaskTerminology(files: Record<string, string>): Finding[] {
  const findings: Finding[] = [];
  for (const [file, text] of Object.entries(files)) {
    text.split(/\r?\n/).forEach((line, idx) => {
      if (isAllowedTaskTerminology(line)) return;
      if (STALE_TASK_PATTERNS.some(pattern => pattern.test(line))) {
        findings.push({
          file,
          line: idx + 1,
          message: 'stale Task terminology where native Agent is intended',
        });
      }
    });
  }
  return findings;
}

export function checkRoadmapVersionSequence(roadmap: string, file = 'ROADMAP-7.x.md'): Finding[] {
  const required = ['7.4.1', '7.4.2', '7.5.0', '7.5.1', '7.5.2'];
  const positions = required.map(version => ({
    version,
    index: roadmap.search(new RegExp(`^##\\s+${version.replace('.', '\\.')}`, 'm')),
  }));

  const findings: Finding[] = [];
  for (const pos of positions) {
    if (pos.index < 0) {
      findings.push({ file, message: `missing roadmap section ${pos.version}` });
    }
  }
  for (let i = 1; i < positions.length; i++) {
    if (positions[i - 1].index >= 0 && positions[i].index >= 0 && positions[i - 1].index > positions[i].index) {
      findings.push({
        file,
        message: `roadmap section ${positions[i - 1].version} appears after ${positions[i].version}`,
      });
    }
  }
  return findings;
}

export function checkGeneratedMarkersFresh(root = repoRoot()): Finding[] {
  try {
    execFileSync('bun', ['PAI/Tools/BuildDocs.ts', '--check'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
      env: { ...process.env, PAI_DIR: root },
    });
    return [];
  } catch (err: any) {
    const output = `${err?.stdout ?? ''}${err?.stderr ?? ''}`.trim();
    return [{
      file: 'generated-doc-markers',
      message: output || 'generated inventory/wiki marker freshness check failed',
    }];
  }
}

export function runDocsSpecConsistency(root = repoRoot()): ConsistencyResult {
  const planningDir = join(root, 'docs', 'planning');
  const files: Record<string, string> = {};
  for (const rel of markdownFiles(planningDir)) {
    files[`docs/planning/${rel}`] = readText(join(planningDir, rel));
  }

  const findings: Finding[] = [
    ...checkShippedPrReferences(files, mergedPrNumbersFromGit(root)),
    ...checkStaleTaskTerminology(files),
  ];

  const roadmapPath = join(root, 'docs', 'planning', 'ROADMAP-7.x.md');
  if (existsSync(roadmapPath)) {
    findings.push(...checkRoadmapVersionSequence(readText(roadmapPath), 'docs/planning/ROADMAP-7.x.md'));
  } else {
    findings.push({ file: 'docs/planning/ROADMAP-7.x.md', message: 'missing roadmap file' });
  }

  findings.push(...checkGeneratedMarkersFresh(root));

  return { ok: findings.length === 0, findings };
}

function printResult(result: ConsistencyResult): void {
  console.log('\n=== Docs/Spec Consistency Gate ===');
  if (result.ok) {
    console.log('✓ shipped PR references are present in main history');
    console.log('✓ no stale active Task terminology detected');
    console.log('✓ roadmap version sequencing is coherent');
    console.log('✓ generated inventory/wiki markers are fresh');
    console.log('\n✓ Docs/spec consistency gate passed');
    return;
  }

  for (const finding of result.findings) {
    const loc = finding.line ? `${finding.file}:${finding.line}` : finding.file;
    console.error(`✗ ${loc} — ${finding.message}`);
  }
  console.error('\n✗ Docs/spec consistency gate failed');
}

if (import.meta.main) {
  const result = runDocsSpecConsistency();
  printResult(result);
  process.exit(result.ok ? 0 : 1);
}
