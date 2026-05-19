/**
 * knowledge-schema.ts — Canonical type and parser for KNOWLEDGE/ domain files.
 *
 * Every tool that reads or writes knowledge files imports from this module.
 * No re-parsing. No divergent type definitions.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { paiPath } from './paths';

export interface KnowledgeMeta {
  domain: string;
  updated: string;       // YYYY-MM-DD
  tags: string[];
  related: string[];     // slugs of related knowledge files
}

export interface KnowledgeFile {
  meta: KnowledgeMeta;
  body: string;
  path: string;
  slug: string;          // filename without extension
}

const KNOWLEDGE_DIR = () => paiPath('MEMORY', 'KNOWLEDGE');
const FRONTMATTER_DELIMITER = '---';

/**
 * Parse YAML frontmatter from a knowledge file.
 * Returns null if the file doesn't exist or has no valid frontmatter.
 */
export function parseKnowledgeFile(filePath: string): KnowledgeFile | null {
  if (!existsSync(filePath)) return null;

  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  const slug = basename(filePath, '.md');

  if (!raw.startsWith(`${FRONTMATTER_DELIMITER}\n`)) {
    return null;
  }

  const endIdx = raw.indexOf(`\n${FRONTMATTER_DELIMITER}\n`, FRONTMATTER_DELIMITER.length);
  if (endIdx === -1) return null;

  const yamlBlock = raw.slice(FRONTMATTER_DELIMITER.length + 1, endIdx);
  const body = raw.slice(endIdx + FRONTMATTER_DELIMITER.length + 2); // skip \n---\n

  const meta = parseYamlBlock(yamlBlock);
  if (!meta) return null;

  return { meta, body, path: filePath, slug };
}

/**
 * Validate knowledge file metadata. Returns list of errors (empty = valid).
 */
export function validateKnowledgeMeta(meta: unknown): string[] {
  const errors: string[] = [];

  if (!meta || typeof meta !== 'object') {
    errors.push('meta is not an object');
    return errors;
  }

  const m = meta as Record<string, unknown>;

  if (typeof m.domain !== 'string' || m.domain.length === 0) {
    errors.push('missing or empty "domain" field');
  }

  if (typeof m.updated !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(m.updated)) {
    errors.push('"updated" must be YYYY-MM-DD format');
  }

  if (!Array.isArray(m.tags) || m.tags.length === 0) {
    errors.push('"tags" must be a non-empty string array');
  } else if (m.tags.some((t: unknown) => typeof t !== 'string')) {
    errors.push('"tags" must contain only strings');
  }

  if (!Array.isArray(m.related)) {
    errors.push('"related" must be a string array (can be empty)');
  } else if (m.related.some((r: unknown) => typeof r !== 'string')) {
    errors.push('"related" must contain only strings');
  }

  return errors;
}

/**
 * Write a knowledge file to disk. Reconstructs frontmatter from meta, preserves body.
 */
export function writeKnowledgeFile(file: KnowledgeFile): void {
  const yaml = serializeYamlBlock(file.meta);
  const content = `${FRONTMATTER_DELIMITER}\n${yaml}\n${FRONTMATTER_DELIMITER}\n${file.body}`;
  writeFileSync(file.path, content, 'utf-8');
}

/**
 * Load all knowledge files from MEMORY/KNOWLEDGE/ as typed objects.
 * Skips INDEX.md and files without valid frontmatter.
 */
export function loadAllKnowledge(): KnowledgeFile[] {
  const dir = KNOWLEDGE_DIR();
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir)
    .filter(f => f.endsWith('.md') && f !== 'INDEX.md')
    .map(f => parseKnowledgeFile(join(dir, f)))
    .filter((f): f is KnowledgeFile => f !== null);

  return files;
}

/**
 * Get the knowledge directory path.
 */
export function getKnowledgeDir(): string {
  return KNOWLEDGE_DIR();
}

// --- Internal helpers ---

function parseYamlBlock(yaml: string): KnowledgeMeta | null {
  const lines = yaml.split('\n');
  const result: Record<string, unknown> = {};

  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();

    if (key === 'tags' || key === 'related') {
      result[key] = parseYamlArray(rawValue);
    } else {
      result[key] = rawValue;
    }
  }

  if (!result.domain || !result.updated || !result.tags) return null;

  return {
    domain: result.domain as string,
    updated: result.updated as string,
    tags: (result.tags as string[]) || [],
    related: (result.related as string[]) || [],
  };
}

function parseYamlArray(value: string): string[] {
  if (!value.startsWith('[')) return [];
  const inner = value.slice(1, -1);
  if (inner.trim().length === 0) return [];
  return inner.split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
}

function serializeYamlBlock(meta: KnowledgeMeta): string {
  const lines: string[] = [];
  lines.push(`domain: ${meta.domain}`);
  lines.push(`updated: ${meta.updated}`);
  lines.push(`tags: [${meta.tags.join(', ')}]`);
  lines.push(`related: [${meta.related.join(', ')}]`);
  return lines.join('\n');
}
