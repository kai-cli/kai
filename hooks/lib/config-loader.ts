/**
 * config-loader.ts — Domain config reader for kai
 *
 * Reads config/domains.jsonc and exposes typed accessors.
 * All functions return empty/default values if the file is missing or malformed.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getPaiDir } from './paths';

interface DomainDefinition {
  description: string;
  keywords: string[];
  requiredTags?: string[];
  relatedDomains?: string[];
}

interface DomainsConfig {
  definitions?: Record<string, DomainDefinition>;
  projectMapping?: Array<{ pattern: string; domains: string[] }>;
  excludedProjects?: string[];
  personalProjects?: string[];
  maxDomainsPerSession?: number;
}

function loadConfig(): DomainsConfig {
  const configPath = join(getPaiDir(), 'config', 'domains.jsonc');
  if (!existsSync(configPath)) return {};
  try {
    const raw = readFileSync(configPath, 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')     // strip /* */ block comments
      .replace(/(?<!:)\/\/[^\n]*/g, '')     // strip // line comments (preserve http://)
      .replace(/,(\s*[}\]])/g, '$1');       // strip trailing commas
    return JSON.parse(raw) as DomainsConfig;
  } catch {
    return {};
  }
}

export function loadDomainKeywords(): Record<string, string[]> {
  const config = loadConfig();
  if (!config.definitions) return {};
  const result: Record<string, string[]> = {};
  for (const [domain, def] of Object.entries(config.definitions)) {
    result[domain] = def.keywords ?? [];
  }
  return result;
}

export function loadDomainDescriptions(): Record<string, string> {
  const config = loadConfig();
  if (!config.definitions) return {};
  const result: Record<string, string> = {};
  for (const [domain, def] of Object.entries(config.definitions)) {
    result[domain] = def.description ?? domain;
  }
  return result;
}

export function loadProjectMapping(): Array<{ pattern: string; domains: string[] }> {
  const config = loadConfig();
  return config.projectMapping ?? [];
}

export function loadExcludedProjects(): string[] {
  const config = loadConfig();
  return config.excludedProjects ?? [];
}

export function getMaxDomainsPerSession(): number {
  const config = loadConfig();
  return config.maxDomainsPerSession ?? 3;
}

export function loadRequiredTags(): Record<string, string[]> {
  const config = loadConfig();
  if (!config.definitions) return {};
  const result: Record<string, string[]> = {};
  for (const [domain, def] of Object.entries(config.definitions)) {
    result[domain] = def.requiredTags ?? [];
  }
  return result;
}

export function loadRelatedDomains(): Record<string, string[]> {
  const config = loadConfig();
  if (!config.definitions) return {};
  const result: Record<string, string[]> = {};
  for (const [domain, def] of Object.entries(config.definitions)) {
    result[domain] = def.relatedDomains ?? [];
  }
  return result;
}

export function loadPersonalProjects(): string[] {
  const config = loadConfig();
  return config.personalProjects ?? [];
}
