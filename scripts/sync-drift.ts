#!/usr/bin/env bun
/**
 * sync-drift.ts - Detect drift between kai and kai repos
 *
 * PURPOSE: Compare file lists and contents between kai and kai.
 * Reports files that exist in one but not the other, and files with different content.
 *
 * USAGE:
 *   bun scripts/sync-drift.ts
 *   KAI_DIR=~/Projects/kai-fork bun scripts/sync-drift.ts
 *
 * DESIGN:
 * - Uses git ls-files to get tracked files (ignores untracked/gitignored)
 * - Respects KAI_ONLY_FILES exclusions from sync-to-kai.sh
 * - Compares file hashes for content drift detection
 * - Output: summary to stdout (parseable for CI)
 *
 * EXIT CODES:
 *   0 - No drift detected
 *   1 - Drift detected (or error)
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { execSync } from 'child_process';

const PAI_DIR = join(process.env.HOME!, 'Projects', 'kai');
const KAI_DIR = process.env.KAI_DIR || join(process.env.HOME!, 'Projects', 'kai');

// Files that exist ONLY in kai (should not be synced from kai)
const KAI_ONLY_FILES = [
  '.github/workflows/test.yml',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'LICENSE-UPSTREAM',
  'config/domains.jsonc',
  'config/identity.jsonc.template',
  'config/user-hooks.jsonc.example',
  'docs/CUSTOMIZATION.md',
  'docs/architecture/archive/',
  'docs/planning/deliberate-research-mode.md',
  'get-kai.sh',
  'PAI/CONTEXT_ROUTING.md',
  'README.md',
  'docs/WHATS-DIFFERENT.md',
  'hooks/user/',
  'MEMORY/KNOWLEDGE/.gitkeep',
  'MEMORY/LEARNING/.gitkeep',
  'MEMORY/RELATIONSHIP/.gitkeep',
  'MEMORY/SECURITY/.gitkeep',
  'MEMORY/STAGING/.gitkeep',
  'MEMORY/STATE/.gitkeep',
  'MEMORY/WORK/.gitkeep',
  'tests/ConfigLoader.test.ts',
  'tests/Installer.test.ts',
  'tests/OncePerSession.test.ts',
];

// Files excluded from sync (kai only, should NOT appear in kai)
const PAI_ONLY_FILES = [
  'CLAUDE.md',
  'VERSION',
  'config/identity.jsonc',
  'docs/planning/GIT-HISTORY-REWRITE.md',
  'docs/planning/PAI-5.0.0-PLAN.md',
  'docs/planning/RELEASE-BLOCKERS.md',
  '.github/workflows/test.yml',
  'hooks/archive/',
  'Plans/',
  'skills/KAIUpgrade/',
  'scripts/sync-to-kai.sh',
  'scripts/verify-release.sh',
  'scripts/kai-release-audit.ts',
  'scripts/board-config.json',
  'USER/',
  '.claude/',
];

function getTrackedFiles(repoDir: string): string[] {
  try {
    const output = execSync('git ls-files', { cwd: repoDir, encoding: 'utf-8' });
    return output.trim().split('\n').filter(f => f.length > 0);
  } catch (err) {
    console.error(`Error: Failed to list files in ${repoDir}: ${err}`);
    process.exit(1);
  }
}

function hashFile(filePath: string): string {
  try {
    const content = readFileSync(filePath);
    return createHash('sha256').update(content).digest('hex');
  } catch {
    return '';
  }
}

function isExcluded(file: string, patterns: string[]): boolean {
  return patterns.some(pattern => {
    if (pattern.endsWith('/')) {
      return file.startsWith(pattern);
    }
    return file === pattern || file.startsWith(pattern + '/');
  });
}

function main() {
  console.log('\n=== PAI ↔ KAI Sync Drift Detection ===\n');

  if (!existsSync(PAI_DIR)) {
    console.error(`Error: PAI directory not found: ${PAI_DIR}`);
    process.exit(1);
  }

  if (!existsSync(KAI_DIR)) {
    console.error(`Error: KAI directory not found: ${KAI_DIR}`);
    console.error('Set KAI_DIR environment variable if using a different path.');
    process.exit(1);
  }

  console.log(`PAI: ${PAI_DIR}`);
  console.log(`KAI: ${KAI_DIR}\n`);

  // Get tracked files
  const paiFiles = getTrackedFiles(PAI_DIR);
  const kaiFiles = getTrackedFiles(KAI_DIR);

  console.log(`Files tracked: PAI=${paiFiles.length}, KAI=${kaiFiles.length}\n`);

  // Filter out excluded files
  const sharedPaiFiles = paiFiles.filter(f => !isExcluded(f, PAI_ONLY_FILES));
  const sharedKaiFiles = kaiFiles.filter(f => !isExcluded(f, KAI_ONLY_FILES));

  const paiSet = new Set(sharedPaiFiles);
  const kaiSet = new Set(sharedKaiFiles);

  // Files in PAI but not in KAI
  const missingInKai: string[] = [];
  for (const file of paiSet) {
    if (!kaiSet.has(file)) {
      missingInKai.push(file);
    }
  }

  // Files in KAI but not in PAI (unexpected)
  const extraInKai: string[] = [];
  for (const file of kaiSet) {
    if (!paiSet.has(file) && !isExcluded(file, KAI_ONLY_FILES)) {
      extraInKai.push(file);
    }
  }

  // Files with different content
  const contentDrift: Array<{ file: string; paiHash: string; kaiHash: string }> = [];
  for (const file of paiSet) {
    if (!kaiSet.has(file)) continue;

    const paiPath = join(PAI_DIR, file);
    const kaiPath = join(KAI_DIR, file);

    if (!existsSync(paiPath) || !existsSync(kaiPath)) continue;

    const paiHash = hashFile(paiPath);
    const kaiHash = hashFile(kaiPath);

    if (paiHash && kaiHash && paiHash !== kaiHash) {
      contentDrift.push({ file, paiHash, kaiHash });
    }
  }

  // Report
  let driftDetected = false;

  if (missingInKai.length > 0) {
    driftDetected = true;
    console.log(`🔴 Files in PAI but missing in KAI (${missingInKai.length}):\n`);
    for (const file of missingInKai.slice(0, 20)) {
      console.log(`  ${file}`);
    }
    if (missingInKai.length > 20) {
      console.log(`  ... and ${missingInKai.length - 20} more`);
    }
    console.log('');
  }

  if (extraInKai.length > 0) {
    driftDetected = true;
    console.log(`🟡 Files in KAI but not in PAI (${extraInKai.length}):\n`);
    for (const file of extraInKai.slice(0, 20)) {
      console.log(`  ${file}`);
    }
    if (extraInKai.length > 20) {
      console.log(`  ... and ${extraInKai.length - 20} more`);
    }
    console.log('');
  }

  if (contentDrift.length > 0) {
    driftDetected = true;
    console.log(`🔵 Files with different content (${contentDrift.length}):\n`);
    for (const { file } of contentDrift.slice(0, 20)) {
      console.log(`  ${file}`);
    }
    if (contentDrift.length > 20) {
      console.log(`  ... and ${contentDrift.length - 20} more`);
    }
    console.log('');
  }

  if (!driftDetected) {
    console.log('✅ No drift detected — repos are in sync.\n');
    process.exit(0);
  }

  console.log('📋 Summary:');
  console.log(`  Missing in KAI:  ${missingInKai.length}`);
  console.log(`  Extra in KAI:    ${extraInKai.length}`);
  console.log(`  Content drift:   ${contentDrift.length}`);
  console.log('');
  console.log('Run: bash scripts/sync-to-kai.sh --apply');
  console.log('');

  process.exit(1);
}

if (import.meta.main) {
  main();
}
