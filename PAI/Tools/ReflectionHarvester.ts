#!/usr/bin/env bun
/**
 * ReflectionHarvester.ts - Extract behavioral lessons from algorithm reflections
 *
 * Reads algorithm-reflections.jsonl, deduplicates similar entries via Jaccard
 * similarity, synthesizes recurring patterns into 3-7 behavioral lessons using
 * LLM inference, then writes drafts to MEMORY/STAGING/ for human review.
 *
 * All lessons require human approval via `pai curate` before injection.
 *
 * Usage:
 *   pai harvest              Run harvest (synthesize if >20 new reflections)
 *   pai harvest --force      Force re-synthesis even if not enough new entries
 *   pai harvest --dry-run    Show what would be synthesized, no writes
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { paiPath } from '../../hooks/lib/paths';
import { writeDraft } from '../../hooks/lib/staging';
import { inference } from './Inference';

const REFLECTIONS_FILE = paiPath('MEMORY', 'LEARNING', 'REFLECTIONS', 'algorithm-reflections.jsonl');
const HARVEST_STATE_FILE = paiPath('MEMORY', 'STATE', 'reflection-harvest-state.json');
const MIN_NEW_REFLECTIONS = 10; // minimum new entries before re-synthesizing
const MAX_LESSONS = 7;
const JACCARD_THRESHOLD = 0.45; // entries with > this overlap are considered duplicates

// ============================================================================
// Types
// ============================================================================

interface Reflection {
  timestamp: string;
  effort_level: string;
  task_description: string;
  reflection_q1?: string; // pre-flight / should have done X
  reflection_q2?: string; // thresholds / measurements
  reflection_q3?: string; // capabilities
  reflection_q4?: string; // additional pattern
  implied_sentiment?: number;
  criteria_count?: number;
  criteria_passed?: number;
}

interface HarvestState {
  lastRun: string;
  lastReflectionCount: number;
  lessonsGenerated: number;
}

// ============================================================================
// State management
// ============================================================================

function loadHarvestState(): HarvestState {
  if (!existsSync(HARVEST_STATE_FILE)) {
    return { lastRun: '', lastReflectionCount: 0, lessonsGenerated: 0 };
  }
  try {
    return JSON.parse(readFileSync(HARVEST_STATE_FILE, 'utf-8'));
  } catch {
    return { lastRun: '', lastReflectionCount: 0, lessonsGenerated: 0 };
  }
}

function saveHarvestState(state: HarvestState): void {
  mkdirSync(join(HARVEST_STATE_FILE, '..'), { recursive: true });
  writeFileSync(HARVEST_STATE_FILE, JSON.stringify(state, null, 2));
}

// ============================================================================
// Load reflections
// ============================================================================

function loadReflections(): Reflection[] {
  if (!existsSync(REFLECTIONS_FILE)) return [];
  try {
    return readFileSync(REFLECTIONS_FILE, 'utf-8')
      .trim()
      .split('\n')
      .filter(l => l.trim())
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean) as Reflection[];
  } catch {
    return [];
  }
}

// ============================================================================
// Jaccard deduplication
// ============================================================================

export function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .split(/\W+/)
      .filter(w => w.length > 3)
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) { if (b.has(w)) intersection++; }
  return intersection / (a.size + b.size - intersection);
}

/**
 * Extract all insight text from a reflection entry.
 */
function reflectionText(r: Reflection): string {
  return [r.reflection_q1, r.reflection_q2, r.reflection_q3, r.reflection_q4]
    .filter(Boolean)
    .join(' ');
}

/**
 * Deduplicate reflections by Jaccard similarity.
 * Returns unique entries keeping the most recent of similar ones.
 */
export function deduplicate(reflections: Reflection[]): Reflection[] {
  const sorted = [...reflections].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  const unique: Reflection[] = [];
  const usedTokens: Set<string>[] = [];

  for (const r of sorted) {
    const text = reflectionText(r);
    if (!text.trim()) continue;

    const tokens = tokenize(text);
    const isDupe = usedTokens.some(existing => jaccard(tokens, existing) > JACCARD_THRESHOLD);

    if (!isDupe) {
      unique.push(r);
      usedTokens.push(tokens);
    }
  }

  return unique;
}

// ============================================================================
// Pattern extraction (before LLM)
// ============================================================================

interface PatternGroup {
  theme: string;
  entries: string[];
  count: number;
}

/**
 * Group reflections into recurring themes by keyword clustering.
 * Returns top themes with highest frequency.
 */
export function extractPatternGroups(reflections: Reflection[]): PatternGroup[] {
  const themeKeywords: Record<string, string[]> = {
    'parallelize-work':      ['parallel', 'paralleliz', 'concurrent', 'batch', 'simultaneously'],
    'read-files-first':      ['should have read', 'read first', 'pre-flight', 'upfront', 'earlier'],
    'capability-selection':  ['capability', 'skill', 'agent', 'should have used', 'could have used'],
    'context-compaction':    ['compaction', 'context lost', 'reconstruction', 'resumed', 'continuity'],
    'measure-before-plan':   ['measured', 'count', 'threshold', 'baseline', 'quantity', 'metric'],
    'agent-delegation':      ['delegat', 'subagent', 'spawn', 'council', 'parallel agent'],
  };

  const groups: Record<string, PatternGroup> = {};
  for (const theme of Object.keys(themeKeywords)) {
    groups[theme] = { theme, entries: [], count: 0 };
  }

  for (const r of reflections) {
    const text = reflectionText(r).toLowerCase();
    for (const [theme, keywords] of Object.entries(themeKeywords)) {
      if (keywords.some(kw => text.includes(kw))) {
        groups[theme].count++;
        const excerpt = reflectionText(r).substring(0, 120);
        if (groups[theme].entries.length < 5) {
          groups[theme].entries.push(excerpt);
        }
      }
    }
  }

  return Object.values(groups)
    .filter(g => g.count >= 2)
    .sort((a, b) => b.count - a.count);
}

// ============================================================================
// LLM synthesis
// ============================================================================

async function synthesizeLessons(
  reflections: Reflection[],
  patterns: PatternGroup[]
): Promise<string[] | null> {
  const totalReflections = reflections.length;

  // Build a compact summary of patterns + a sample of reflection text
  const patternSummary = patterns.slice(0, 6).map(p =>
    `[${p.theme}] (${p.count} occurrences): ${p.entries.slice(0, 2).join(' | ')}`
  ).join('\n');

  // Sample 8 most recent unique reflections (keep prompt lean for Haiku)
  const sample = reflections.slice(0, 8).map(r => {
    const insights = [r.reflection_q1, r.reflection_q2, r.reflection_q3]
      .filter(Boolean).join(' / ');
    return `• ${insights}`;
  }).join('\n');

  const systemPrompt = `Extract 3-7 actionable behavioral lessons from AI performance reflections. Each lesson ≤25 words, actionable, backed by recurring pattern. JSON only: {"lessons":["..."]}`;

  const userPrompt = `Patterns (${patterns.length} recurring themes):
${patternSummary}

Sample reflections (${Math.min(8, totalReflections)} of ${totalReflections}):
${sample}

Output JSON {"lessons":[...]} only.`;

  const result = await inference({
    systemPrompt,
    userPrompt,
    level: 'fast',
    expectJson: true,
    timeout: 60000,
  });

  if (!result.success || !result.parsed) {
    console.error(`[ReflectionHarvester] LLM synthesis failed: ${result.error}`);
    return null;
  }

  const parsed = result.parsed as { lessons?: string[] };
  if (!Array.isArray(parsed.lessons) || parsed.lessons.length === 0) {
    console.error('[ReflectionHarvester] No lessons in LLM response');
    return null;
  }

  return parsed.lessons.slice(0, MAX_LESSONS);
}

// ============================================================================
// Write lessons to staging
// ============================================================================

function writeLessonsToStaging(lessons: string[], reflectionCount: number, dryRun: boolean): void {
  if (dryRun) {
    console.log(`\n[ReflectionHarvester] DRY RUN — would write ${lessons.length} lessons to STAGING:`);
    lessons.forEach((l, i) => console.log(`  ${i + 1}. ${l}`));
    return;
  }

  const content = lessons.map((l, i) => `${i + 1}. ${l}`).join('\n');
  const title = `Behavioral lessons from ${reflectionCount} algorithm reflections`;

  const filename = writeDraft({
    type: 'pattern-insight',
    sourceSession: 'reflection-harvester',
    confidence: 0.8,
    generated: new Date().toISOString(),
    targetProject: 'pai-config',
    targetFilename: 'feedback_reflection_lessons.md',
    title,
    content: `# ${title}\n\n${content}\n\n---\n*Generated by ReflectionHarvester from ${reflectionCount} unique reflections*\n*Review and approve via: pai curate*`,
  });

  console.log(`[ReflectionHarvester] Written to STAGING: ${filename}`);
  console.log(`[ReflectionHarvester] Review with: pai curate drafts`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const force  = args.includes('--force');

  const state = loadHarvestState();
  const reflections = loadReflections();

  if (reflections.length === 0) {
    console.log('[ReflectionHarvester] No reflections found. Run Algorithm sessions first.');
    process.exit(0);
  }

  const newCount = reflections.length - state.lastReflectionCount;

  if (!force && newCount < MIN_NEW_REFLECTIONS) {
    console.log(`[ReflectionHarvester] Only ${newCount} new reflections since last run (need ${MIN_NEW_REFLECTIONS}). Use --force to override.`);
    console.log(`[ReflectionHarvester] Total: ${reflections.length} reflections`);
    process.exit(0);
  }

  console.log(`[ReflectionHarvester] Processing ${reflections.length} reflections (${newCount} new since last run)`);

  // Deduplicate
  const unique = deduplicate(reflections);
  console.log(`[ReflectionHarvester] After dedup: ${unique.length} unique reflections (removed ${reflections.length - unique.length} similar)`);

  // Extract pattern groups
  const patterns = extractPatternGroups(unique);
  console.log(`[ReflectionHarvester] ${patterns.length} recurring patterns found:`);
  patterns.forEach(p => console.log(`  [${p.theme}] ${p.count} occurrences`));

  if (patterns.length === 0) {
    console.log('[ReflectionHarvester] No recurring patterns (need ≥2 occurrences per theme). More data needed.');
    process.exit(0);
  }

  // LLM synthesis
  console.log('[ReflectionHarvester] Synthesizing lessons via LLM...');
  const lessons = await synthesizeLessons(unique, patterns);

  if (!lessons) {
    console.error('[ReflectionHarvester] Synthesis failed. Check LLM connectivity.');
    process.exit(0);
  }

  console.log(`[ReflectionHarvester] Extracted ${lessons.length} lessons:`);
  lessons.forEach((l, i) => console.log(`  ${i + 1}. ${l}`));

  // Write to staging
  writeLessonsToStaging(lessons, unique.length, dryRun);

  // Update state
  if (!dryRun) {
    saveHarvestState({
      lastRun: new Date().toISOString(),
      lastReflectionCount: reflections.length,
      lessonsGenerated: (state.lessonsGenerated || 0) + lessons.length,
    });
  }

  console.log('[ReflectionHarvester] Done.');
}

if (import.meta.main) {
  main().catch(err => {
    console.error('[ReflectionHarvester] Error:', err);
    process.exit(0);
  });
}
