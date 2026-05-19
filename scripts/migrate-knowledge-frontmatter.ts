#!/usr/bin/env bun
/**
 * One-shot migration: adds YAML frontmatter to existing KNOWLEDGE/ domain files.
 * Run once during v5.4.0 Phase 0. Safe to re-run (skips files that already have frontmatter).
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { paiPath } from '../hooks/lib/paths';

interface MigrationEntry {
  filename: string;
  domain: string;
  updated: string;
  tags: string[];
  related: string[];
}

const migrations: MigrationEntry[] = [
  {
    filename: 'ai-infrastructure.md',
    domain: 'ai-infrastructure',
    updated: '2026-05-18',
    tags: ['pai', 'hooks', 'skills', 'agents', 'algorithm', 'memory'],
    related: ['devops'],
  },
  {
    filename: 'api-and-services.md',
    domain: 'api-and-services',
    updated: '2026-05-15',
    tags: ['api', 'rest', 'rpc', 'protocol', 'data-model'],
    related: ['firmware'],
  },
  {
    filename: 'devops.md',
    domain: 'devops',
    updated: '2026-05-12',
    tags: ['jenkins', 'ci', 'docker', 'ecs', 'artifacts'],
    related: ['ai-infrastructure'],
  },
  {
    filename: 'firmware.md',
    domain: 'firmware',
    updated: '2026-05-18',
    tags: ['embedded', 'firmware', 'sdk', 'build-system', 'platform'],
    related: ['api-and-services', 'products'],
  },
  {
    filename: 'products.md',
    domain: 'products',
    updated: '2026-05-18',
    tags: ['hardware', 'products', 'iot', 'networking', 'devices'],
    related: ['firmware'],
  },
  {
    filename: 'security.md',
    domain: 'security',
    updated: '2026-05-12',
    tags: ['security', 'vulnerability', 'tls', 'pki', 'compliance'],
    related: ['devops', 'firmware'],
  },
  {
    filename: 'ui.md',
    domain: 'ui',
    updated: '2026-05-12',
    tags: ['flutter', 'ui', 'frontend', 'mobile'],
    related: ['api-and-services'],
  },
];

const knowledgeDir = paiPath('MEMORY', 'KNOWLEDGE');
let migrated = 0;
let skipped = 0;

for (const entry of migrations) {
  const filePath = join(knowledgeDir, entry.filename);
  const content = readFileSync(filePath, 'utf-8');

  if (content.startsWith('---\n')) {
    console.log(`SKIP: ${entry.filename} (already has frontmatter)`);
    skipped++;
    continue;
  }

  const frontmatter = [
    '---',
    `domain: ${entry.domain}`,
    `updated: ${entry.updated}`,
    `tags: [${entry.tags.join(', ')}]`,
    `related: [${entry.related.join(', ')}]`,
    '---',
    '',
  ].join('\n');

  writeFileSync(filePath, frontmatter + content, 'utf-8');
  console.log(`MIGRATED: ${entry.filename}`);
  migrated++;
}

console.log(`\nDone: ${migrated} migrated, ${skipped} skipped.`);
