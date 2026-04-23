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
import { join } from 'path';
import { getPaiDir, paiPath } from './lib/paths';
import { inference } from '../PAI/Tools/Inference';
import { canCallInference, recordInferenceCall, budgetStatus } from './lib/inference-budget';
import { loadDomainKeywords, loadDomainDescriptions } from './lib/config-loader';

// ============================================================================
// Types
// ============================================================================

interface HarvestState {
  lastRun: string;
  lastFullHarvest?: string; // ISO timestamp of last full harvest
  fileMtimes: Record<string, number>; // path -> mtime ms
}

const FULL_HARVEST_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface ChangedFile {
  project: string;
  filename: string;
  path: string;
  content: string;
}

// ============================================================================
// Domain definitions — loaded from config/domains.jsonc via config-loader
// ============================================================================

const DOMAIN_KEYWORDS = loadDomainKeywords();
const DOMAIN_DESCRIPTIONS = loadDomainDescriptions();

// ============================================================================
// State management
// ============================================================================

const KNOWLEDGE_DIR = paiPath('MEMORY', 'KNOWLEDGE');
const STATE_FILE = join(KNOWLEDGE_DIR, '.harvest-state.json');

function loadState(): HarvestState {
  if (!existsSync(STATE_FILE)) {
    return { lastRun: '', fileMtimes: {} };
  }
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return { lastRun: '', fileMtimes: {} };
  }
}

function saveState(state: HarvestState): void {
  mkdirSync(KNOWLEDGE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
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

function identifyAffectedDomains(changedFiles: ChangedFile[]): Set<string> {
  const affected = new Set<string>();

  for (const file of changedFiles) {
    const text = (file.filename + ' ' + file.content.substring(0, 2000)).toLowerCase();

    // Score each domain, only take the top 1-2 with strong matches
    const scores: Array<{ domain: string; hits: number }> = [];
    for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
      const hits = keywords.filter(kw => text.includes(kw)).length;
      if (hits >= 3) { // Higher threshold to avoid false positives
        scores.push({ domain, hits });
      }
    }

    // Take at most the top 2 domains per file (a file rarely spans 3+ domains)
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

function extractFacts(content: string, filename: string): string[] {
  const facts: string[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    // Bold statements
    const boldMatches = line.matchAll(/\*\*(.+?)\*\*/g);
    for (const match of boldMatches) {
      if (match[1].length > 10 && match[1].length < 200) {
        facts.push(match[1]);
      }
    }

    // Meaningful bullets
    const bulletMatch = line.match(/^[-*]\s+(.{15,200})$/);
    if (bulletMatch) {
      facts.push(bulletMatch[1].replace(/\*\*/g, ''));
    }

    // Table data
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

  const description = DOMAIN_DESCRIPTIONS[domain] || domain;

  const systemPrompt = `You are a technical knowledge distiller. Given a list of extracted facts about "${description}", produce a concise reference document (~200-300 words). Format as markdown with 2-3 sections. Include only facts that would be useful for an engineering manager working with this technology daily. No introductions, no conclusions - just the distilled knowledge. Preserve specific details: names, versions, numbers, URLs.`;

  const userPrompt = `Domain: ${domain}\nDescription: ${description}\n\nExtracted facts (${cappedFacts.length} items):\n${cappedFacts.map((f, i) => `${i + 1}. ${f}`).join('\n')}`;

  // Try with 90s timeout, retry once on failure
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
// ============================================================================
// Auto-harvest reflections + auto-synthesize patterns
// ============================================================================

const REFLECTION_AUTO_HARVEST_THRESHOLD = 10;
const REFLECTION_FILE = join(getPaiDir(), 'MEMORY', 'LEARNING', 'REFLECTIONS', 'algorithm-reflections.jsonl');
const HARVEST_STATE_FILE = join(getPaiDir(), 'MEMORY', 'STATE', 'reflection-harvest-state.json');
const RATINGS_FILE = join(getPaiDir(), 'MEMORY', 'LEARNING', 'SIGNALS', 'ratings.jsonl');
const SYNTHESIS_STATE_FILE = join(getPaiDir(), 'MEMORY', 'STATE', 'synthesis-state.json');
const PATTERN_SYNTHESIS_THRESHOLD = 20;

function countLines(filePath: string): number {
  if (!existsSync(filePath)) return 0;
  try {
    return readFileSync(filePath, 'utf-8').trim().split('\n').filter(l => l.trim()).length;
  } catch { return 0; }
}

function spawnDetached(tool: string, args: string[] = []): void {
  const { spawn } = require('child_process');
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
    const totalRatings = countLines(RATINGS_FILE);
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
    // Update synthesis state
    mkdirSync(join(getPaiDir(), 'MEMORY', 'STATE'), { recursive: true });
    writeFileSync(SYNTHESIS_STATE_FILE, JSON.stringify({ lastRatingCount: totalRatings, lastRun: new Date().toISOString() }, null, 2));
  } catch (err) {
    console.error(`[KnowledgeSync] Pattern synthesis check failed (non-fatal): ${err}`);
  }
}


// ============================================================================

async function main() {
  try {
    // Quick exit if KNOWLEDGE/ doesn't exist yet (run full harvester first)
    if (!existsSync(KNOWLEDGE_DIR)) {
      console.error('[KnowledgeSync] No KNOWLEDGE/ directory - run KnowledgeHarvester.ts first');
      process.exit(0);
    }

    // Load previous state
    const state = loadState();

    // Check if a full harvest is overdue (>7 days since last full run)
    const needsFullHarvest = !state.lastFullHarvest ||
      (Date.now() - new Date(state.lastFullHarvest).getTime()) > FULL_HARVEST_INTERVAL_MS;

    if (needsFullHarvest) {
      console.error('[KnowledgeSync] Full harvest overdue — re-distilling ALL domains');
      await runFullHarvest(state);
      process.exit(0);
    }

    // Detect changed memory files
    const changedFiles = detectChanges(state);

    if (changedFiles.length === 0) {
      console.error('[KnowledgeSync] No memory file changes detected - skipping');
      process.exit(0);
    }

    console.error(`[KnowledgeSync] ${changedFiles.length} memory files changed`);

    // Identify which domains need re-distillation
    const affectedDomains = identifyAffectedDomains(changedFiles);

    if (affectedDomains.size === 0) {
      console.error('[KnowledgeSync] Changed files don\'t affect any knowledge domains - skipping');
      // Still update state so we don't re-check these files
      updateState(state);
      process.exit(0);
    }

    console.error(`[KnowledgeSync] Re-distilling ${affectedDomains.size} domains: ${Array.from(affectedDomains).join(', ')}`);

    // For each affected domain, gather ALL facts (not just from changed files)
    // because the distillation needs the full picture
    const allMemoryFiles = scanMemoryFiles();

    for (const domain of affectedDomains) {
      const keywords = DOMAIN_KEYWORDS[domain];
      if (!keywords) continue;

      // Gather facts from ALL memory files relevant to this domain
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
        continue;
      }

      // Deduplicate
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

      // Check inference budget before LLM call
      if (!canCallInference()) {
        console.error(`  [KnowledgeSync] ${domain}: skipped (inference budget exhausted: ${budgetStatus()})`);
        continue;
      }

      const content = await distillDomain(domain, unique);
      if (content) {
        recordInferenceCall('KnowledgeSync', domain);
        writeFileSync(join(KNOWLEDGE_DIR, `${domain}.md`), content + '\n');
        console.error(`  [KnowledgeSync] ${domain}: updated (${content.length} chars) [budget: ${budgetStatus()}]`);
      }
    }

    // Update state with current mtimes
    updateState(state);

    // Auto-trigger background tools if thresholds met
    maybeAutoHarvest();
    maybeSynthesizePatterns();

    console.error('[KnowledgeSync] Done');
    process.exit(0);
  } catch (error) {
    console.error('[KnowledgeSync] Error:', error);
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

// Full harvest: re-distill ALL domains (runs when >7 days since last full harvest)
async function runFullHarvest(state: HarvestState): Promise<void> {
  const allMemoryFiles = scanMemoryFiles();
  console.error(`[KnowledgeSync] Full harvest: scanning ${allMemoryFiles.length} memory files across all projects`);

  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
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
      continue;
    }

    // Deduplicate
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

    // Check inference budget before LLM call
    if (!canCallInference()) {
      console.error(`  [KnowledgeSync] ${domain}: skipped (inference budget exhausted: ${budgetStatus()})`);
      continue;
    }

    const content = await distillDomain(domain, unique);
    if (content) {
      recordInferenceCall('KnowledgeSync', domain);
      writeFileSync(join(KNOWLEDGE_DIR, `${domain}.md`), content + '\n');
      console.error(`  [KnowledgeSync] ${domain}: updated (${content.length} chars) [budget: ${budgetStatus()}]`);
    }
  }

  updateState(state, true);
  maybeAutoHarvest();
  maybeSynthesizePatterns();
  console.error('[KnowledgeSync] Full harvest complete');
}

main();
