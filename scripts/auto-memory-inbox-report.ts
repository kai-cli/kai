#!/usr/bin/env bun
/**
 * auto-memory-inbox-report.ts - read-only native Auto Memory inbox triage.
 *
 * Native Claude auto-memory files are capture inbox artifacts, not durable PAI
 * memory. This report classifies them into review lanes so promotion remains
 * human-confirmed and routed to the right durable store.
 *
 * Usage:
 *   bun scripts/auto-memory-inbox-report.ts
 *   bun scripts/auto-memory-inbox-report.ts --path ~/.pai-runtime/auto-memory --json
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { basename, join } from 'path';
import { homedir } from 'os';

export type AutoMemoryClassification =
  | 'project-fact'
  | 'global-lesson'
  | 'session-note'
  | 'unclassified';

export interface PromotionSuggestion {
  route: 'project-memory' | 'memcarry-lesson' | 'leave-in-inbox' | 'manual-review';
  target?: string;
  note: string;
  requires_confirmation: true;
}

export interface AutoMemoryEntry {
  file: string;
  chars: number;
  mtime: string;
  classification: AutoMemoryClassification;
  confidence: 'high' | 'medium' | 'low';
  project?: string;
  signals: string[];
  suggestion: PromotionSuggestion;
}

export interface AutoMemoryInboxReport {
  path: string;
  total_files: number;
  counts: Record<AutoMemoryClassification, number>;
  entries: AutoMemoryEntry[];
}

function usage(): never {
  console.error('Usage: bun scripts/auto-memory-inbox-report.ts [--path <dir>] [--json]');
  process.exit(1);
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function expandPath(value: string): string {
  return value
    .replace(/^\~(?=\/|$)/, homedir())
    .replace(/\$\{HOME\}/g, homedir())
    .replace(/\$HOME\b/g, homedir())
    .replace(/\$\{PAI_DIR\}/g, process.env.PAI_DIR ?? join(homedir(), '.claude'));
}

function stripJsonComments(input: string): string {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function loadConfiguredAutoMemoryDirectory(): string | undefined {
  const paiDir = process.env.PAI_DIR ?? join(homedir(), '.claude');
  const candidates = [
    join(paiDir, 'config', 'preferences.local.jsonc'),
    join(paiDir, 'config', 'preferences.jsonc'),
  ];

  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      const parsed = JSON.parse(stripJsonComments(readFileSync(file, 'utf-8')));
      if (typeof parsed.autoMemoryDirectory === 'string' && parsed.autoMemoryDirectory.trim()) {
        return expandPath(parsed.autoMemoryDirectory.trim());
      }
    } catch {
      // Ignore malformed local config; fall through to default.
    }
  }
  return undefined;
}

export function resolveAutoMemoryInboxPath(explicitPath?: string): string {
  if (explicitPath) return expandPath(explicitPath);
  return loadConfiguredAutoMemoryDirectory() ?? join(homedir(), '.pai-runtime', 'auto-memory');
}

function projectFromContent(content: string): string | undefined {
  const frontmatter = content.match(/(?:^|\n)(?:project|repo):\s*([A-Za-z0-9._/-]+)/i)?.[1];
  if (frontmatter) return basename(frontmatter.replace(/\/$/, '')).replace(/[.,;:]+$/, '');
  const pathMatch = content.match(/\/Users\/[^/\s)]+\/Projects\/([A-Za-z0-9._-]+)/);
  if (pathMatch) return pathMatch[1].replace(/[.,;:]+$/, '');
  return undefined;
}

function hasLessonShape(content: string): boolean {
  const normalized = content.toLowerCase();
  return /\bwhen\b[\s\S]{0,600}\bdo\b[\s\S]{0,600}\bbecause\b/.test(normalized)
    || /\blesson\b/.test(normalized) && /\bbecause\b/.test(normalized);
}

function hasProjectFactShape(content: string): boolean {
  return /\b(project|repo|branch|pr|pull request|build|deploy|firmware|config|test|ci)\b/i.test(content);
}

function hasSessionNoteShape(content: string): boolean {
  return /\b(this session|today|temporary|scratch|todo|follow[- ]?up|next session|need to remember while working)\b/i.test(content)
    || content.trim().length < 240;
}

function suggestionFor(classification: AutoMemoryClassification, project?: string): PromotionSuggestion {
  if (classification === 'project-fact') {
    return {
      route: 'project-memory',
      target: project ? `projects/${project}/memory/` : 'project memory',
      note: 'Review the fact and add it to the owning project memory only if it remains durable.',
      requires_confirmation: true,
    };
  }
  if (classification === 'global-lesson') {
    return {
      route: 'memcarry-lesson',
      target: 'MEMORY/memcarry/store',
      note: 'Draft a memcarry capture-lesson preview and apply only after explicit confirmation.',
      requires_confirmation: true,
    };
  }
  if (classification === 'session-note') {
    return {
      route: 'leave-in-inbox',
      note: 'Leave unpromoted or expire after review; do not copy into durable memory by default.',
      requires_confirmation: true,
    };
  }
  return {
    route: 'manual-review',
    note: 'Insufficient routing signal; review manually before any durable write.',
    requires_confirmation: true,
  };
}

export function classifyAutoMemoryContent(content: string): {
  classification: AutoMemoryClassification;
  confidence: AutoMemoryEntry['confidence'];
  project?: string;
  signals: string[];
  suggestion: PromotionSuggestion;
} {
  const signals: string[] = [];
  const project = projectFromContent(content);
  if (project) signals.push(`project:${project}`);
  const lesson = hasLessonShape(content);
  if (lesson) signals.push('lesson-shape');
  const projectFact = hasProjectFactShape(content);
  if (projectFact) signals.push('project-fact-shape');
  const sessionNote = hasSessionNoteShape(content);
  if (sessionNote) signals.push('session-note-shape');

  let classification: AutoMemoryClassification = 'unclassified';
  let confidence: AutoMemoryEntry['confidence'] = 'low';

  if (lesson && !project) {
    classification = 'global-lesson';
    confidence = 'high';
  } else if (project && (projectFact || !lesson)) {
    classification = 'project-fact';
    confidence = projectFact ? 'high' : 'medium';
  } else if (lesson) {
    classification = 'global-lesson';
    confidence = 'medium';
  } else if (sessionNote) {
    classification = 'session-note';
    confidence = 'medium';
  }

  return {
    classification,
    confidence,
    project,
    signals,
    suggestion: suggestionFor(classification, project),
  };
}

export function analyzeAutoMemoryInbox(path: string): AutoMemoryInboxReport {
  const counts: Record<AutoMemoryClassification, number> = {
    'project-fact': 0,
    'global-lesson': 0,
    'session-note': 0,
    unclassified: 0,
  };
  const entries: AutoMemoryEntry[] = [];

  if (!existsSync(path)) {
    return { path, total_files: 0, counts, entries };
  }

  const files = readdirSync(path)
    .filter(file => file.endsWith('.md') && file.toLowerCase() !== 'memory.md')
    .sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    const fullPath = join(path, file);
    const stat = statSync(fullPath);
    if (!stat.isFile()) continue;
    const content = readFileSync(fullPath, 'utf-8');
    const classified = classifyAutoMemoryContent(content);
    counts[classified.classification]++;
    entries.push({
      file,
      chars: content.length,
      mtime: stat.mtime.toISOString(),
      ...classified,
    });
  }

  return {
    path,
    total_files: entries.length,
    counts,
    entries,
  };
}

function printReport(report: AutoMemoryInboxReport): void {
  console.log('Auto-memory inbox report');
  console.log(`Path: ${report.path}`);
  console.log(`Files: ${report.total_files}`);
  console.log(`Counts: project-fact=${report.counts['project-fact']} global-lesson=${report.counts['global-lesson']} session-note=${report.counts['session-note']} unclassified=${report.counts.unclassified}`);
  if (report.entries.length === 0) return;
  console.log('');
  for (const entry of report.entries) {
    const project = entry.project ? ` project=${entry.project}` : '';
    const signals = entry.signals.length ? ` signals=${entry.signals.join(',')}` : '';
    console.log(`- ${entry.file}: ${entry.classification} (${entry.confidence})${project}${signals}`);
    console.log(`  route=${entry.suggestion.route}${entry.suggestion.target ? ` target=${entry.suggestion.target}` : ''}`);
    console.log(`  ${entry.suggestion.note}`);
  }
}

function main(): void {
  if (process.argv.includes('--help') || process.argv.includes('-h')) usage();
  const inboxPath = resolveAutoMemoryInboxPath(argValue('--path'));
  const report = analyzeAutoMemoryInbox(inboxPath);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }
}

if (import.meta.main) main();
