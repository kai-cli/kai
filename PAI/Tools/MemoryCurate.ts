#!/usr/bin/env bun
/**
 * MemoryCurate.ts - Weekly memory curation CLI
 *
 * 5-section interactive review targeting 3-7 minutes.
 * Single-key actions: [a]rchive [k]eep [s]kip [r]eject [e]dit [q]uit
 *
 * Usage:
 *   pai curate                    Full interactive weekly report
 *   pai curate --dry-run          Show report without action prompts
 *   pai curate --quick            Staleness + drafts only
 *   pai curate stats              Memory statistics
 *   pai curate stale              List stale files
 *   pai curate domains            Knowledge domain health
 *   pai curate drafts             List pending draft memories
 *   pai curate approve <n>        Approve draft #n
 *   pai curate reject <n>         Reject draft #n
 *   pai curate restore <file>     Restore archived file
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, renameSync, appendFileSync, unlinkSync } from 'fs';
import { join, dirname, basename } from 'path';
import { createInterface } from 'readline';
import { getPaiDir, paiPath } from '../../hooks/lib/paths';
import { listDrafts, cleanupExpired, rejectDraft as stagingReject, writeDraft } from '../../hooks/lib/staging';
import { listKnowledgeDomains } from '../../hooks/lib/knowledge-readback';
import { loadRatings, analyzeRatings, synthesisToStagingContent } from './LearningPatternSynthesis';

const paiDir = getPaiDir();

// ============================================================================
// ANSI helpers
// ============================================================================
const dim    = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold   = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green  = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red    = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan   = (s: string) => `\x1b[36m${s}\x1b[0m`;
const blue   = (s: string) => `\x1b[34m${s}\x1b[0m`;

// ============================================================================
// Types
// ============================================================================

interface MemoryFile {
  path: string;
  project: string;
  filename: string;
  type: string;
  mtime: Date;
  daysSinceUpdate: number;
  staleThreshold: number;
  isStale: boolean;
  lastReadDomain?: string;
  lastReadDays?: number;
}

interface DomainHealth {
  name: string;
  charCount: number;
  lastDistilled: Date | null;
  daysSince: number;
  status: 'OK' | 'STALE' | 'THIN' | 'MISSING';
}

// ============================================================================
// Memory file scanning
// ============================================================================

function getFileType(filename: string): string {
  if (filename.startsWith('feedback_'))  return 'feedback';
  if (filename.startsWith('project_'))   return 'project';
  if (filename.startsWith('reference_')) return 'reference';
  if (filename.startsWith('user_'))      return 'user';
  return 'other';
}

function getStaleThreshold(type: string): number {
  switch (type) {
    case 'feedback':  return 60;
    case 'project':   return 30;
    case 'reference': return 180;
    default:          return 90;
  }
}

// Load recent domain read timestamps from telemetry
function loadDomainReads(): Map<string, number> {
  const map = new Map<string, number>();
  const readLog = join(paiDir, 'MEMORY', 'STATE', 'memory-reads.jsonl');
  if (!existsSync(readLog)) return map;
  try {
    const lines = readFileSync(readLog, 'utf-8').trim().split('\n').filter(l => l);
    for (const line of lines.slice(-500)) { // last 500 entries
      try {
        const entry = JSON.parse(line);
        const ts = new Date(entry.timestamp).getTime();
        for (const domain of (entry.domains_injected || [])) {
          const existing = map.get(domain) || 0;
          if (ts > existing) map.set(domain, ts);
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return map;
}

function scanAllMemoryFiles(): MemoryFile[] {
  const projectsDir = join(paiDir, 'projects');
  if (!existsSync(projectsDir)) return [];

  const results: MemoryFile[] = [];
  const now = Date.now();

  try {
    const projectDirs = readdirSync(projectsDir, { withFileTypes: true })
      .filter(d => d.isDirectory());

    for (const projDir of projectDirs) {
      const memoryDir = join(projectsDir, projDir.name, 'memory');
      if (!existsSync(memoryDir)) continue;

      const project = projDir.name
        .replace(/^-Users-[^-]+-Projects-/, '')
        .replace(/^-Users-[^-]+-/, '')
        .replace(/-/g, '/');

      const memFiles = readdirSync(memoryDir)
        .filter(f => f.endsWith('.md') && f !== 'MEMORY.md');

      for (const memFile of memFiles) {
        const filePath = join(memoryDir, memFile);
        try {
          const stat = statSync(filePath);
          const type = getFileType(memFile);
          const threshold = getStaleThreshold(type);
          const daysSince = Math.floor((now - stat.mtimeMs) / 86400000);

          results.push({
            path: filePath,
            project,
            filename: memFile,
            type,
            mtime: stat.mtime,
            daysSinceUpdate: daysSince,
            staleThreshold: threshold,
            isStale: daysSince > threshold,
          });
        } catch { /* skip */ }
      }
    }
  } catch { /* skip */ }

  return results;
}

// ============================================================================
// Domain health
// ============================================================================

function getDomainHealth(): DomainHealth[] {
  const knowledgeDir = paiPath('MEMORY', 'KNOWLEDGE');
  const expected = ['firmware', 'api-and-services', 'products', 'devops', 'ui', 'security', 'ai-infrastructure'];
  const results: DomainHealth[] = [];
  const now = Date.now();

  for (const domain of expected) {
    const filePath = join(knowledgeDir, `${domain}.md`);
    if (!existsSync(filePath)) {
      results.push({ name: domain, charCount: 0, lastDistilled: null, daysSince: 999, status: 'MISSING' });
      continue;
    }
    try {
      const content = readFileSync(filePath, 'utf-8');
      const stat = statSync(filePath);
      const daysSince = Math.floor((now - stat.mtimeMs) / 86400000);

      let status: DomainHealth['status'] = 'OK';
      if (content.length < 500) status = 'THIN';
      else if (daysSince > 7) status = 'STALE';

      results.push({ name: domain, charCount: content.length, lastDistilled: stat.mtime, daysSince, status });
    } catch {
      results.push({ name: domain, charCount: 0, lastDistilled: null, daysSince: 999, status: 'MISSING' });
    }
  }
  return results;
}

// ============================================================================
// Archive / restore
// ============================================================================

function archiveFile(file: MemoryFile): { success: boolean; archivePath?: string; error?: string } {
  try {
    const archiveDir = join(dirname(file.path), '.archive');
    mkdirSync(archiveDir, { recursive: true });

    const dateStr = new Date().toISOString().split('T')[0];
    const archiveName = `${basename(file.filename, '.md')}.${dateStr}.md`;
    const archivePath = join(archiveDir, archiveName);

    renameSync(file.path, archivePath);

    // Log to archive log
    const logPath = join(archiveDir, '.archive-log.jsonl');
    appendFileSync(logPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      action: 'archive',
      original: file.path,
      archived: archivePath,
      reason: 'stale',
    }) + '\n');

    // Update MEMORY.md index if it exists
    const memoryMd = join(dirname(file.path), 'MEMORY.md');
    if (existsSync(memoryMd)) {
      const content = readFileSync(memoryMd, 'utf-8');
      // Remove the line referencing this file
      const updated = content.split('\n')
        .filter(l => !l.includes(`(${file.filename})`))
        .join('\n');
      if (updated !== content) {
        writeFileSync(memoryMd, updated);
      }
    }

    return { success: true, archivePath };
  } catch (e: unknown) {
    return { success: false, error: String(e) };
  }
}

function restoreFile(project: string, filename: string): { success: boolean; error?: string } {
  // Find the project memory dir
  const projectsDir = join(paiDir, 'projects');
  const projectDirs = existsSync(projectsDir) ? readdirSync(projectsDir) : [];

  let memoryDir: string | null = null;
  for (const dir of projectDirs) {
    const normalized = dir.replace(/-/g, '/').replace(/^Users\/[^/]+\/Projects\//, '');
    if (normalized.includes(project) || dir.includes(project)) {
      memoryDir = join(projectsDir, dir, 'memory');
      break;
    }
  }

  if (!memoryDir || !existsSync(memoryDir)) {
    return { success: false, error: `Project memory dir not found for: ${project}` };
  }

  const archiveDir = join(memoryDir, '.archive');
  if (!existsSync(archiveDir)) {
    return { success: false, error: 'No archive directory found' };
  }

  // Find the archived file (might have date suffix)
  const archiveFiles = readdirSync(archiveDir).filter(f =>
    f.startsWith(basename(filename, '.md')) && f.endsWith('.md')
  );

  if (archiveFiles.length === 0) {
    return { success: false, error: `No archived version of ${filename} found` };
  }

  // Use most recent archived version
  const toRestore = archiveFiles.sort().pop()!;
  const archivePath = join(archiveDir, toRestore);
  const restorePath = join(memoryDir, filename);

  try {
    renameSync(archivePath, restorePath);

    // Log restore
    const logPath = join(archiveDir, '.archive-log.jsonl');
    appendFileSync(logPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      action: 'restore',
      archived: archivePath,
      restored: restorePath,
    }) + '\n');

    return { success: true };
  } catch (e: unknown) {
    return { success: false, error: String(e) };
  }
}

// ============================================================================
// Draft approve
// ============================================================================

function approveDraft(index: number): { success: boolean; error?: string } {
  const drafts = listDrafts();
  const draft = drafts[index - 1];
  if (!draft) return { success: false, error: `Draft #${index} not found` };

  // Find the target project memory dir
  const projectsDir = join(paiDir, 'projects');
  const projectDirs = existsSync(projectsDir) ? readdirSync(projectsDir) : [];

  let targetMemoryDir: string | null = null;
  for (const dir of projectDirs) {
    if (dir.includes(draft.targetProject.replace(/\//g, '-'))) {
      targetMemoryDir = join(projectsDir, dir, 'memory');
      break;
    }
  }

  if (!targetMemoryDir || !existsSync(targetMemoryDir)) {
    // Fall back: create a new memory dir for the target project
    const fallbackSlug = (draft.targetProject || 'kai').replace(/[^a-z0-9]/gi, '-').toLowerCase();
    const home = process.env.HOME || '';
    targetMemoryDir = join(paiDir, 'projects', `-${home.replace(/\//g, '-').replace(/^-/, '')}-Projects-${fallbackSlug}`, 'memory');
    mkdirSync(targetMemoryDir, { recursive: true });
  }

  const targetPath = join(targetMemoryDir, draft.targetFilename);

  try {
    // Write the draft content (without frontmatter) to target
    const memContent = `---
type: ${draft.type.includes('success') ? 'feedback' : 'project'}
description: ${draft.title}
source: auto-generated (approved ${new Date().toISOString().split('T')[0]})
source_session: ${draft.sourceSession}
---

${draft.content}
`;
    writeFileSync(targetPath, memContent);

    // Update MEMORY.md index
    const memoryMd = join(targetMemoryDir, 'MEMORY.md');
    if (existsSync(memoryMd)) {
      const existing = readFileSync(memoryMd, 'utf-8');
      if (!existing.includes(draft.targetFilename)) {
        const entry = `- [${draft.title}](${draft.targetFilename}) — auto-generated from session ${draft.sourceSession}\n`;
        writeFileSync(memoryMd, existing.trimEnd() + '\n' + entry);
      }
    }

    // Remove from staging
    const stagingPath = join(paiDir, 'MEMORY', 'STAGING', draft.filename);
    if (existsSync(stagingPath)) {
      unlinkSync(stagingPath);
    }

    // Update staging state
    try {
      const stateFile = join(paiDir, 'MEMORY', 'STAGING', '.staging-state.json');
      if (existsSync(stateFile)) {
        const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
        state.stats.totalApproved = (state.stats.totalApproved || 0) + 1;
        state.drafts = (state.drafts || []).filter((d: {filename: string}) => d.filename !== draft.filename);
        writeFileSync(stateFile, JSON.stringify(state, null, 2));
      }
    } catch { /* non-critical */ }

    return { success: true };
  } catch (e: unknown) {
    return { success: false, error: String(e) };
  }
}

// ============================================================================
// Interactive single-key prompt
// ============================================================================

async function prompt(question: string, keys: string[]): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);

    const handler = (chunk: Buffer) => {
      const key = chunk.toString().toLowerCase();
      if (keys.includes(key) || key === 'q') {
        process.stdin.removeListener('data', handler);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write('\n');
        resolve(key);
      }
    };

    try {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.once('data', handler);
    } catch {
      // Fallback for non-TTY environments
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question('', (answer) => {
        rl.close();
        resolve(answer.trim().toLowerCase()[0] || 's');
      });
    }
  });
}

// ============================================================================
// Interactive report sections
// ============================================================================

interface PendingAction {
  type: 'archive';
  file: MemoryFile;
}

async function interactiveStale(dryRun: boolean): Promise<PendingAction[]> {
  const staleFiles = scanAllMemoryFiles()
    .filter(f => f.isStale)
    .sort((a, b) => b.daysSinceUpdate - a.daysSinceUpdate);

  console.log(bold(`\n  SECTION 1: STALENESS REPORT (${staleFiles.length} files flagged)`));
  console.log(dim('  ──────────────────────────────────────────────\n'));

  if (staleFiles.length === 0) {
    console.log(green('  No stale files. All memory files are within threshold.\n'));
    return [];
  }

  const actions: PendingAction[] = [];

  for (let i = 0; i < staleFiles.length; i++) {
    const f = staleFiles[i];
    const tag = f.daysSinceUpdate > f.staleThreshold * 2 ? red('[VERY STALE]') : yellow('[STALE]');
    console.log(`  ${tag} ${bold(f.project)}/${f.filename}`);
    console.log(dim(`     Type: ${f.type} | Updated: ${f.daysSinceUpdate}d ago | Threshold: ${f.staleThreshold}d`));

    if (!dryRun) {
      const key = await prompt(
        `     Action: ${cyan('[a]')}rchive  ${green('[k]')}eep  ${dim('[s]')}kip  ${dim('[q]')}uit → `,
        ['a', 'k', 's', 'q']
      );
      if (key === 'q') { console.log(dim('  (quit)\n')); return actions; }
      if (key === 'a') {
        actions.push({ type: 'archive', file: f });
        console.log(dim(`  → Queued: archive ${f.filename}`));
      }
    }
    console.log();
  }

  return actions;
}

async function interactiveDomains(dryRun: boolean): Promise<void> {
  const domains = getDomainHealth();
  const issues = domains.filter(d => d.status !== 'OK');

  console.log(bold('  SECTION 2: KNOWLEDGE DOMAIN HEALTH'));
  console.log(dim('  ──────────────────────────────────────────────\n'));

  const nameW = 18;
  console.log(dim(`  ${'Domain'.padEnd(nameW)} Chars    Status        Last Distilled`));
  console.log(dim(`  ${'─'.repeat(nameW)} ──────── ──────────── ──────────────`));

  for (const d of domains) {
    const sc = d.status === 'OK' ? green : d.status === 'THIN' ? yellow : d.status === 'STALE' ? yellow : red;
    const last = d.lastDistilled ? `${d.daysSince}d ago` : 'never';
    console.log(`  ${d.name.padEnd(nameW)} ${String(d.charCount).padStart(8)} ${sc(`[${d.status}]`.padEnd(12))} ${dim(last)}`);
  }

  if (!dryRun && issues.length > 0) {
    console.log();
    console.log(dim(`  ${issues.length} domain(s) need attention. Re-distill runs at next session end via KnowledgeSync.`));
    const key = await prompt(
      `  Action: ${cyan('[t]')}rigger KnowledgeSync now  ${dim('[s]')}kip → `,
      ['t', 's', 'q']
    );
    if (key === 't') {
      console.log(dim('  → KnowledgeSync will re-distill on next session end (already scheduled automatically).'));
    }
  }
  console.log();
}

async function interactiveDrafts(dryRun: boolean): Promise<void> {
  const expired = cleanupExpired();
  if (expired > 0) console.log(dim(`  (Cleaned ${expired} expired draft(s))\n`));

  const drafts = listDrafts();
  console.log(bold(`  SECTION 3: DRAFT MEMORIES AWAITING REVIEW (${drafts.length} pending)`));
  console.log(dim('  ──────────────────────────────────────────────\n'));

  if (drafts.length === 0) {
    console.log(dim('  No pending drafts.\n'));
    return;
  }

  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i];
    const confColor = d.confidence >= 0.8 ? green : d.confidence >= 0.6 ? yellow : red;
    console.log(`  ${bold(`${i + 1}.`)} ${cyan(d.title)}`);
    console.log(`     Confidence: ${confColor(d.confidence.toFixed(2))} | Type: ${d.type} | Rating: ${d.sourceRating ?? 'n/a'}`);
    console.log(dim(`     Target: ${d.targetProject}/${d.targetFilename}`));
    console.log(dim(`     Expires: ${new Date(d.expires).toLocaleDateString()}`));

    // Show full preview
    const preview = d.content.substring(0, 200).replace(/\n+/g, ' ').trim();
    console.log(dim(`     Preview: ${preview}${d.content.length > 200 ? '...' : ''}`));

    if (!dryRun) {
      const key = await prompt(
        `     Action: ${green('[a]')}pprove  ${red('[r]')}eject  ${dim('[s]')}kip  ${dim('[q]')}uit → `,
        ['a', 'r', 's', 'q']
      );
      if (key === 'q') { console.log(dim('  (quit)\n')); return; }
      if (key === 'a') {
        const result = approveDraft(i + 1);
        if (result.success) {
          console.log(green(`  ✓ Approved → ${d.targetFilename}`));
        } else {
          console.log(red(`  ✗ Failed: ${result.error}`));
        }
      } else if (key === 'r') {
        stagingReject(d.filename);
        console.log(dim(`  → Rejected: ${d.filename}`));
      }
    }
    console.log();
  }
}

async function interactiveInsights(dryRun: boolean): Promise<void> {
  console.log(bold('  SECTION 4: SESSION INSIGHTS (last 7 days)'));
  console.log(dim('  ──────────────────────────────────────────────\n'));

  // Load recent ratings
  let recentCount = 0;
  let recentAvg = 0;
  let highRatingCount = 0;

  try {
    const ratingsPath = join(paiDir, 'MEMORY', 'LEARNING', 'SIGNALS', 'ratings.jsonl');
    if (existsSync(ratingsPath)) {
      const cutoff = Date.now() - 7 * 86400000;
      const lines = readFileSync(ratingsPath, 'utf-8').trim().split('\n').filter(l => l);
      const recent = lines.map(l => { try { return JSON.parse(l); } catch { return null; } })
        .filter(e => e && new Date(e.timestamp || 0).getTime() > cutoff);
      recentCount = recent.length;
      if (recentCount > 0) {
        recentAvg = recent.reduce((s: number, e: {rating: number}) => s + (e.rating || 0), 0) / recentCount;
        highRatingCount = recent.filter((e: {rating: number}) => e.rating >= 8).length;
      }
    }
  } catch { /* skip */ }

  console.log(`  Sessions this week: ${bold(String(recentCount))} | Avg rating: ${bold(recentAvg.toFixed(1))} | High-rated (8+): ${bold(String(highRatingCount))}`);

  // Show recent reflections count
  let reflCount = 0;
  try {
    const reflPath = join(paiDir, 'MEMORY', 'LEARNING', 'REFLECTIONS', 'algorithm-reflections.jsonl');
    if (existsSync(reflPath)) {
      const cutoff = Date.now() - 7 * 86400000;
      const lines = readFileSync(reflPath, 'utf-8').trim().split('\n').filter(l => l);
      reflCount = lines.filter(l => {
        try { return new Date(JSON.parse(l).timestamp || 0).getTime() > cutoff; } catch { return false; }
      }).length;
    }
  } catch { /* skip */ }

  console.log(`  Algorithm reflections: ${bold(String(reflCount))} this week`);

  if (highRatingCount > 0) {
    console.log(dim(`\n  ${highRatingCount} high-rated session(s) may generate success pattern drafts via RatingCapture.`));
    console.log(dim('  Run `pai curate drafts` after those sessions to review generated memories.'));
  }
  console.log();
}

// ============================================================================
// Render commands (non-interactive)
// ============================================================================

function renderStats() {
  const files = scanAllMemoryFiles();
  const domains = listKnowledgeDomains(paiDir);
  const projects = new Set(files.map(f => f.project));
  const staleCount = files.filter(f => f.isStale).length;

  let totalRatings = 0, avgRating = 0, totalReflections = 0;
  try {
    const rp = join(paiDir, 'MEMORY', 'LEARNING', 'SIGNALS', 'ratings.jsonl');
    if (existsSync(rp)) {
      const lines = readFileSync(rp, 'utf-8').trim().split('\n').filter(l => l);
      totalRatings = lines.length;
      const sum = lines.reduce((a, l) => { try { return a + (JSON.parse(l).rating || 0); } catch { return a; } }, 0);
      avgRating = totalRatings > 0 ? sum / totalRatings : 0;
    }
  } catch { /* skip */ }
  try {
    const rp = join(paiDir, 'MEMORY', 'LEARNING', 'REFLECTIONS', 'algorithm-reflections.jsonl');
    if (existsSync(rp)) totalReflections = readFileSync(rp, 'utf-8').trim().split('\n').filter(l => l).length;
  } catch { /* skip */ }

  const sorted = [...files].sort((a, b) => a.mtime.getTime() - b.mtime.getTime());
  const oldest = sorted[0];
  const newest = sorted[sorted.length - 1];
  const drafts = listDrafts();

  console.log(bold('\n  PAI Memory System Statistics'));
  console.log(dim('  ─────────────────────────────────'));
  console.log(`  Files:        ${bold(String(files.length))} across ${projects.size} projects (${staleCount} stale)`);
  console.log(`  Domains:      ${bold(String(domains.length))} knowledge domains`);
  console.log(`  Ratings:      ${totalRatings} (avg: ${avgRating.toFixed(1)})`);
  console.log(`  Reflections:  ${totalReflections}`);
  console.log(`  Staging:      ${drafts.length} pending drafts`);
  if (oldest) console.log(`  Oldest:       ${dim(oldest.project + '/')}${oldest.filename} ${dim(`(${oldest.daysSinceUpdate}d ago)`)}`);
  if (newest) console.log(`  Newest:       ${dim(newest.project + '/')}${newest.filename} ${dim(`(${newest.daysSinceUpdate}d ago)`)}`);
  console.log();
}

function renderStale() {
  const files = scanAllMemoryFiles().filter(f => f.isStale)
    .sort((a, b) => b.daysSinceUpdate - a.daysSinceUpdate);

  console.log(bold(`\n  Stale Memory Files (${files.length} flagged)`));
  console.log(dim('  ─────────────────────────────────'));

  if (files.length === 0) { console.log(green('  No stale files.\n')); return; }

  for (const f of files) {
    const tag = f.daysSinceUpdate > f.staleThreshold * 2 ? red('[VERY STALE]') : yellow('[STALE]');
    console.log(`  ${tag} ${dim(f.project + '/')}${f.filename}`);
    console.log(dim(`     ${f.type} | ${f.daysSinceUpdate}d ago | threshold: ${f.staleThreshold}d`));
  }
  console.log();
  console.log(dim('  Run `pai curate` to archive interactively.'));
  console.log();
}

function renderDomains() {
  const domains = getDomainHealth();
  console.log(bold('\n  Knowledge Domain Health'));
  console.log(dim('  ─────────────────────────────────'));
  const nw = 18;
  console.log(dim(`  ${'Domain'.padEnd(nw)} Chars    Status`));
  console.log(dim(`  ${'─'.repeat(nw)} ──────── ──────`));
  for (const d of domains) {
    const sc = d.status === 'OK' ? green : d.status === 'THIN' || d.status === 'STALE' ? yellow : red;
    const last = d.lastDistilled ? `${d.daysSince}d ago` : 'never';
    console.log(`  ${d.name.padEnd(nw)} ${String(d.charCount).padStart(8)} ${sc(`[${d.status}]`)} ${dim(last)}`);
  }
  console.log();
}

function renderDrafts() {
  const expired = cleanupExpired();
  if (expired > 0) console.log(dim(`  (Cleaned ${expired} expired drafts)\n`));

  const drafts = listDrafts();
  console.log(bold(`\n  Draft Memories Awaiting Review (${drafts.length} pending)`));
  console.log(dim('  ─────────────────────────────────'));

  if (drafts.length === 0) { console.log(dim('  No pending drafts.\n')); return; }

  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i];
    const cc = d.confidence >= 0.8 ? green : d.confidence >= 0.6 ? yellow : red;
    console.log(`  ${bold(`${i + 1}.`)} ${cyan(d.title)}`);
    console.log(dim(`     conf: ${cc(d.confidence.toFixed(2))} | ${d.type} | rating: ${d.sourceRating ?? 'n/a'} | expires: ${new Date(d.expires).toLocaleDateString()}`));
    const preview = d.content.substring(0, 100).replace(/\n/g, ' ');
    console.log(dim(`     ${preview}...`));
  }
  console.log();
  console.log(dim('  Approve: pai curate approve <n>  |  Reject: pai curate reject <n>'));
  console.log();
}

// ============================================================================
// Full interactive report
// ============================================================================

async function runFullReport(dryRun: boolean, quick: boolean) {
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const mode = dryRun ? dim(' [DRY RUN]') : '';

  console.log(bold(`\n${'═'.repeat(72)}`));
  console.log(bold(`  PAI MEMORY CURATION REPORT — ${date}${mode}`));
  console.log(bold(`${'═'.repeat(72)}\n`));
  if (dryRun) console.log(dim('  Dry run — showing report only, no actions will be taken.\n'));

  const archiveActions = await interactiveStale(dryRun);

  if (!quick) {
    await interactiveDomains(dryRun);
  }

  await interactiveDrafts(dryRun);

  if (!quick) {
    await interactiveInsights(dryRun);
  }

  renderStats();

  // Execute queued archive actions
  if (archiveActions.length > 0 && !dryRun) {
    console.log(bold('  Executing queued actions...'));
    for (const action of archiveActions) {
      const result = archiveFile(action.file);
      if (result.success) {
        console.log(green(`  ✓ Archived: ${action.file.filename} → .archive/`));
      } else {
        console.log(red(`  ✗ Archive failed: ${result.error}`));
      }
    }
    console.log();
  }

  // Run LearningPatternSynthesis and write results to STAGING if there's enough new signal
  if (!dryRun && !quick) {
    try {
      const synthStatePath = join(paiDir, 'MEMORY', 'STATE', 'synthesis-state.json');
      let lastCount = 0;
      if (existsSync(synthStatePath)) {
        try { lastCount = JSON.parse(readFileSync(synthStatePath, 'utf-8')).lastRatingCount || 0; } catch {}
      }
      const ratings = loadRatings(30); // last 30 days
      // Compare against lastCount but clamp to 0 — window shrinkage (old ratings
      // falling out of 30d range) should not produce a negative newCount.
      const newCount = Math.max(0, ratings.length - lastCount);
      if (ratings.length >= 5 && newCount >= 5) {
        const result = analyzeRatings(ratings, 'last-30-days');
        if (result.frustrations.length > 0 || result.successes.length > 0) {
          const content = synthesisToStagingContent(result);
          if (content.trim()) {
            // Write to STAGING as a draft (same pipeline as ReflectionHarvester)
            writeDraft({
              type: 'pattern-insight',
              sourceSession: 'pai-curate',
              confidence: 0.75,
              generated: new Date().toISOString(),
              targetProject: 'all',
              targetFilename: 'ratings-patterns.md',
              title: `Rating pattern synthesis from ${ratings.length} ratings`,
              content,
            });
            console.log(dim(`\n  📊 Pattern synthesis draft created from ${ratings.length} ratings → STAGING`));
            writeFileSync(synthStatePath, JSON.stringify({ lastRatingCount: ratings.length, lastRun: new Date().toISOString() }));
          }
        }
      }
    } catch { /* non-critical — synthesis failure should not block curate */ }
  }

  // Write curation log
  try {
    const logDir = join(paiDir, 'MEMORY', 'STATE');
    mkdirSync(logDir, { recursive: true });
    appendFileSync(join(logDir, 'curation-log.jsonl'), JSON.stringify({
      timestamp: new Date().toISOString(),
      dryRun,
      actionsQueued: archiveActions.length,
    }) + '\n');
  } catch { /* non-critical */ }

  console.log(bold(`${'═'.repeat(72)}`));
  console.log(dim('  Run `pai curate --help` for all commands.'));
  console.log();
}

// ============================================================================
// Main
// ============================================================================

const rawArgs = process.argv.slice(2);
const flags = rawArgs.filter(a => a.startsWith('--'));
const posArgs = rawArgs.filter(a => !a.startsWith('--'));

const dryRun = flags.includes('--dry-run');
const quick  = flags.includes('--quick');
const subcommand = posArgs[0] || '';
const subArg     = posArgs[1] || '';

if (flags.includes('--help') || subcommand === 'help') {
  console.log(`
  ${bold('pai curate')} — Weekly memory curation

  ${dim('Commands:')}
    ${cyan('pai curate')}                    Full interactive weekly report
    ${cyan('pai curate --dry-run')}          Show report, no actions
    ${cyan('pai curate --quick')}            Staleness + drafts only
    ${cyan('pai curate stats')}              Memory statistics
    ${cyan('pai curate stale')}              List stale files
    ${cyan('pai curate domains')}            Domain health
    ${cyan('pai curate drafts')}             List pending drafts
    ${cyan('pai curate approve <n>')}        Approve draft #n
    ${cyan('pai curate reject <n>')}         Reject draft #n
    ${cyan('pai curate restore <proj> <f>')} Restore archived file
`);
  process.exit(0);
}

switch (subcommand) {
  case 'stats':
    renderStats();
    break;
  case 'stale':
    renderStale();
    break;
  case 'domains':
    renderDomains();
    break;
  case 'drafts':
    renderDrafts();
    break;
  case 'approve': {
    const n = parseInt(subArg);
    if (!n) { console.log(red('  Usage: pai curate approve <n>')); process.exit(1); }
    const result = approveDraft(n);
    if (result.success) {
      console.log(green(`  ✓ Draft #${n} approved and written to memory.`));
    } else {
      console.log(red(`  ✗ ${result.error}`));
      process.exit(1);
    }
    break;
  }
  case 'reject': {
    const n = parseInt(subArg);
    if (!n) { console.log(red('  Usage: pai curate reject <n>')); process.exit(1); }
    const drafts = listDrafts();
    const draft = drafts[n - 1];
    if (!draft) { console.log(red(`  Draft #${n} not found.`)); process.exit(1); }
    stagingReject(draft.filename);
    console.log(dim(`  ✓ Draft #${n} rejected.`));
    break;
  }
  case 'restore': {
    const project = subArg;
    const filename = posArgs[2];
    if (!project || !filename) {
      console.log(red('  Usage: pai curate restore <project> <filename>'));
      process.exit(1);
    }
    const result = restoreFile(project, filename);
    if (result.success) {
      console.log(green(`  ✓ Restored ${filename} to ${project} memory.`));
    } else {
      console.log(red(`  ✗ ${result.error}`));
      process.exit(1);
    }
    break;
  }
  default:
    runFullReport(dryRun, quick).catch(console.error);
}
