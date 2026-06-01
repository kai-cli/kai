#!/usr/bin/env bun
/**
 * MemorySearch.ts — On-demand knowledge retrieval via ripgrep.
 *
 * Searches MEMORY/KNOWLEDGE/ and MEMORY/CAPABILITIES/ for query terms,
 * ranks results by match density, follows related-note links one hop,
 * and returns a budget-trimmed markdown summary.
 *
 * Usage: bun PAI/Tools/MemorySearch.ts "openwrt build cache"
 *        bun PAI/Tools/MemorySearch.ts --budget 2000 "auth middleware"
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, basename } from 'path';
import { parseArgs } from 'util';
import { paiPath } from '../../hooks/lib/paths';
import { parseKnowledgeFile, loadAllKnowledge, type KnowledgeFile } from '../../hooks/lib/knowledge-schema';

export interface SearchResult {
  file: string;
  slug: string;
  score: number;
  matches: string[];
}

export interface SearchOutput {
  query: string;
  results: SearchResult[];
  totalChars: number;
  truncated: boolean;
}

const SEARCH_DIRS = [
  paiPath('MEMORY', 'KNOWLEDGE'),
  paiPath('MEMORY', 'CAPABILITIES'),
];

const DEFAULT_BUDGET = 4000;
const MAX_RESULTS = 5;
const CONTEXT_LINES = 2;

/**
 * Search memory files for a query string.
 */
export function searchMemory(query: string, budget = DEFAULT_BUDGET): SearchOutput {
  if (!query || query.trim().length === 0) {
    return { query, results: [], totalChars: 0, truncated: false };
  }

  const terms = query.trim().split(/\s+/).map(escapeRegex);
  const pattern = terms.join('|');
  const searchPaths = SEARCH_DIRS.filter(d => existsSync(d));

  if (searchPaths.length === 0) {
    return { query, results: [], totalChars: 0, truncated: false };
  }

  const rawMatches = runRipgrep(pattern, searchPaths);
  const scored = scoreResults(rawMatches, query);
  const withRelated = followRelatedLinks(scored);
  const trimmed = applyBudget(withRelated, budget);

  return trimmed;
}

interface RgMatch {
  file: string;
  lineNumber: number;
  lineText: string;
}

function runRipgrep(pattern: string, dirs: string[]): RgMatch[] {
  const args = [
    '--json',
    '--ignore-case',
    '--max-count', '20',
    '-C', String(CONTEXT_LINES),
    '--', pattern,
    ...dirs,
  ];

  let output: string;
  try {
    output = execSync(`rg ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`, {
      encoding: 'utf-8',
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
  } catch (err: any) {
    if (err.status === 1) return []; // no matches
    if (err.stdout) output = err.stdout;
    else return [];
  }

  const matches: RgMatch[] = [];
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'match') {
        matches.push({
          file: obj.data.path.text,
          lineNumber: obj.data.line_number,
          lineText: obj.data.lines.text.trimEnd(),
        });
      }
    } catch { /* skip non-JSON lines */ }
  }

  return matches;
}

function scoreResults(matches: RgMatch[], query: string): SearchResult[] {
  const byFile = new Map<string, RgMatch[]>();
  for (const m of matches) {
    const existing = byFile.get(m.file) || [];
    existing.push(m);
    byFile.set(m.file, existing);
  }

  const queryTerms = query.toLowerCase().split(/\s+/);
  const knowledgeFiles = loadAllKnowledge();
  const tagMap = new Map(knowledgeFiles.map(kf => [kf.path, kf.meta.tags]));

  const results: SearchResult[] = [];
  for (const [file, fileMatches] of byFile) {
    let score = fileMatches.length;

    // Tag bonus: +2 per query term that matches a tag
    const tags = tagMap.get(file) || [];
    for (const term of queryTerms) {
      if (tags.some(t => t.toLowerCase().includes(term))) {
        score += 2;
      }
    }

    const uniqueLines = [...new Set(fileMatches.map(m => m.lineText))];
    results.push({
      file,
      slug: basename(file, '.md'),
      score,
      matches: uniqueLines.slice(0, 8),
    });
  }

  results.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));
  return results.slice(0, MAX_RESULTS);
}

function followRelatedLinks(results: SearchResult[]): SearchResult[] {
  if (results.length === 0) return results;

  const knowledgeFiles = loadAllKnowledge();
  const bySlug = new Map(knowledgeFiles.map(kf => [kf.slug, kf]));
  const existingSlugs = new Set(results.map(r => r.slug));

  const related: SearchResult[] = [];
  for (const result of results) {
    const kf = bySlug.get(result.slug);
    if (!kf?.meta.related) continue;

    for (const relSlug of kf.meta.related) {
      if (existingSlugs.has(relSlug)) continue;
      const relFile = bySlug.get(relSlug);
      if (!relFile) continue;

      existingSlugs.add(relSlug);
      const preview = relFile.body.split('\n').filter(l => l.trim()).slice(0, 3);
      related.push({
        file: relFile.path,
        slug: relSlug,
        score: 0,
        matches: preview,
      });
    }
  }

  return [...results, ...related];
}

function applyBudget(results: SearchResult[], budget: number): SearchOutput {
  const query = '';
  let totalChars = 0;
  let truncated = false;
  const kept: SearchResult[] = [];

  for (const result of results) {
    const entrySize = result.slug.length + result.matches.join('\n').length + 20;
    if (totalChars + entrySize > budget && kept.length > 0) {
      truncated = true;
      break;
    }
    kept.push(result);
    totalChars += entrySize;
  }

  return { query, results: kept, totalChars, truncated };
}

/**
 * Format search output as readable markdown.
 */
export function formatSearchOutput(output: SearchOutput): string {
  if (output.results.length === 0) {
    return `No results found for "${output.query}".`;
  }

  const lines: string[] = [`## Memory Search: "${output.query}"`, ''];

  for (const result of output.results) {
    const label = result.score > 0 ? `**${result.slug}** (score: ${result.score})` : `*${result.slug}* (related)`;
    lines.push(`### ${label}`);
    lines.push(`> ${result.file}`);
    lines.push('');
    for (const match of result.matches) {
      lines.push(match);
    }
    lines.push('');
  }

  if (output.truncated) {
    lines.push('*Results truncated to fit budget.*');
  }

  return lines.join('\n');
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- CLI ---
if (import.meta.main) {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      budget: { type: 'string', short: 'b' },
      json: { type: 'boolean' },
    },
    allowPositionals: true,
  });

  const query = positionals.join(' ');
  if (!query) {
    console.error('Usage: bun PAI/Tools/MemorySearch.ts [--budget N] [--json] "query"');
    process.exit(1);
  }

  const budget = values.budget ? parseInt(values.budget, 10) : DEFAULT_BUDGET;
  const output = searchMemory(query, budget);
  output.query = query;

  if (values.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(formatSearchOutput(output));
  }
}
