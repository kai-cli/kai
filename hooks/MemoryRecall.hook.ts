#!/usr/bin/env bun
/**
 * MemoryRecall.hook.ts — Surface relevant project memories on every user prompt
 *
 * TRIGGER: UserPromptSubmit
 *
 * PURPOSE: Bridges the attention gap between project MEMORY.md (loaded in system
 * prompt, low salience) and user messages (high salience). Re-injects relevant
 * memory entries as additionalContext RIGHT NEXT TO the user's prompt.
 *
 * ARCHITECTURE:
 * - Discovers project MEMORY.md via CLAUDE_PROJECT_DIR path convention
 * - Extracts keywords from each entry's description text
 * - Keyword-matches against user prompt (case-insensitive, word boundary)
 * - Injects matched entries (max 5) as <memory-recall> additionalContext
 * - Universal: works for any project with a MEMORY.md index
 *
 * PERFORMANCE: ~30ms typical (Bun startup + regex matching, no LLM)
 * COST: ~200-500 tokens when memories match; 0 tokens when no match
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { readHookInput } from './lib/hook-io';
import { encodeProjectDir } from './lib/paths';
import { rankEntries, type MemoryEntry as ScorerEntry } from './lib/memory-scorer';

interface MemoryEntry {
  title: string;
  file: string;
  description: string;
  keywords: string[];
  category?: string;
}

/**
 * W2: composite-scorer config. Read from PAI config/settings.json (feature flags),
 * NOT the harness root settings.json. `useScorer` defaults to true (the scorer is
 * activated); set false for instant rollback to the original keyword top-5 path.
 */
interface MemoryRecallSettings {
  useScorer: boolean;
  tokenBudget: number;
  maxCandidates: number;
}

function loadMemoryRecallSettings(): MemoryRecallSettings {
  // tokenBudget is a downstream "reading budget" accounted on memory BODIES (each surfaced
  // pointer may lead Claude to open that file). 6000t comfortably surfaces a normal small
  // MEMORY.md's gated matches (ordered + pinned-first); eviction is a safety valve for large sets.
  const defaults: MemoryRecallSettings = { useScorer: true, tokenBudget: 6000, maxCandidates: 12 };
  try {
    const path = join(process.env.HOME || '/tmp', '.claude', 'config', 'settings.json');
    if (!existsSync(path)) return defaults;
    const cfg = JSON.parse(readFileSync(path, 'utf-8'));
    const mr = cfg.memoryRecall ?? {};
    return {
      useScorer: mr.useScorer !== false, // default ON
      tokenBudget: typeof mr.tokenBudget === 'number' ? mr.tokenBudget : defaults.tokenBudget,
      maxCandidates: typeof mr.maxCandidates === 'number' ? mr.maxCandidates : defaults.maxCandidates,
    };
  } catch {
    return defaults;
  }
}

/**
 * W2: Build a scorer MemoryEntry from a gated index entry by reading its file.
 * - created: frontmatter `created`/`captured` if parseable, else file mtime (robust universal fallback)
 * - pinned: frontmatter `pinned: true`
 * - tags: frontmatter `tags` array (best-effort)
 * - content: file body (real token accounting for eviction)
 * NEVER throws — on any read/parse failure falls back to a description-only entry so the hook
 * can never block prompt submission (a UserPromptSubmit hook crash would block EVERY prompt).
 */
export function buildMemoryEntry(memDir: string, entry: MemoryEntry): ScorerEntry {
  const fallback: ScorerEntry = {
    path: entry.file,
    content: entry.description,
    created: new Date(0),
    frequency: 1,
    pinned: false,
  };
  try {
    const filePath = join(memDir, entry.file);
    if (!existsSync(filePath)) return fallback;

    const raw = readFileSync(filePath, 'utf-8');
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    const fmText = fmMatch ? fmMatch[1] : '';
    const body = fmMatch ? fmMatch[2].trim() : raw.trim();

    const fm: Record<string, string> = {};
    for (const line of fmText.split('\n')) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    }

    let created: Date;
    const rawDate = fm.created || fm.captured;
    const parsed = rawDate ? new Date(rawDate) : null;
    if (parsed && !isNaN(parsed.getTime())) {
      created = parsed;
    } else {
      created = statSync(filePath).mtime;
    }

    const tags = fm.tags
      ? fm.tags.replace(/^\[|\]$/g, '').split(',').map(t => t.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
      : undefined;

    return {
      path: entry.file,
      content: body || entry.description,
      created,
      frequency: 1,
      pinned: fm.pinned === 'true',
      tags,
    };
  } catch {
    return fallback;
  }
}

/**
 * Find the project memory directory from the Claude project dir path.
 * Convention: ~/.claude/projects/{encoded-path}/memory/MEMORY.md
 *
 * NOTE: CLAUDE_PROJECT_DIR is required. process.cwd() is NOT a valid fallback
 * because run-hook.sh sets cwd to ~/.claude/hooks/, not the project dir.
 */
function findProjectMemoryDir(): string | null {
  const claudeProjectDir = process.env.CLAUDE_PROJECT_DIR;
  if (!claudeProjectDir) {
    console.error('[MemoryRecall] CLAUDE_PROJECT_DIR not set — cannot discover project memory');
    return null;
  }

  const projectsBase = join(process.env.HOME || '/tmp', '.claude', 'projects');
  if (!existsSync(projectsBase)) return null;

  // Claude Code encodes paths: /Users/x/Projects/myrepo → -Users-x-Projects-myrepo
  // It replaces both / and _ with -
  const encoded = encodeProjectDir(claudeProjectDir);
  const projectMemDir = join(projectsBase, encoded, 'memory');

  if (existsSync(join(projectMemDir, 'MEMORY.md'))) {
    return projectMemDir;
  }

  // Fallback: scan project dirs for match on encoded project name suffix
  try {
    const dirs = readdirSync(projectsBase, { withFileTypes: true })
      .filter(d => d.isDirectory());

    const projectName = encodeProjectDir(basename(claudeProjectDir));
    const candidates: string[] = [];

    for (const dir of dirs) {
      if (dir.name.endsWith(projectName)) {
        const candidate = join(projectsBase, dir.name, 'memory', 'MEMORY.md');
        if (existsSync(candidate)) {
          candidates.push(join(projectsBase, dir.name, 'memory'));
        }
      }
    }

    if (candidates.length === 1) {
      return candidates[0];
    }
    if (candidates.length > 1) {
      console.error(`[MemoryRecall] Multiple project matches for "${projectName}": ${candidates.map(c => basename(join(c, '..'))).join(', ')} — using first`);
      return candidates[0];
    }
  } catch { /* scan failed */ }

  return null;
}

/**
 * Parse MEMORY.md index into structured entries.
 * Handles both flat and categorized formats:
 *
 * Flat: - [Title](file.md) — description text
 * Categorized:
 *   ## Category Name
 *   - [Title](file.md) — description text
 */
function parseMemoryIndex(content: string): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  let currentCategory: string | undefined;

  for (const line of content.split('\n')) {
    const categoryMatch = line.match(/^##\s+(.+)/);
    if (categoryMatch) {
      currentCategory = categoryMatch[1].trim();
      continue;
    }

    // Entry lines: - [Title](file.md) — description
    // Hyphen last in character class to avoid regex ambiguity
    const entryMatch = line.match(/^-\s+\[(.+?)\]\((.+?)\)\s*[-—–]\s*(.+)/);
    if (entryMatch) {
      const [, title, file, description] = entryMatch;

      const rawText = `${title} ${description}`.toLowerCase();
      const keywords = extractKeywords(rawText);

      entries.push({
        title,
        file,
        description,
        keywords,
        category: currentCategory,
      });
    }
  }

  return entries;
}

/**
 * Extract meaningful keywords from text.
 * Filters out common stop words, keeps domain-specific terms.
 */
function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'need', 'must', 'ought',
    'for', 'and', 'nor', 'but', 'or', 'yet', 'so', 'in', 'on', 'at',
    'to', 'from', 'by', 'with', 'about', 'against', 'between', 'through',
    'during', 'before', 'after', 'above', 'below', 'up', 'down', 'out',
    'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here',
    'there', 'when', 'where', 'why', 'how', 'all', 'each', 'every',
    'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'not',
    'only', 'own', 'same', 'than', 'too', 'very', 'just', 'because',
    'as', 'until', 'while', 'of', 'if', 'that', 'this', 'it', 'its',
    'use', 'check', 'always', 'never', 'don', 'what', 'which',
    'into', 'our', 'your', 'their', 'his', 'her', 'ran', 'got',
    'went', 'came', 'let', 'get', 'put', 'run', 'say', 'also',
    'like', 'know', 'think', 'want', 'look', 'make', 'going',
  ]);

  const words = text
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));

  return [...new Set(words)];
}

/**
 * Score how well a memory entry matches the user prompt.
 * Returns 0 (no match) to 1.0 (strong match).
 */
function scoreMatch(entry: MemoryEntry, promptKeywords: string[]): number {
  if (promptKeywords.length === 0) return 0;

  let hits = 0;
  for (const pk of promptKeywords) {
    for (const ek of entry.keywords) {
      if (ek === pk) {
        hits++;
        break;
      }
      // Prefix matching for stemming (e.g., "patch" matches "patches")
      // Only allow prefix match when the shorter word is >= 4 chars
      // to prevent short keywords like "fix", "run", "get" from wildcarding
      if (ek.length >= 4 && pk.startsWith(ek)) {
        hits++;
        break;
      }
      if (pk.length >= 4 && ek.startsWith(pk)) {
        hits++;
        break;
      }
    }
  }

  return hits / promptKeywords.length;
}

/**
 * Look up cross-project keyword index to find related memories in OTHER projects.
 * For high-confidence matches (3+ keywords), injects actual memory content.
 * For lower matches (2 keywords), returns pointer lines.
 */
function lookupCrossProject(promptKeywords: string[], currentMemDir: string): string[] {
  const indexPath = join(process.env.HOME || '/tmp', '.claude', 'MEMORY', 'STATE', 'cross-project-index.json');

  let indexData: { index: Record<string, { projects: string[]; entries: string[] }> };
  try {
    if (!existsSync(indexPath)) return [];
    indexData = JSON.parse(readFileSync(indexPath, 'utf-8'));
  } catch {
    return [];
  }

  if (!indexData.index) return [];

  const currentSlug = basename(join(currentMemDir, '..'));
  const currentProjectName = currentSlug.split('-Projects-')[1] || currentSlug;

  const projectHits: Record<string, Set<string>> = {};

  for (const kw of promptKeywords) {
    const entry = indexData.index[kw];
    if (!entry) continue;

    for (const proj of entry.projects) {
      if (proj === currentProjectName) continue;
      if (!projectHits[proj]) projectHits[proj] = new Set();
      projectHits[proj].add(kw);
    }
  }

  const relevant = Object.entries(projectHits)
    .filter(([, hits]) => hits.size >= 2)
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 3);

  if (relevant.length === 0) return [];

  const results: string[] = [];
  const projectsBase = join(process.env.HOME || '/tmp', '.claude', 'projects');

  for (const [proj, hits] of relevant) {
    const kwList = [...hits].slice(0, 4).join(', ');

    // High-confidence match: inject actual memory content
    if (hits.size >= 3) {
      const content = findAndReadBestMatch(proj, promptKeywords, projectsBase);
      if (content) {
        results.push(`• **${proj}** (${hits.size} keyword hits: ${kwList}):\n${content}`);
        continue;
      }
    }

    // Lower confidence: pointer only
    results.push(`• **${proj}** project has related memories (keywords: ${kwList})`);
  }

  return results;
}

/**
 * Find the best-matching memory file in a cross-project and return its body (capped).
 */
function findAndReadBestMatch(projectSlug: string, promptKeywords: string[], projectsBase: string): string | null {
  // Find the project directory
  let projMemDir: string | null = null;
  try {
    const dirs = readdirSync(projectsBase, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const dir of dirs) {
      if (dir.name.endsWith(projectSlug) || dir.name.includes(`-Projects-${projectSlug}`)) {
        const candidate = join(projectsBase, dir.name, 'memory');
        if (existsSync(join(candidate, 'MEMORY.md'))) {
          projMemDir = candidate;
          break;
        }
      }
    }
  } catch { return null; }

  if (!projMemDir) return null;

  // Parse that project's MEMORY.md and find best match by keyword overlap
  try {
    const indexContent = readFileSync(join(projMemDir, 'MEMORY.md'), 'utf-8');
    let bestFile: string | null = null;
    let bestHits = 0;

    for (const line of indexContent.split('\n')) {
      const match = line.match(/^-\s+\[(.+?)\]\((.+?)\)\s*[-—–]\s*(.+)/);
      if (!match) continue;
      const text = `${match[1]} ${match[3]}`.toLowerCase();
      const hits = promptKeywords.filter(kw => text.includes(kw)).length;
      if (hits > bestHits) {
        bestHits = hits;
        bestFile = match[2];
      }
    }

    if (!bestFile || bestHits < 2) return null;

    const filePath = join(projMemDir, bestFile);
    if (!existsSync(filePath)) return null;

    const raw = readFileSync(filePath, 'utf-8');
    // Strip frontmatter
    const secondDash = raw.indexOf('---', 4);
    const body = secondDash > 0 ? raw.substring(secondDash + 4).trim() : raw.trim();

    // Cap at 1000 chars to control context budget
    return body.length > 1000 ? body.substring(0, 1000) + '…' : body;
  } catch { return null; }
}

/**
 * Dynamic score threshold that accounts for prompt length.
 * Short prompts (few keywords) need higher relative scores to avoid noise.
 * Long prompts allow lower relative scores since absolute hit count is higher.
 */
function scoreThreshold(promptKeywordCount: number): number {
  if (promptKeywordCount <= 3) return 0.30; // Need at least 1/3 keywords to hit
  if (promptKeywordCount <= 6) return 0.20; // At least ~1-2 hits
  return 0.15; // Standard threshold for detailed prompts
}

async function main() {
  const input = await readHookInput();
  if (!input) process.exit(0);

  const prompt = ((input as any).prompt || '').trim();
  if (!prompt || prompt.length < 5) process.exit(0);

  // Skip bare ratings, slash commands, and very short messages
  if (/^([1-9]|10)$/.test(prompt)) process.exit(0);
  if (prompt.startsWith('/')) process.exit(0);

  // Find project memory
  const memDir = findProjectMemoryDir();
  if (!memDir) {
    process.exit(0);
  }

  // Parse index — wrapped in try/catch to never block prompts
  let content: string;
  try {
    content = readFileSync(join(memDir, 'MEMORY.md'), 'utf-8');
  } catch (err) {
    console.error(`[MemoryRecall] Failed to read MEMORY.md: ${err}`);
    process.exit(0);
  }

  const entries = parseMemoryIndex(content);
  if (entries.length === 0) {
    console.error('[MemoryRecall] MEMORY.md has no parseable entries — skipped');
    process.exit(0);
  }

  // Extract keywords from user prompt
  const promptKeywords = extractKeywords(prompt.toLowerCase());
  if (promptKeywords.length === 0) {
    console.error('[MemoryRecall] No keywords in prompt — skipped');
    process.exit(0);
  }

  // Score all entries with dynamic threshold — KEYWORD GATE: decides which memories
  // relate to THIS prompt. The composite scorer (below) handles ordering + eviction.
  const threshold = scoreThreshold(promptKeywords.length);
  const gated = entries
    .map(entry => ({ entry, score: scoreMatch(entry, promptKeywords) }))
    .filter(({ score }) => score >= threshold)
    .sort((a, b) => b.score - a.score);

  // W2: composite-scorer ordering + token-budget eviction (flag-gated).
  // Flag OFF reproduces the original keyword top-5 behavior exactly.
  const mrSettings = loadMemoryRecallSettings();
  let scored: { entry: MemoryEntry; score: number }[];

  if (mrSettings.useScorer && gated.length > 0) {
    // Cap candidate pool before file reads (bounds per-prompt I/O).
    const pool = gated.slice(0, mrSettings.maxCandidates);
    // Build scorer entries (reads files; never throws — falls back to description entry).
    const byPath = new Map<string, { entry: MemoryEntry; score: number }>();
    const scorerEntries: ScorerEntry[] = pool.map(g => {
      const se = buildMemoryEntry(memDir, g.entry);
      byPath.set(se.path, g);
      return se;
    });
    // Composite recency×frequency×importance×relevance ordering + token-budget eviction.
    const ranked = rankEntries(scorerEntries, promptKeywords, mrSettings.tokenBudget);
    // Map ranked scorer entries back to index entries for rendering (keep keyword % match).
    scored = ranked.map(se => byPath.get(se.path)).filter((x): x is { entry: MemoryEntry; score: number } => Boolean(x));
    console.error(`[MemoryRecall] scorer ranked ${scored.length}/${gated.length} gated (budget=${mrSettings.tokenBudget}t)`);
  } else {
    // Original path (flag OFF or no candidates): keyword sort, hard top-5.
    scored = gated.slice(0, 5);
  }

  if (scored.length === 0) {
    console.error(`[MemoryRecall] No matches (threshold=${(threshold * 100).toFixed(0)}%) for: ${promptKeywords.slice(0, 5).join(', ')}`);
    process.exit(0);
  }

  // Cross-project lookup: check if prompt keywords hit other projects' memories
  const crossProjectHints = lookupCrossProject(promptKeywords, memDir);

  // Build context injection
  const matchLines = scored.map(({ entry, score }) => {
    const cat = entry.category ? `[${entry.category}] ` : '';
    const pct = Math.round(score * 100);
    return `• ${cat}**${entry.title}** (${pct}% match) — ${entry.description}\n  File: ${entry.file}`;
  });

  const crossSection = crossProjectHints.length > 0
    ? `\n\nCross-project context (read if relevant):\n${crossProjectHints.join('\n')}`
    : '';

  const context = `<memory-recall>
RELEVANT MEMORIES for this request (check these BEFORE investigating externally):

${matchLines.join('\n')}${crossSection}

Action: Read the matched memory file(s) if they contain details needed for this task.
</memory-recall>`;

  console.log(JSON.stringify({ additionalContext: context }));
  console.error(`[MemoryRecall] ${scored.length} match(es): ${scored.map(s => s.entry.title).join(', ')}`);
  process.exit(0);
}

if (import.meta.main) main();
