// config-loader.ts — Centralized domain config from config/domains.jsonc
//
// Single cached read per process. Falls back to safe defaults if file missing.

import { readFileSync, existsSync } from 'fs';
import { paiPath } from './paths';

// ── Types ─────────────────────────────────────────────────────────────────

export interface DomainDefinition {
  description: string;
  keywords: string[];
}

export interface ProjectMapping {
  pattern: string;
  domains: string[];
}

export interface DomainsConfig {
  definitions: Record<string, DomainDefinition>;
  projectMapping: ProjectMapping[];
  excludedProjects: string[];
  maxDomainsPerSession: number;
}

// ── JSONC Parser ──────────────────────────────────────────────────────────

export function parseJSONC(text: string): unknown {
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(?<!:)\/\/[^\n]*/g, '')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(stripped);
}

// ── Cache ─────────────────────────────────────────────────────────────────

let cached: DomainsConfig | null = null;

export function _resetCache(): void { cached = null; }

const DEFAULTS: DomainsConfig = {
  definitions: {},
  projectMapping: [],
  excludedProjects: [],
  maxDomainsPerSession: 3,
};

// ── Loader ────────────────────────────────────────────────────────────────

function loadRaw(): DomainsConfig {
  if (cached) return cached;

  const configPath = paiPath('config', 'domains.jsonc');
  if (!existsSync(configPath)) {
    cached = DEFAULTS;
    return cached;
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = parseJSONC(raw) as Partial<DomainsConfig>;
    cached = {
      definitions: parsed.definitions ?? {},
      projectMapping: parsed.projectMapping ?? [],
      excludedProjects: parsed.excludedProjects ?? [],
      maxDomainsPerSession: parsed.maxDomainsPerSession ?? 3,
    };
  } catch {
    cached = DEFAULTS;
  }

  return cached;
}

// ── Public API ────────────────────────────────────────────────────────────

export function loadDomainKeywords(): Record<string, string[]> {
  const config = loadRaw();
  const result: Record<string, string[]> = {};
  for (const [name, def] of Object.entries(config.definitions)) {
    result[name] = def.keywords;
  }
  return result;
}

export function loadDomainDescriptions(): Record<string, string> {
  const config = loadRaw();
  const result: Record<string, string> = {};
  for (const [name, def] of Object.entries(config.definitions)) {
    result[name] = def.description;
  }
  return result;
}

export function loadDomainDefinitions(): Array<{ name: string; description: string; keywords: string[] }> {
  const config = loadRaw();
  return Object.entries(config.definitions).map(([name, def]) => ({
    name,
    description: def.description,
    keywords: def.keywords,
  }));
}

export function loadProjectMapping(): ProjectMapping[] {
  return loadRaw().projectMapping;
}

export function loadExcludedProjects(): string[] {
  return loadRaw().excludedProjects;
}

export function getMaxDomainsPerSession(): number {
  return loadRaw().maxDomainsPerSession;
}

export function loadDomainsConfig(): DomainsConfig {
  return loadRaw();
}
