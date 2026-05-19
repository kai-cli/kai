#!/usr/bin/env bun
/**
 * AutoConsolidate.ts — Guard-railed auto-promotion of STAGING entries to WISDOM.
 *
 * Rules (ALL must be true for promotion):
 * - STAGING entry has been pending ≥14 days
 * - Entry confidence ≥ 0.8
 * - No conflicting entries in WISDOM/FRAMES (text similarity check)
 * - Entry does NOT contain uncertainty language ("maybe", "might", "not sure")
 * - Maximum 3 promotions per run
 *
 * Trigger: Called by SessionCleanup.hook.ts (daily check) or manually.
 *
 * Usage: bun PAI/Tools/AutoConsolidate.ts [--dry-run] [--json]
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, renameSync, readdirSync } from 'fs';
import { join } from 'path';
import { parseArgs } from 'util';
import { paiPath } from '../../hooks/lib/paths';
import { listDrafts, type DraftMemory } from '../../hooks/lib/staging';

export interface PromotionCandidate {
  draft: DraftMemory;
  eligible: boolean;
  reason?: string;
}

export interface ConsolidationResult {
  candidates: PromotionCandidate[];
  promoted: string[];
  skipped: string[];
  dryRun: boolean;
}

const MAX_PROMOTIONS_PER_RUN = 3;
const MIN_AGE_DAYS = 14;
const MIN_CONFIDENCE = 0.8;
const UNCERTAINTY_WORDS = ['maybe', 'might', 'not sure', 'possibly', 'uncertain', 'unclear'];
const PROMOTIONS_LOG = () => paiPath('MEMORY', 'STATE', 'auto-promotions.jsonl');
const WISDOM_FRAMES_DIR = () => paiPath('MEMORY', 'WISDOM', 'FRAMES');

/**
 * Evaluate and optionally promote eligible STAGING entries.
 */
export function consolidate(dryRun = false): ConsolidationResult {
  const drafts = listDrafts();
  const candidates: PromotionCandidate[] = [];
  const promoted: string[] = [];
  const skipped: string[] = [];

  const existingWisdom = loadExistingWisdom();

  for (const draft of drafts) {
    const check = evaluateCandidate(draft, existingWisdom);
    candidates.push(check);

    if (!check.eligible) {
      skipped.push(`${draft.title}: ${check.reason}`);
      continue;
    }

    if (promoted.length >= MAX_PROMOTIONS_PER_RUN) {
      skipped.push(`${draft.title}: max promotions per run reached`);
      continue;
    }

    if (!dryRun) {
      promoteDraft(draft);
      logPromotion(draft);
    }
    promoted.push(draft.title);
  }

  return { candidates, promoted, skipped, dryRun };
}

/**
 * Evaluate whether a single draft meets all promotion criteria.
 */
export function evaluateCandidate(draft: DraftMemory, existingWisdom: string[]): PromotionCandidate {
  const ageDays = (Date.now() - new Date(draft.generated).getTime()) / (1000 * 60 * 60 * 24);

  if (ageDays < MIN_AGE_DAYS) {
    return { draft, eligible: false, reason: `too young (${Math.floor(ageDays)}d < ${MIN_AGE_DAYS}d)` };
  }

  if (draft.confidence < MIN_CONFIDENCE) {
    return { draft, eligible: false, reason: `low confidence (${draft.confidence} < ${MIN_CONFIDENCE})` };
  }

  const contentLower = draft.content.toLowerCase();
  for (const word of UNCERTAINTY_WORDS) {
    if (contentLower.includes(word)) {
      return { draft, eligible: false, reason: `contains uncertainty language: "${word}"` };
    }
  }

  if (hasSimilarWisdom(draft.content, existingWisdom)) {
    return { draft, eligible: false, reason: 'similar entry already exists in WISDOM/FRAMES' };
  }

  return { draft, eligible: true };
}

function loadExistingWisdom(): string[] {
  const dir = WISDOM_FRAMES_DIR();
  if (!existsSync(dir)) return [];

  try {
    const files = readdirSync(dir).filter(f => f.endsWith('.md'));
    const entries: string[] = [];
    for (const file of files) {
      const content = readFileSync(join(dir, file), 'utf-8');
      entries.push(content.toLowerCase());
    }
    return entries;
  } catch {
    return [];
  }
}

function hasSimilarWisdom(newContent: string, existing: string[]): boolean {
  const normalize = (text: string) => new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 4)
  );

  const newWords = normalize(newContent);

  for (const entry of existing) {
    const entryWords = normalize(entry);
    const overlap = [...newWords].filter(w => entryWords.has(w)).length;
    const similarity = overlap / Math.max(newWords.size, 1);
    if (similarity > 0.7) return true;
  }

  return false;
}

function promoteDraft(draft: DraftMemory): void {
  const framesDir = WISDOM_FRAMES_DIR();
  mkdirSync(framesDir, { recursive: true });

  const existingFrames = existsSync(join(framesDir, 'algorithm.md'))
    ? readFileSync(join(framesDir, 'algorithm.md'), 'utf-8')
    : '';

  // Append promoted content as new entries to the frames file
  const promotedEntry = formatAsFrame(draft);
  const updated = existingFrames.trimEnd() + '\n\n' + promotedEntry + '\n';
  writeFileSync(join(framesDir, 'algorithm.md'), updated);

  // Archive the staging file
  const stagingDir = paiPath('MEMORY', 'STAGING');
  const archiveDir = join(stagingDir, '.archive');
  mkdirSync(archiveDir, { recursive: true });
  const srcPath = join(stagingDir, draft.filename);
  if (existsSync(srcPath)) {
    renameSync(srcPath, join(archiveDir, draft.filename));
  }
}

function formatAsFrame(draft: DraftMemory): string {
  // Extract numbered items from draft content, convert to frame entries
  const lines = draft.content.split('\n').filter(l => /^\d+\./.test(l.trim()));
  if (lines.length === 0) {
    return `### ${draft.title} [CRYSTAL: 80%]\n${draft.content.trim().split('\n')[0]}`;
  }

  return lines.map(line => {
    const text = line.replace(/^\d+\.\s*/, '').trim();
    const title = text.split(/[.;]/)[0];
    return `### ${title} [CRYSTAL: 80%]\n${text}`;
  }).join('\n\n');
}

function logPromotion(draft: DraftMemory): void {
  const logPath = PROMOTIONS_LOG();
  mkdirSync(join(logPath, '..'), { recursive: true });
  const entry = {
    timestamp: new Date().toISOString(),
    filename: draft.filename,
    title: draft.title,
    confidence: draft.confidence,
    source: 'auto-consolidate',
  };
  appendFileSync(logPath, JSON.stringify(entry) + '\n');
}

/**
 * Format consolidation result for CLI output.
 */
export function formatConsolidationResult(result: ConsolidationResult): string {
  const lines: string[] = [
    '## Auto-Consolidation Report',
    '',
    `Mode: ${result.dryRun ? 'DRY RUN' : 'LIVE'}`,
    `Candidates evaluated: ${result.candidates.length}`,
    `Promoted: ${result.promoted.length}`,
    `Skipped: ${result.skipped.length}`,
    '',
  ];

  if (result.promoted.length > 0) {
    lines.push('### Promoted to WISDOM/FRAMES');
    for (const p of result.promoted) {
      lines.push(`  ✅ ${p}`);
    }
    lines.push('');
  }

  if (result.skipped.length > 0) {
    lines.push('### Skipped');
    for (const s of result.skipped) {
      lines.push(`  ⏭️ ${s}`);
    }
    lines.push('');
  }

  if (result.candidates.length === 0) {
    lines.push('No staging entries pending. Nothing to consolidate.');
  }

  return lines.join('\n');
}

// --- CLI ---
if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      'dry-run': { type: 'boolean' },
      json: { type: 'boolean' },
    },
    allowPositionals: true,
  });

  const result = consolidate(values['dry-run'] ?? false);

  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatConsolidationResult(result));
  }
}
