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
 * DESIGN: Reads domain keywords from config/domains.jsonc.
 * If not configured, exits silently (zero output, zero cost).
 * Deterministic regex matching (<5ms, no API calls).
 */

import { readHookInput } from './lib/hook-io';
import { loadDomainDefinitions } from './lib/config-loader';

function matchesDomainTopics(prompt: string, patterns: Array<{ name: string; keywords: string[] }>): string[] {
  const lower = prompt.toLowerCase();
  const matched: string[] = [];
  for (const { name, keywords } of patterns) {
    if (keywords.some(kw => lower.includes(kw.toLowerCase()))) {
      matched.push(name);
    }
  }
  return matched;
}

async function main() {
  const input = await readHookInput();
  if (!input) process.exit(0);

  const prompt = ((input as any).prompt || '').trim();
  if (!prompt || prompt.length < 10) process.exit(0);

  // Skip bare ratings
  if (/^([1-9]|10)$/.test(prompt.trim())) process.exit(0);

  const patterns = loadDomainDefinitions();
  if (patterns.length === 0) {
    // Not configured — exit silently
    process.exit(0);
  }

  const matched = matchesDomainTopics(prompt, patterns);

  if (matched.length > 0) {
    const context = `<local-context-hint>
Topic matches configured domains: [${matched.join(', ')}]

Check local knowledge sources before web research:
1. PAI/CONTEXT_ROUTING.md → your domain-specific paths
2. Your configured local knowledge base (config/domains.jsonc)

Local context is faster and more accurate than web research for your domain topics.
</local-context-hint>`;

    console.log(JSON.stringify({ additionalContext: context }));
    console.error(`[LocalContextFirst] Matched domains: ${matched.join(', ')}`);
  } else {
    console.error('[LocalContextFirst] No domain match — skipped');
  }

  process.exit(0);
}

main();
