#!/usr/bin/env bun
/**
 * LocalContextFirst.hook.ts — Inject local knowledge base pointers for domain topics
 *
 * TRIGGER: UserPromptSubmit
 *
 * PURPOSE: When the user's prompt matches topics in their configured domains
 * (config/domains.jsonc), remind them to check local knowledge sources before
 * web research. Prevents redundant web searches when local knowledge exists.
 *
 * Feature C (v5.6.0): Semantic fallback — when no explicit routing rule matches,
 * attempt embedding-based context retrieval for knowledge-area queries.
 * Gating: only fires for knowledge-path targets, skips if index not installed.
 *
 * DESIGN: Reads domain keywords from config/domains.jsonc.
 * If not configured, exits silently (zero output, zero cost).
 * Deterministic regex matching (<5ms, no API calls).
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { readHookInput } from './lib/hook-io';
import { paiPath } from './lib/paths';
import { semanticFallback, isIndexAvailable } from './lib/semantic-fallback';
import { checkRulesChanges } from './lib/rules-watcher';
import { redactSecrets } from './lib/redact';

const DOMAINS_CONFIG_PATH = paiPath('config', 'domains.jsonc');
const KNOWLEDGE_DIR = paiPath('MEMORY', 'KNOWLEDGE');
const MAX_DOMAIN_CHARS = 4000;

export function loadDomainPatterns(): Array<{ domain: string; keywords: string[] }> {
  if (!existsSync(DOMAINS_CONFIG_PATH)) return [];
  try {
    // Strip JSONC comments before parsing
    const raw = readFileSync(DOMAINS_CONFIG_PATH, 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(?<!:)\/\/[^\n]*/g, '')
      .replace(/,(\s*[}\]])/g, '$1');
    const config = JSON.parse(raw);
    return Object.entries(config.definitions || {}).map(([domain, def]: [string, any]) => ({
      domain,
      keywords: def.keywords || [],
    }));
  } catch { return []; }
}

export function matchesDomainTopics(prompt: string, patterns: Array<{ domain: string; keywords: string[] }>): string[] {
  const lower = prompt.toLowerCase();
  const matched: string[] = [];
  for (const { domain, keywords } of patterns) {
    if (keywords.some(kw => lower.includes(kw.toLowerCase()))) {
      matched.push(domain);
    }
  }
  return matched;
}

function domainKnowledgePath(domain: string, knowledgeDir = KNOWLEDGE_DIR): string {
  return join(knowledgeDir, `${domain}.md`);
}

export function readDomainKnowledge(domain: string, maxChars = MAX_DOMAIN_CHARS, knowledgeDir = KNOWLEDGE_DIR): string | null {
  const path = domainKnowledgePath(domain, knowledgeDir);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8').trim();
    if (!raw) return null;
    const redacted = redactSecrets(raw);
    if (redacted.length <= maxChars) return redacted;
    return `${redacted.slice(0, maxChars).trimEnd()}\n\n[... truncated domain knowledge to ${maxChars} chars]`;
  } catch {
    return null;
  }
}

export function buildDomainContext(
  matched: string[],
  maxChars = MAX_DOMAIN_CHARS,
  knowledgeDir = KNOWLEDGE_DIR,
): { context: string; injected: string[]; missing: string[] } {
  const injected: string[] = [];
  const missing: string[] = [];
  const sections: string[] = [];

  for (const domain of matched) {
    const content = readDomainKnowledge(domain, maxChars, knowledgeDir);
    if (!content) {
      missing.push(domain);
      continue;
    }
    injected.push(domain);
    sections.push(`## ${domain}\n\n${content}`);
  }

  const body = sections.length > 0
    ? `\n\nRetrieved domain knowledge:\n\n${sections.join('\n\n---\n\n')}`
    : '';
  const missingLine = missing.length > 0
    ? `\n\nMissing knowledge files for matched domains: [${missing.join(', ')}]`
    : '';

  const context = `<local-context-hint>
Topic matches configured domains: [${matched.join(', ')}]

Use the injected local knowledge below before web research. If more detail is needed, check:
1. PAI/CONTEXT_ROUTING.md → your domain-specific paths
2. MEMORY/KNOWLEDGE/<domain>.md
3. config/domains.jsonc for domain routing${body}${missingLine}

Local context is faster and more accurate than web research for your domain topics.
</local-context-hint>`;

  return { context, injected, missing };
}

/**
 * Determine if a prompt is exploring knowledge topics without an explicit routing match.
 * Used to gate whether semantic fallback should be attempted.
 */
export function isKnowledgeExploration(prompt: string): boolean {
  const knowledgeIndicators = [
    'what do you know about', 'tell me about', 'how does', 'what is',
    'explain', 'describe', 'documentation', 'wiki', 'knowledge',
  ];
  const lower = prompt.toLowerCase();
  return knowledgeIndicators.some(kw => lower.includes(kw));
}

async function main() {
  const input = await readHookInput();
  if (!input) process.exit(0);

  const prompt = ((input as any).prompt || '').trim();
  if (!prompt || prompt.length < 10) process.exit(0);

  // Skip bare ratings
  if (/^([1-9]|10)$/.test(prompt.trim())) process.exit(0);

  // Feature D (v5.9): Hot-reload rules — detect CLAUDE.md/steering rule changes
  const rulesChange = checkRulesChanges();
  if (rulesChange.changed) {
    const rulesContext = `<rules-updated>
Rules files changed since last prompt:
${rulesChange.summaries.map(s => `- ${s}`).join('\n')}

Apply any updated instructions from these files to the current session.
</rules-updated>`;
    console.log(JSON.stringify({ additionalContext: rulesContext }));
    console.error(`[LocalContextFirst] Rules changed: ${rulesChange.files.map(f => f.split('/').pop()).join(', ')}`);
    process.exit(0);
  }

  const patterns = loadDomainPatterns();
  const matched = patterns.length > 0 ? matchesDomainTopics(prompt, patterns) : [];

  if (matched.length > 0) {
    const { context, injected, missing } = buildDomainContext(matched);
    console.log(JSON.stringify({ additionalContext: context }));
    console.error(`[LocalContextFirst] Matched domains: ${matched.join(', ')}; injected: ${injected.join(', ') || 'none'}; missing: ${missing.join(', ') || 'none'}`);
    process.exit(0);
  }

  // Feature C: Semantic fallback for knowledge exploration queries
  // Only attempt when: no explicit routing match, prompt looks exploratory,
  // and embedding index is installed.
  if (isKnowledgeExploration(prompt)) {
    const { getPaiDir } = await import('./lib/paths');
    const paiDir = getPaiDir();

    // Fast-path: skip if index not installed (graceful degradation)
    if (!isIndexAvailable(paiDir)) {
      console.error('[LocalContextFirst] Semantic fallback: index not available — skipped');
      process.exit(0);
    }

    try {
      const result = await semanticFallback(paiDir, prompt);
      if (result.content && result.confidence > 0) {
        const context = `<semantic-context>
Retrieved from knowledge base (similarity: ${(result.confidence * 100).toFixed(0)}%, sources: ${result.sources.join(', ')}):

${result.content}
</semantic-context>`;
        console.log(JSON.stringify({ additionalContext: context }));
        console.error(`[LocalContextFirst] Semantic fallback: ${result.sources.length} source(s), confidence ${result.confidence.toFixed(2)}`);
      } else {
        console.error('[LocalContextFirst] Semantic fallback: no matches above threshold');
      }
    } catch (err) {
      console.error('[LocalContextFirst] Semantic fallback error (non-fatal):', err);
    }
  } else {
    console.error('[LocalContextFirst] No domain match — skipped');
  }

  process.exit(0);
}

if (import.meta.main) main();
