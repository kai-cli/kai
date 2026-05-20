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

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { readHookInput } from './lib/hook-io';

interface MemoryEntry {
  title: string;
  file: string;
  description: string;
  keywords: string[];
  category?: string;
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

  // Claude Code encodes paths: /Users/x/Projects/feed_bbf → -Users-x-Projects-feed-bbf
  // It replaces both / and _ with -
  const encoded = claudeProjectDir.replace(/[/_]/g, '-');
  const projectMemDir = join(projectsBase, encoded, 'memory');

  if (existsSync(join(projectMemDir, 'MEMORY.md'))) {
    return projectMemDir;
  }

  // Fallback: scan project dirs for match on encoded project name suffix
  try {
    const dirs = readdirSync(projectsBase, { withFileTypes: true })
      .filter(d => d.isDirectory());

    const projectName = basename(claudeProjectDir).replace(/[/_]/g, '-');
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
 * Returns pointer lines (not full content) for relevant cross-project memories.
 * Only returns projects different from the current one.
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

  // Determine current project slug to exclude it from results
  const currentSlug = basename(join(currentMemDir, '..'));
  const currentProjectName = currentSlug.split('-Projects-')[1] || currentSlug;

  // Collect hits: project → keywords that matched
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

  // Only surface projects with 2+ keyword hits (reduces noise)
  const relevant = Object.entries(projectHits)
    .filter(([, hits]) => hits.size >= 2)
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 3);

  if (relevant.length === 0) return [];

  return relevant.map(([proj, hits]) => {
    const kwList = [...hits].slice(0, 4).join(', ');
    return `• **${proj}** project has related memories (keywords: ${kwList})`;
  });
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

  // Score all entries with dynamic threshold
  const threshold = scoreThreshold(promptKeywords.length);
  const scored = entries
    .map(entry => ({ entry, score: scoreMatch(entry, promptKeywords) }))
    .filter(({ score }) => score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

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
