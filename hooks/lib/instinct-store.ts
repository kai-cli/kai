/**
 * instinct-store.ts — CRUD, decay, and archival for behavioral instincts
 *
 * Confidence rules:
 *   New: 0.3 | Reinforcement: +0.2 (cap 1.0) | Decay: -0.1/30 days (floor 0.0)
 *   Surface threshold: 0.5 | Evolution threshold: 0.8 | Hard cap: 100 active
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { findDuplicate } from './instinct-dedup';
import { clusterByEmbedding, type InstinctCluster } from './instinct-cluster';

export interface Instinct {
  id: string;
  text: string;
  confidence: number;
  tags: string[];
  created: string;
  last_triggered: string;
  last_decayed_at: string;
  trigger_count: number;
  source: 'correction' | 'repetition' | 'revert' | 'rating';
  context: string;
  active: boolean;
}

const ACTIVE_FILE = 'MEMORY/LEARNING/INSTINCTS/instincts.jsonl';
const ARCHIVE_FILE = 'MEMORY/LEARNING/INSTINCTS/instincts-archived.jsonl';
const MAX_ACTIVE = 100;
const INITIAL_CONFIDENCE = 0.3;
const REINFORCEMENT_DELTA = 0.2;
const DECAY_DELTA = 0.1;
const DECAY_PERIOD_DAYS = 30;
const SURFACE_THRESHOLD = 0.5;
const EVOLVE_THRESHOLD = 0.8;
const MAX_SURFACED = 20;

const MS_PER_DAY = 86_400_000;

export { SURFACE_THRESHOLD, EVOLVE_THRESHOLD, MAX_SURFACED, MAX_ACTIVE };

function instinctsPath(paiDir: string): string {
  return join(paiDir, ACTIVE_FILE);
}

function archivePath(paiDir: string): string {
  return join(paiDir, ARCHIVE_FILE);
}

export function loadInstincts(paiDir: string): Instinct[] {
  const path = instinctsPath(paiDir);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, 'utf-8')
      .trim()
      .split('\n')
      .filter(l => l.trim())
      .map(l => JSON.parse(l) as Instinct)
      .filter(i => i.active);
  } catch {
    return [];
  }
}

function saveInstincts(paiDir: string, instincts: Instinct[]): void {
  const path = instinctsPath(paiDir);
  mkdirSync(join(paiDir, 'MEMORY', 'LEARNING', 'INSTINCTS'), { recursive: true });
  writeFileSync(path, instincts.map(i => JSON.stringify(i)).join('\n') + '\n');
}

function appendArchive(paiDir: string, instinct: Instinct): void {
  const path = archivePath(paiDir);
  mkdirSync(join(paiDir, 'MEMORY', 'LEARNING', 'INSTINCTS'), { recursive: true });
  const entry = JSON.stringify({ ...instinct, active: false }) + '\n';
  writeFileSync(path, (existsSync(path) ? readFileSync(path, 'utf-8') : '') + entry);
}

function generateId(): string {
  return 'inst_' + Math.random().toString(36).slice(2, 9);
}

/**
 * Extract deterministic tags from instinct text + cwd.
 * Returns up to 5 tags: project, directory, then content keywords.
 */
const TOOL_KEYWORDS = ['bun', 'git', 'npm', 'grep', 'curl', 'tsc', 'node', 'yarn', 'pnpm', 'docker', 'bash', 'zsh'];
const DOMAIN_KEYWORDS = ['testing', 'deployment', 'memory', 'hook', 'algorithm', 'skill', 'agent', 'config', 'session', 'context', 'typescript', 'javascript'];

export function extractTags(text: string, cwd: string): string[] {
  const tags: string[] = [];

  // Project tag from cwd
  const projectMatch = cwd.match(/\/Projects\/([^/]+)/);
  if (projectMatch) tags.push(projectMatch[1]);

  // Directory tag (immediate parent within project)
  const dirMatch = cwd.match(/\/Projects\/[^/]+\/([^/]+)/);
  if (dirMatch && dirMatch[1] !== projectMatch?.[1]) tags.push(dirMatch[1]);

  // Content tags from text
  const lower = text.toLowerCase();
  for (const kw of [...TOOL_KEYWORDS, ...DOMAIN_KEYWORDS]) {
    if (lower.includes(kw) && !tags.includes(kw)) {
      tags.push(kw);
    }
    if (tags.length >= 5) break;
  }

  return tags.slice(0, 5);
}

export function createInstinct(
  paiDir: string,
  text: string,
  source: Instinct['source'],
  context: string,
  cwd: string = process.cwd()
): Instinct {
  const now = new Date().toISOString();
  const instinct: Instinct = {
    id: generateId(),
    text,
    confidence: INITIAL_CONFIDENCE,
    tags: extractTags(text, cwd),
    created: now,
    last_triggered: now,
    last_decayed_at: now,
    trigger_count: 1,
    source,
    context,
    active: true,
  };

  let instincts = loadInstincts(paiDir);

  // Dedup: prefix-match (≥30 chars) as fast path
  const prefixMatch = instincts.find(i => {
    const overlap = Math.min(i.text.length, text.length);
    return overlap >= 30 && i.text.substring(0, overlap) === text.substring(0, overlap);
  });

  if (prefixMatch) {
    return reinforceInstinct(paiDir, prefixMatch.id);
  }

  instincts.push(instinct);

  // Enforce hard cap
  if (instincts.length > MAX_ACTIVE) {
    const sorted = [...instincts].sort((a, b) => a.confidence - b.confidence);
    const toArchive = sorted[0];
    archiveInstinct(paiDir, toArchive.id);
    instincts = instincts.filter(i => i.id !== toArchive.id);
  }

  saveInstincts(paiDir, instincts);
  return instinct;
}

/**
 * Async version of createInstinct that performs semantic dedup via embeddings.
 * Falls back to prefix-match if embeddings unavailable.
 */
export async function createInstinctWithDedup(
  paiDir: string,
  text: string,
  source: Instinct['source'],
  context: string,
  cwd: string = process.cwd()
): Promise<Instinct> {
  const instincts = loadInstincts(paiDir);

  // Semantic dedup check (async — uses embeddings)
  try {
    const duplicateId = await findDuplicate(paiDir, text, instincts);
    if (duplicateId) {
      return reinforceInstinct(paiDir, duplicateId);
    }
  } catch {
    // Embedding unavailable — fall through to sync createInstinct
  }

  return createInstinct(paiDir, text, source, context, cwd);
}

export function reinforceInstinct(paiDir: string, id: string): Instinct {
  const instincts = loadInstincts(paiDir);
  const idx = instincts.findIndex(i => i.id === id);
  if (idx < 0) throw new Error(`Instinct ${id} not found`);

  const now = new Date().toISOString();
  instincts[idx] = {
    ...instincts[idx],
    confidence: Math.min(1.0, instincts[idx].confidence + REINFORCEMENT_DELTA),
    last_triggered: now,
    trigger_count: instincts[idx].trigger_count + 1,
  };

  saveInstincts(paiDir, instincts);
  return instincts[idx];
}

export function archiveInstinct(paiDir: string, id: string): void {
  let instincts = loadInstincts(paiDir);
  const instinct = instincts.find(i => i.id === id);
  if (!instinct) return;

  appendArchive(paiDir, instinct);
  instincts = instincts.filter(i => i.id !== id);
  saveInstincts(paiDir, instincts);
}

/**
 * Apply decay at session start. Uses last_decayed_at to prevent double-application.
 * Returns count of archived instincts.
 */
export function decayInstincts(paiDir: string): number {
  const instincts = loadInstincts(paiDir);
  const now = Date.now();
  let archivedCount = 0;
  const updated: Instinct[] = [];
  const toArchive: Instinct[] = [];

  for (const instinct of instincts) {
    const lastDecay = instinct.last_decayed_at
      ? new Date(instinct.last_decayed_at).getTime()
      : new Date(instinct.created).getTime();
    const daysSinceDecay = (now - lastDecay) / MS_PER_DAY;

    if (daysSinceDecay >= DECAY_PERIOD_DAYS) {
      const newPeriods = Math.floor(daysSinceDecay / DECAY_PERIOD_DAYS);
      const newConfidence = Math.max(0.0, instinct.confidence - (DECAY_DELTA * newPeriods));
      const decayed = {
        ...instinct,
        confidence: newConfidence,
        last_decayed_at: new Date(now).toISOString(),
      };

      if (newConfidence === 0.0) {
        toArchive.push(decayed);
        archivedCount++;
      } else {
        updated.push(decayed);
      }
    } else {
      updated.push(instinct);
    }
  }

  const path = instinctsPath(paiDir);
  mkdirSync(join(paiDir, 'MEMORY', 'LEARNING', 'INSTINCTS'), { recursive: true });
  writeFileSync(path, updated.map(i => JSON.stringify(i)).join('\n') + (updated.length ? '\n' : ''));

  for (const a of toArchive) {
    appendArchive(paiDir, a);
  }

  return archivedCount;
}

/**
 * Return instincts relevant to current project/directory, ranked by relevance + confidence.
 * Capped at MAX_SURFACED entries with confidence ≥ SURFACE_THRESHOLD.
 */
export function surfaceInstincts(paiDir: string, cwd: string = process.cwd()): Instinct[] {
  const instincts = loadInstincts(paiDir).filter(i => i.confidence >= SURFACE_THRESHOLD);

  const projectMatch = cwd.match(/\/Projects\/([^/]+)/);
  const project = projectMatch?.[1] ?? '';
  const dirMatch = cwd.match(/\/Projects\/[^/]+\/([^/]+)/);
  const dir = dirMatch?.[1] ?? '';

  const scored = instincts.map(i => {
    let score = i.confidence;
    if (project && i.tags.includes(project)) score += 0.3;
    if (dir && i.tags.includes(dir)) score += 0.2;
    const lastTrigger = Date.now() - new Date(i.last_triggered).getTime();
    score += Math.max(0, 0.1 - (lastTrigger / (30 * MS_PER_DAY)));
    return { instinct: i, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SURFACED)
    .map(s => s.instinct);
}

/**
 * Format surfaced instincts as context string (≤500 tokens estimate).
 */
export function formatInstinctContext(instincts: Instinct[]): string {
  if (instincts.length === 0) return '';
  const lines = instincts.map(i =>
    `• [${(i.confidence * 100).toFixed(0)}%] ${i.text}`
  );
  return `## Behavioral Instincts\n\n${lines.join('\n')}\n`;
}

/**
 * Cluster instincts by shared tags for /evolve dashboard.
 * Returns groups with ≥2 shared tags AND confidence ≥0.8 AND trigger_count ≥3.
 */
export function clusterInstincts(instincts: Instinct[]): Array<{ tags: string[]; instincts: Instinct[] }> {
  const candidates = instincts.filter(i => i.confidence >= EVOLVE_THRESHOLD && i.trigger_count >= 3);
  const clusters: Array<{ tags: string[]; instincts: Instinct[] }> = [];
  const used = new Set<string>();

  for (const a of candidates) {
    if (used.has(a.id)) continue;
    const group = [a];

    for (const b of candidates) {
      if (b.id === a.id || used.has(b.id)) continue;
      const sharedTags = a.tags.filter(t => b.tags.includes(t));
      if (sharedTags.length >= 2) {
        group.push(b);
        used.add(b.id);
      }
    }

    if (group.length >= 2) {
      const allTags = [...new Set(group.flatMap(i => i.tags))];
      clusters.push({ tags: allTags, instincts: group });
      group.forEach(i => used.add(i.id));
    }
  }

  return clusters;
}

/**
 * Cluster instincts by embedding similarity for /evolve.
 * Falls back to tag-based clustering if no vector cache exists.
 */
export function getClusteredInstincts(paiDir: string): InstinctCluster[] {
  const instincts = loadInstincts(paiDir);
  const embeddingClusters = clusterByEmbedding(paiDir, instincts);
  if (embeddingClusters.length > 0) return embeddingClusters;
  // Fallback: tag-based clustering (v5.6 behavior)
  const tagClusters = clusterInstincts(instincts);
  return tagClusters.map(c => ({
    instincts: c.instincts,
    centroidScore: 0,
    promotable: c.instincts.every(i => i.confidence >= EVOLVE_THRESHOLD && i.trigger_count >= 3),
  }));
}

export function getInstinctStats(paiDir: string): {
  active: number;
  eligible: number;
  archived: number;
  avgConfidence: number;
} {
  const active = loadInstincts(paiDir);
  const archiveLine = existsSync(archivePath(paiDir))
    ? readFileSync(archivePath(paiDir), 'utf-8').trim().split('\n').filter(l => l).length
    : 0;

  const avg = active.length
    ? active.reduce((s, i) => s + i.confidence, 0) / active.length
    : 0;

  return {
    active: active.length,
    eligible: active.filter(i => i.confidence >= SURFACE_THRESHOLD).length,
    archived: archiveLine,
    avgConfidence: Math.round(avg * 100) / 100,
  };
}
