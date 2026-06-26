#!/usr/bin/env bun
// KnowledgeSync.hook.ts - Incremental knowledge distillation (SessionEnd)
//
// Checks if any project memory files changed since the last harvest.
// If so, re-distills only the affected knowledge domains.
// No-change sessions cost <5ms (stat checks only).
//
// TRIGGER: SessionEnd (async)
//
// INPUT: stdin hook JSON (session_id)
// OUTPUT: stderr status messages, exit(0) always
//
// SIDE EFFECTS:
//   Updates: MEMORY/KNOWLEDGE/<domain>.md (only changed domains)
//   Updates: MEMORY/KNOWLEDGE/.harvest-state.json (mtime tracking)

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'fs';
import { readJSON, atomicWriteJSON } from './lib/atomic';
import { spawn } from 'child_process';
import { join } from 'path';
import { getPaiDir, paiPath } from './lib/paths';
import { count as countRatingsStore } from './lib/ratings-store';
import { inference } from '../PAI/Tools/Inference';
import { canCallInference, recordInferenceCall, budgetStatus } from './lib/inference-budget';
import { loadDomainKeywords, loadDomainDescriptions } from './lib/config-loader';
import { parseKnowledgeFile, writeKnowledgeFile, type KnowledgeFile } from './lib/knowledge-schema';
import { emitMemoryTelemetry } from './lib/memory-telemetry';
import { redactSecrets } from './lib/redact';
import { SECRET_PATTERNS } from './lib/secret-patterns';

// ============================================================================
// Types
// ============================================================================

interface HarvestState {
  lastRun: string;
  lastFullHarvest?: string; // ISO timestamp of last full harvest
  fileMtimes: Record<string, number>; // path -> mtime ms
}

const FULL_HARVEST_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface ChangedFile {
  project: string;
  filename: string;
  path: string;
  content: string;
}

export interface DisclosureFinding {
  kind: 'secret' | 'internal-url' | 'private-path' | 'email';
  label: string;
  action: 'redact' | 'stage';
}

export interface DisclosureAssessment {
  safeToWrite: boolean;
  body: string;
  findings: DisclosureFinding[];
}

// Domain definitions — loaded from config/domains.jsonc via config-loader

function getDomainKeywords(): Record<string, string[]> {
  return loadDomainKeywords();
}

function getDomainDescriptions(): Record<string, string> {
  return loadDomainDescriptions();
}

// ============================================================================
// Knowledge file write helper (preserves frontmatter)
// ============================================================================

function writeKnowledgeFileWithFrontmatter(domain: string, body: string): void {
  const filePath = join(KNOWLEDGE_DIR, `${domain}.md`);
  const existing = parseKnowledgeFile(filePath);
  const today = new Date().toISOString().split('T')[0];
  const meta = existing?.meta ?? { domain, updated: today, tags: [], related: [] };
  meta.updated = today;
  const kf: KnowledgeFile = { meta, body: body + '\n', path: filePath, slug: domain };
  writeKnowledgeFile(kf);
}

export function assessKnowledgeDisclosure(body: string): DisclosureAssessment {
  const findings: DisclosureFinding[] = [];
  for (const { name, pattern } of SECRET_PATTERNS) {
    if (pattern.test(body)) findings.push({ kind: 'secret', label: name, action: 'redact' });
  }

  const redacted = redactSecrets(body);
  const stagePatterns: Array<{ kind: DisclosureFinding['kind']; label: string; pattern: RegExp }> = [
    { kind: 'internal-url', label: 'private network URL', pattern: /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}|[^/\s)]+(?:\.corp|\.internal|\.local|\.lan))\b/gi },
    { kind: 'private-path', label: 'local user path', pattern: /(?:^|\s)(?:\/Users\/[A-Za-z0-9._-]+|~\/)(?:\/[^\s)]+)?/g },
    { kind: 'email', label: 'email address', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  ];
  for (const { kind, label, pattern } of stagePatterns) {
    if (pattern.test(redacted)) findings.push({ kind, label, action: 'stage' });
  }

  return {
    safeToWrite: findings.every(f => f.action !== 'stage'),
    body: redacted,
    findings,
  };
}

function writeKnowledgeSyncProposal(
  domain: string,
  body: string,
  findings: DisclosureFinding[],
  fields: { runId: string; mode: string },
): string {
  const stagingDir = join(getPaiDir(), 'MEMORY', 'STAGING');
  mkdirSync(stagingDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${timestamp}_knowledge-sync-review_${domain}.md`;
  const content = [
    '---',
    'type: knowledge-sync-review',
    `source_type: KnowledgeSync`,
    `run_id: ${fields.runId}`,
    `mode: ${fields.mode}`,
    `domain: ${domain}`,
    `generated: ${new Date().toISOString()}`,
    `findings: ${findings.map(f => `${f.kind}:${f.label}`).join(', ')}`,
    'target: MEMORY/KNOWLEDGE/' + domain + '.md',
    '---',
    '',
    '# KnowledgeSync disclosure review',
    '',
    'KnowledgeSync staged this proposed domain refresh instead of writing tracked knowledge directly.',
    '',
    'Findings:',
    ...findings.map(f => `- ${f.action}: ${f.kind} - ${f.label}`),
    '',
    '## Proposed content',
    '',
    body.trim(),
    '',
  ].join('\n');
  writeFileSync(join(stagingDir, filename), content, 'utf-8');
  return filename;
}

function persistDistilledKnowledge(
  domain: string,
  body: string,
  fields: { runId: string; mode: string },
): { status: 'updated' | 'redacted' | 'staged_disclosure_review'; body: string; findings: DisclosureFinding[]; stagedFilename?: string } {
  const assessment = assessKnowledgeDisclosure(body);
  if (!assessment.safeToWrite) {
    const stagedFilename = writeKnowledgeSyncProposal(domain, assessment.body, assessment.findings, fields);
    return { status: 'staged_disclosure_review', body: assessment.body, findings: assessment.findings, stagedFilename };
  }
  writeKnowledgeFileWithFrontmatter(domain, assessment.body);
  return {
    status: assessment.findings.length > 0 ? 'redacted' : 'updated',
    body: assessment.body,
    findings: assessment.findings,
  };
}

// ============================================================================
// State management
// ============================================================================

const KNOWLEDGE_DIR = paiPath('MEMORY', 'KNOWLEDGE');
const STATE_FILE = join(KNOWLEDGE_DIR, '.harvest-state.json');

function newRunId(): string {
  return `ks_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function emitKnowledgeSyncTelemetry(fields: Record<string, unknown>): void {
  emitMemoryTelemetry('knowledge.sync', {
    hook: 'KnowledgeSync',
    ...fields,
  });
}

function loadState(): HarvestState {
  return readJSON<HarvestState>(STATE_FILE, { lastRun: '', fileMtimes: {} });
}

function saveState(state: HarvestState): void {
  mkdirSync(KNOWLEDGE_DIR, { recursive: true });
  atomicWriteJSON(STATE_FILE, state);
}

// ============================================================================
// Change detection
// ============================================================================

function scanMemoryFiles(): Array<{ path: string; project: string; filename: string; mtime: number }> {
  const projectsDir = join(getPaiDir(), 'projects');
  if (!existsSync(projectsDir)) return [];

  const results: Array<{ path: string; project: string; filename: string; mtime: number }> = [];

  try {
    const projectDirs = readdirSync(projectsDir, { withFileTypes: true })
      .filter(d => d.isDirectory());

    for (const projDir of projectDirs) {
      const memoryDir = join(projectsDir, projDir.name, 'memory');
      if (!existsSync(memoryDir)) continue;

      const memFiles = readdirSync(memoryDir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md');
      for (const memFile of memFiles) {
        const filePath = join(memoryDir, memFile);
        try {
          const stat = statSync(filePath);
          results.push({
            path: filePath,
            project: projDir.name,
            filename: memFile,
            mtime: stat.mtimeMs,
          });
        } catch { /* skip */ }
      }
    }
  } catch { /* skip */ }

  return results;
}

function detectChanges(state: HarvestState): ChangedFile[] {
  const currentFiles = scanMemoryFiles();
  const changed: ChangedFile[] = [];

  for (const file of currentFiles) {
    const previousMtime = state.fileMtimes[file.path];
    if (previousMtime === undefined || file.mtime > previousMtime) {
      try {
        const content = readFileSync(file.path, 'utf-8');
        const project = file.project
          .replace(/^-Users-[^-]+-Projects-/, '')
          .replace(/^-Users-[^-]+-/, '')
          .replace(/-/g, '/');

        changed.push({
          project,
          filename: file.filename,
          path: file.path,
          content,
        });
      } catch { /* skip unreadable */ }
    }
  }

  return changed;
}

// ============================================================================
// Domain identification
// ============================================================================

export function identifyAffectedDomains(changedFiles: ChangedFile[]): Set<string> {
  const affected = new Set<string>();
  const domainKeywords = getDomainKeywords();

  for (const file of changedFiles) {
    const text = (file.filename + ' ' + file.content.substring(0, 2000)).toLowerCase();

    const scores: Array<{ domain: string; hits: number }> = [];
    for (const [domain, keywords] of Object.entries(domainKeywords)) {
      const hits = keywords.filter(kw => text.includes(kw)).length;
      if (hits >= 3) {
        scores.push({ domain, hits });
      }
    }

    scores.sort((a, b) => b.hits - a.hits);
    for (const entry of scores.slice(0, 2)) {
      affected.add(entry.domain);
    }
  }

  return affected;
}

// ============================================================================
// Extraction (lightweight - reuses KnowledgeHarvester logic)
// ============================================================================

export function extractFacts(content: string, filename: string): string[] {
  const facts: string[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const boldMatches = line.matchAll(/\*\*(.+?)\*\*/g);
    for (const match of boldMatches) {
      if (match[1].length > 10 && match[1].length < 200) {
        facts.push(match[1]);
      }
    }

    const bulletMatch = line.match(/^[-*]\s+(.{15,200})$/);
    if (bulletMatch) {
      facts.push(bulletMatch[1].replace(/\*\*/g, ''));
    }

    const tableMatch = line.match(/^\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/);
    if (tableMatch && !line.includes('---') && !line.includes('Topic') && !line.includes('Path')) {
      const key = tableMatch[1].trim().replace(/\*\*/g, '');
      const val = tableMatch[2].trim().replace(/\*\*/g, '');
      if (key.length > 3 && val.length > 3) {
        facts.push(`${key}: ${val}`);
      }
    }
  }

  return facts;
}

// ============================================================================
// Distillation
// ============================================================================

async function distillDomain(domain: string, facts: string[]): Promise<string | null> {
  const MAX_FACTS = 50;
  const cappedFacts = facts.length > MAX_FACTS
    ? facts.sort((a, b) => b.length - a.length).slice(0, MAX_FACTS)
    : facts;

  const descriptions = getDomainDescriptions();
  const description = descriptions[domain] || domain;

  const systemPrompt = `You are a technical knowledge distiller. Given a list of extracted facts about "${description}", produce a concise reference document (~200-300 words). Format as markdown with 2-3 sections. Include only facts that would be useful for an engineering manager working with this technology daily. No introductions, no conclusions - just the distilled knowledge. Preserve specific details: names, versions, numbers, URLs.`;

  const userPrompt = `Domain: ${domain}\nDescription: ${description}\n\nExtracted facts (${cappedFacts.length} items):\n${cappedFacts.map((f, i) => `${i + 1}. ${f}`).join('\n')}`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await inference({
      systemPrompt,
      userPrompt,
      level: 'fast',
      timeout: 90000,
    });

    if (result.success) {
      return result.output.trim();
    }

    if (attempt === 1) {
      console.error(`  [KnowledgeSync] ${domain}: attempt 1 failed (${result.error}), retrying...`);
    } else {
      console.error(`  [KnowledgeSync] LLM failed for ${domain}: ${result.error}`);
    }
  }

  return null;
}

// ============================================================================
// Auto-harvest reflections + auto-synthesize patterns
// ============================================================================

const REFLECTION_AUTO_HARVEST_THRESHOLD = 10;
const REFLECTION_FILE = join(getPaiDir(), 'MEMORY', 'LEARNING', 'REFLECTIONS', 'algorithm-reflections.jsonl');
const HARVEST_STATE_FILE = join(getPaiDir(), 'MEMORY', 'STATE', 'reflection-harvest-state.json');
const SYNTHESIS_STATE_FILE = join(getPaiDir(), 'MEMORY', 'STATE', 'synthesis-state.json');
const PATTERN_SYNTHESIS_THRESHOLD = 20;

function countLines(filePath: string): number {
  if (!existsSync(filePath)) return 0;
  try {
    return readFileSync(filePath, 'utf-8').trim().split('\n').filter(l => l.trim()).length;
  } catch { return 0; }
}

function spawnDetached(tool: string, args: string[] = []): void {
  const proc = spawn('bun', ['run', tool, ...args], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });
  proc.unref();
}

function maybeAutoHarvest(): void {
  try {
    const totalReflections = countLines(REFLECTION_FILE);
    let lastCount = 0;
    if (existsSync(HARVEST_STATE_FILE)) {
      try { lastCount = JSON.parse(readFileSync(HARVEST_STATE_FILE, 'utf-8')).lastReflectionCount || 0; } catch {}
    }
    const newCount = totalReflections - lastCount;
    if (newCount < REFLECTION_AUTO_HARVEST_THRESHOLD) {
      console.error(`[KnowledgeSync] Reflection harvest: ${newCount}/${REFLECTION_AUTO_HARVEST_THRESHOLD} new — not yet`);
      return;
    }
    const harvesterPath = join(getPaiDir(), 'PAI', 'Tools', 'ReflectionHarvester.ts');
    if (!existsSync(harvesterPath)) return;
    console.error(`[KnowledgeSync] Auto-triggering ReflectionHarvester (${newCount} new reflections)`);
    spawnDetached(harvesterPath);
  } catch (err) {
    console.error(`[KnowledgeSync] Auto-harvest check failed (non-fatal): ${err}`);
  }
}

function maybeSynthesizePatterns(): void {
  try {
    const totalRatings = countRatingsStore(); // W11: shared ratings-store
    let lastCount = 0;
    if (existsSync(SYNTHESIS_STATE_FILE)) {
      try { lastCount = JSON.parse(readFileSync(SYNTHESIS_STATE_FILE, 'utf-8')).lastRatingCount || 0; } catch {}
    }
    const newCount = totalRatings - lastCount;
    if (newCount < PATTERN_SYNTHESIS_THRESHOLD) {
      console.error(`[KnowledgeSync] Pattern synthesis: ${newCount}/${PATTERN_SYNTHESIS_THRESHOLD} new ratings — not yet`);
      return;
    }
    const synthPath = join(getPaiDir(), 'PAI', 'Tools', 'LearningPatternSynthesis.ts');
    if (!existsSync(synthPath)) return;
    console.error(`[KnowledgeSync] Auto-triggering LearningPatternSynthesis (${newCount} new ratings)`);
    spawnDetached(synthPath, ['--week']);
    mkdirSync(join(getPaiDir(), 'MEMORY', 'STATE'), { recursive: true });
    writeFileSync(SYNTHESIS_STATE_FILE, JSON.stringify({ lastRatingCount: totalRatings, lastRun: new Date().toISOString() }, null, 2));
  } catch (err) {
    console.error(`[KnowledgeSync] Pattern synthesis check failed (non-fatal): ${err}`);
  }
}


// ============================================================================

async function main() {
  const runId = newRunId();
  const runStart = Date.now();
  try {
    emitKnowledgeSyncTelemetry({ phase: 'start', run_id: runId, mode: 'unknown' });

    if (!existsSync(KNOWLEDGE_DIR)) {
      console.error('[KnowledgeSync] No KNOWLEDGE/ directory - run KnowledgeHarvester.ts first');
      emitKnowledgeSyncTelemetry({
        phase: 'complete',
        run_id: runId,
        mode: 'unknown',
        status: 'skipped',
        reason: 'missing_knowledge_dir',
        ms: Date.now() - runStart,
      });
      process.exit(0);
    }

    const state = loadState();

    const needsFullHarvest = !state.lastFullHarvest ||
      (Date.now() - new Date(state.lastFullHarvest).getTime()) > FULL_HARVEST_INTERVAL_MS;

    if (needsFullHarvest) {
      console.error('[KnowledgeSync] Full harvest overdue — re-distilling ALL domains');
      await runFullHarvest(state, runId, runStart);
      process.exit(0);
    }

    const changedFiles = detectChanges(state);

    if (changedFiles.length === 0) {
      console.error('[KnowledgeSync] No memory file changes detected - skipping');
      emitKnowledgeSyncTelemetry({
        phase: 'complete',
        run_id: runId,
        mode: 'incremental',
        status: 'skipped',
        reason: 'no_changed_files',
        changed_files: 0,
        ms: Date.now() - runStart,
      });
      process.exit(0);
    }

    console.error(`[KnowledgeSync] ${changedFiles.length} memory files changed`);

    const affectedDomains = identifyAffectedDomains(changedFiles);

    if (affectedDomains.size === 0) {
      console.error('[KnowledgeSync] Changed files don\'t affect any knowledge domains - skipping');
      updateState(state);
      emitKnowledgeSyncTelemetry({
        phase: 'complete',
        run_id: runId,
        mode: 'incremental',
        status: 'skipped',
        reason: 'no_affected_domains',
        changed_files: changedFiles.length,
        affected_domains: 0,
        ms: Date.now() - runStart,
      });
      process.exit(0);
    }

    console.error(`[KnowledgeSync] Re-distilling ${affectedDomains.size} domains: ${Array.from(affectedDomains).join(', ')}`);

    const allMemoryFiles = scanMemoryFiles();
    const domainKeywords = getDomainKeywords();
    let updatedDomains = 0;
    let skippedDomains = 0;
    let stagedDomains = 0;

    for (const domain of affectedDomains) {
      const domainStart = Date.now();
      const keywords = domainKeywords[domain];
      if (!keywords) {
        skippedDomains++;
        emitKnowledgeSyncTelemetry({
          phase: 'domain',
          run_id: runId,
          mode: 'incremental',
          domain,
          status: 'skipped',
          reason: 'missing_keywords',
          ms: Date.now() - domainStart,
        });
        continue;
      }

      const domainFacts: string[] = [];

      for (const file of allMemoryFiles) {
        try {
          const content = readFileSync(file.path, 'utf-8');
          const text = (file.filename + ' ' + content.substring(0, 2000)).toLowerCase();
          const hits = keywords.filter(kw => text.includes(kw)).length;

          if (hits >= 2) {
            domainFacts.push(...extractFacts(content, file.filename));
          }
        } catch { /* skip */ }
      }

      if (domainFacts.length < 3) {
        console.error(`  [KnowledgeSync] ${domain}: too few facts (${domainFacts.length}) - skipping`);
        skippedDomains++;
        emitKnowledgeSyncTelemetry({
          phase: 'domain',
          run_id: runId,
          mode: 'incremental',
          domain,
          status: 'skipped',
          reason: 'too_few_facts',
          facts: domainFacts.length,
          unique_facts: 0,
          ms: Date.now() - domainStart,
        });
        continue;
      }

      const unique: string[] = [];
      for (const fact of domainFacts) {
        const isDupe = unique.some(existing => {
          const wordsA = new Set(fact.toLowerCase().split(/\s+/).filter(w => w.length > 3));
          const wordsB = new Set(existing.toLowerCase().split(/\s+/).filter(w => w.length > 3));
          if (wordsA.size === 0 || wordsB.size === 0) return false;
          let intersection = 0;
          for (const w of wordsA) { if (wordsB.has(w)) intersection++; }
          return intersection / (wordsA.size + wordsB.size - intersection) > 0.5;
        });
        if (!isDupe) unique.push(fact);
      }

      console.error(`  [KnowledgeSync] ${domain}: ${unique.length} unique facts, distilling...`);

      if (!canCallInference()) {
        console.error(`  [KnowledgeSync] ${domain}: skipped (inference budget exhausted: ${budgetStatus()})`);
        skippedDomains++;
        emitKnowledgeSyncTelemetry({
          phase: 'domain',
          run_id: runId,
          mode: 'incremental',
          domain,
          status: 'skipped',
          reason: 'inference_budget_exhausted',
          facts: domainFacts.length,
          unique_facts: unique.length,
          ms: Date.now() - domainStart,
        });
        continue;
      }

      const content = await distillDomain(domain, unique);
      if (content) {
        recordInferenceCall('KnowledgeSync', domain);
        const persisted = persistDistilledKnowledge(domain, content, { runId, mode: 'incremental' });
        if (persisted.status === 'staged_disclosure_review') stagedDomains++;
        else updatedDomains++;
        emitKnowledgeSyncTelemetry({
          phase: 'domain',
          run_id: runId,
          mode: 'incremental',
          domain,
          status: persisted.status,
          facts: domainFacts.length,
          unique_facts: unique.length,
          output_chars: persisted.body.length,
          disclosure_findings: persisted.findings.length,
          staged_filename: persisted.stagedFilename,
          ms: Date.now() - domainStart,
        });
        if (persisted.status === 'staged_disclosure_review') {
          console.error(`  [KnowledgeSync] ${domain}: staged for disclosure review (${persisted.findings.length} finding(s)) [budget: ${budgetStatus()}]`);
        } else {
          console.error(`  [KnowledgeSync] ${domain}: ${persisted.status} (${persisted.body.length} chars) [budget: ${budgetStatus()}]`);
        }
      } else {
        skippedDomains++;
        emitKnowledgeSyncTelemetry({
          phase: 'domain',
          run_id: runId,
          mode: 'incremental',
          domain,
          status: 'skipped',
          reason: 'empty_distillation',
          facts: domainFacts.length,
          unique_facts: unique.length,
          ms: Date.now() - domainStart,
        });
      }
    }

    updateState(state);

    maybeAutoHarvest();
    maybeSynthesizePatterns();

    console.error('[KnowledgeSync] Done');
    emitKnowledgeSyncTelemetry({
      phase: 'complete',
      run_id: runId,
      mode: 'incremental',
      status: 'complete',
      changed_files: changedFiles.length,
      affected_domains: affectedDomains.size,
      updated_domains: updatedDomains,
      skipped_domains: skippedDomains,
      staged_domains: stagedDomains,
      memory_files_scanned: allMemoryFiles.length,
      ms: Date.now() - runStart,
    });
    process.exit(0);
  } catch (error) {
    console.error('[KnowledgeSync] Error:', error);
    emitKnowledgeSyncTelemetry({
      phase: 'complete',
      run_id: runId,
      mode: 'unknown',
      status: 'error',
      error_class: error instanceof Error ? error.name : typeof error,
      ms: Date.now() - runStart,
    });
    process.exit(0); // Non-fatal
  }
}

function updateState(state: HarvestState, fullHarvest = false): void {
  const allFiles = scanMemoryFiles();
  const newMtimes: Record<string, number> = {};
  for (const file of allFiles) {
    newMtimes[file.path] = file.mtime;
  }
  const now = new Date().toISOString();
  saveState({
    lastRun: now,
    lastFullHarvest: fullHarvest ? now : (state.lastFullHarvest || now),
    fileMtimes: newMtimes,
  });
}

async function runFullHarvest(state: HarvestState, runId = newRunId(), runStart = Date.now()): Promise<void> {
  const allMemoryFiles = scanMemoryFiles();
  const domainKeywords = getDomainKeywords();
  let updatedDomains = 0;
  let skippedDomains = 0;
  let stagedDomains = 0;
  console.error(`[KnowledgeSync] Full harvest: scanning ${allMemoryFiles.length} memory files across all projects`);

  for (const [domain, keywords] of Object.entries(domainKeywords)) {
    const domainStart = Date.now();
    const domainFacts: string[] = [];

    for (const file of allMemoryFiles) {
      try {
        const content = readFileSync(file.path, 'utf-8');
        const text = (file.filename + ' ' + content.substring(0, 2000)).toLowerCase();
        const hits = keywords.filter(kw => text.includes(kw)).length;

        if (hits >= 2) {
          domainFacts.push(...extractFacts(content, file.filename));
        }
      } catch { /* skip */ }
    }

    if (domainFacts.length < 3) {
      console.error(`  [KnowledgeSync] ${domain}: too few facts (${domainFacts.length}) - skipping`);
      skippedDomains++;
      emitKnowledgeSyncTelemetry({
        phase: 'domain',
        run_id: runId,
        mode: 'full',
        domain,
        status: 'skipped',
        reason: 'too_few_facts',
        facts: domainFacts.length,
        unique_facts: 0,
        ms: Date.now() - domainStart,
      });
      continue;
    }

    const unique: string[] = [];
    for (const fact of domainFacts) {
      const isDupe = unique.some(existing => {
        const wordsA = new Set(fact.toLowerCase().split(/\s+/).filter(w => w.length > 3));
        const wordsB = new Set(existing.toLowerCase().split(/\s+/).filter(w => w.length > 3));
        if (wordsA.size === 0 || wordsB.size === 0) return false;
        let intersection = 0;
        for (const w of wordsA) { if (wordsB.has(w)) intersection++; }
        return intersection / (wordsA.size + wordsB.size - intersection) > 0.5;
      });
      if (!isDupe) unique.push(fact);
    }

    console.error(`  [KnowledgeSync] ${domain}: ${unique.length} unique facts, distilling...`);

    if (!canCallInference()) {
      console.error(`  [KnowledgeSync] ${domain}: skipped (inference budget exhausted: ${budgetStatus()})`);
      skippedDomains++;
      emitKnowledgeSyncTelemetry({
        phase: 'domain',
        run_id: runId,
        mode: 'full',
        domain,
        status: 'skipped',
        reason: 'inference_budget_exhausted',
        facts: domainFacts.length,
        unique_facts: unique.length,
        ms: Date.now() - domainStart,
      });
      continue;
    }

    const content = await distillDomain(domain, unique);
    if (content) {
      recordInferenceCall('KnowledgeSync', domain);
      const persisted = persistDistilledKnowledge(domain, content, { runId, mode: 'full' });
      if (persisted.status === 'staged_disclosure_review') stagedDomains++;
      else updatedDomains++;
      emitKnowledgeSyncTelemetry({
        phase: 'domain',
        run_id: runId,
        mode: 'full',
        domain,
        status: persisted.status,
        facts: domainFacts.length,
        unique_facts: unique.length,
        output_chars: persisted.body.length,
        disclosure_findings: persisted.findings.length,
        staged_filename: persisted.stagedFilename,
        ms: Date.now() - domainStart,
      });
      if (persisted.status === 'staged_disclosure_review') {
        console.error(`  [KnowledgeSync] ${domain}: staged for disclosure review (${persisted.findings.length} finding(s)) [budget: ${budgetStatus()}]`);
      } else {
        console.error(`  [KnowledgeSync] ${domain}: ${persisted.status} (${persisted.body.length} chars) [budget: ${budgetStatus()}]`);
      }
    } else {
      skippedDomains++;
      emitKnowledgeSyncTelemetry({
        phase: 'domain',
        run_id: runId,
        mode: 'full',
        domain,
        status: 'skipped',
        reason: 'empty_distillation',
        facts: domainFacts.length,
        unique_facts: unique.length,
        ms: Date.now() - domainStart,
      });
    }
  }

  updateState(state, true);
  maybeAutoHarvest();
  maybeSynthesizePatterns();
  emitKnowledgeSyncTelemetry({
    phase: 'complete',
    run_id: runId,
    mode: 'full',
    status: 'complete',
    affected_domains: Object.keys(domainKeywords).length,
    updated_domains: updatedDomains,
    skipped_domains: skippedDomains,
    staged_domains: stagedDomains,
    memory_files_scanned: allMemoryFiles.length,
    ms: Date.now() - runStart,
  });
  console.error('[KnowledgeSync] Full harvest complete');
}

if (import.meta.main) { main(); }
