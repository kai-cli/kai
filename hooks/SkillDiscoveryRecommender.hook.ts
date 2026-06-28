#!/usr/bin/env bun
/**
 * SkillDiscoveryRecommender.hook.ts — lightweight skill discoverability nudge.
 *
 * Deterministic and local-only: reads SKILL.md frontmatter descriptions, scores
 * USE WHEN phrases against the prompt, and injects one compact suggestion.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readHookInput } from './lib/hook-io';
import { paiPath } from './lib/paths';

export interface SkillCard {
  name: string;
  description: string;
  triggers: string[];
}

export interface SkillRecommendation {
  skill: string;
  score: number;
  trigger: string;
}

interface SkillCacheFile {
  version: 1;
  skillsDir: string;
  manifest: string;
  cards: SkillCard[];
}

const STOPWORDS = new Set([
  'a', 'an', 'and', 'as', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'use', 'when',
  'with', 'this', 'that', 'please', 'can', 'you', 'my', 'our',
]);

const CACHE_PATH = '/tmp/pai-hooks/skill-discovery-cache.json';

function parseFrontmatter(raw: string): Record<string, string> {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const out: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

function extractTriggers(description: string): string[] {
  const match = description.match(/USE WHEN\s+(.+)$/i);
  const source = match ? match[1] : description;
  return source
    .split(/[,;|]/)
    .map(part => part.trim().replace(/\.$/, ''))
    .filter(Boolean);
}

export function loadSkillCards(skillsDir = paiPath('skills')): SkillCard[] {
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => {
      const path = join(skillsDir, entry.name, 'SKILL.md');
      if (!existsSync(path)) return null;
      try {
        const fm = parseFrontmatter(readFileSync(path, 'utf8'));
        const name = fm.name || entry.name;
        const description = fm.description || '';
        return { name, description, triggers: extractTriggers(description) };
      } catch {
        return null;
      }
    })
    .filter((card): card is SkillCard => card !== null);
}

function skillManifest(skillsDir: string): string {
  if (!existsSync(skillsDir)) return '';
  const entries = readdirSync(skillsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => {
      const skillPath = join(skillsDir, entry.name, 'SKILL.md');
      if (!existsSync(skillPath)) return `${entry.name}:missing`;
      try {
        const stat = statSync(skillPath);
        return `${entry.name}:${stat.mtimeMs}:${stat.size}`;
      } catch {
        return `${entry.name}:unreadable`;
      }
    });
  return entries.sort().join('|');
}

export function clearSkillCardCache(cachePath = CACHE_PATH): void {
  try {
    writeFileSync(cachePath, '', 'utf8');
  } catch {
    // Test helper / best-effort cache invalidation.
  }
}

export function loadSkillCardsCached(skillsDir = paiPath('skills'), cachePath = CACHE_PATH): SkillCard[] {
  const manifest = skillManifest(skillsDir);
  if (!manifest) return [];
  try {
    const cached = JSON.parse(readFileSync(cachePath, 'utf8')) as SkillCacheFile;
    if (cached.version === 1 && cached.skillsDir === skillsDir && cached.manifest === manifest && Array.isArray(cached.cards)) {
      return cached.cards;
    }
  } catch {
    // Cache miss/corruption: rebuild from source.
  }
  const cards = loadSkillCards(skillsDir);
  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify({ version: 1, skillsDir, manifest, cards }), 'utf8');
  } catch {
    // Recommendations are optional; cache write failures must not affect prompts.
  }
  return cards;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9/ -]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 2 && !STOPWORDS.has(token));
}

function explicitlyInvoked(prompt: string, skill: string): boolean {
  const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:/|Skill\\(["'])${escaped}(?:\\b|["'])`, 'i').test(prompt);
}

export function recommendSkills(prompt: string, cards: SkillCard[], limit = 1): SkillRecommendation[] {
  const lower = prompt.toLowerCase();
  const promptTokens = new Set(tokenize(prompt));
  const recs: SkillRecommendation[] = [];

  for (const card of cards) {
    if (explicitlyInvoked(prompt, card.name)) continue;
    let best: SkillRecommendation | null = null;
    for (const trigger of card.triggers) {
      const triggerLower = trigger.toLowerCase();
      const triggerTokens = tokenize(triggerLower);
      let score = 0;
      if (triggerLower.length >= 4 && lower.includes(triggerLower)) score += 4;
      for (const token of triggerTokens) {
        if (promptTokens.has(token)) score += 1;
      }
      if (score >= 2 && (!best || score > best.score)) {
        best = { skill: card.name, score, trigger };
      }
    }
    if (best) recs.push(best);
  }

  return recs
    .sort((a, b) => b.score - a.score || a.skill.localeCompare(b.skill))
    .slice(0, limit);
}

async function main(): Promise<void> {
  try {
    const input = await readHookInput();
    const prompt = (input?.prompt ?? input?.user_prompt ?? '').trim();
    if (!prompt) process.exit(0);
    const [rec] = recommendSkills(prompt, loadSkillCardsCached());
    if (!rec) process.exit(0);
    console.log(JSON.stringify({
      additionalContext: `<skill-recommendation>Relevant PAI capability: consider invoking /${rec.skill} (${rec.trigger}).</skill-recommendation>`,
    }));
  } catch {
    // Suggestions are optional and must never block prompt submission.
  }
  process.exit(0);
}

if (import.meta.main) main();
