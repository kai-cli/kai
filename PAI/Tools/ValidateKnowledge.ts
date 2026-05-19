#!/usr/bin/env bun
/**
 * ValidateKnowledge.ts — Schema validation for KNOWLEDGE/ domain files.
 *
 * Checks: frontmatter completeness, requiredTags from domains.jsonc,
 * stale update dates, and broken related-note links.
 *
 * Usage: bun PAI/Tools/ValidateKnowledge.ts [--json]
 */

import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { parseArgs } from 'util';
import { paiPath } from '../../hooks/lib/paths';
import { parseKnowledgeFile, validateKnowledgeMeta, loadAllKnowledge, getKnowledgeDir } from '../../hooks/lib/knowledge-schema';
import { loadRequiredTags, loadRelatedDomains } from '../../hooks/lib/config-loader';

export interface ValidationIssue {
  file: string;
  slug: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface ValidationReport {
  issues: ValidationIssue[];
  filesChecked: number;
  filesValid: number;
  filesWithIssues: number;
}

const STALE_THRESHOLD_DAYS = 180;

/**
 * Validate all knowledge files and return a report.
 */
export function validateKnowledge(): ValidationReport {
  const dir = getKnowledgeDir();
  const issues: ValidationIssue[] = [];

  if (!existsSync(dir)) {
    return { issues: [{ file: dir, slug: '', severity: 'error', message: 'KNOWLEDGE directory not found' }], filesChecked: 0, filesValid: 0, filesWithIssues: 0 };
  }

  const mdFiles = readdirSync(dir).filter(f => f.endsWith('.md') && f !== 'INDEX.md');
  const knowledgeFiles = loadAllKnowledge();
  const knowledgeSlugs = new Set(knowledgeFiles.map(kf => kf.slug));
  const requiredTagsMap = loadRequiredTags();
  const now = new Date();

  // Check files without frontmatter
  for (const filename of mdFiles) {
    const slug = filename.replace('.md', '');
    const filePath = join(dir, filename);
    const parsed = parseKnowledgeFile(filePath);

    if (!parsed) {
      issues.push({ file: filePath, slug, severity: 'error', message: 'Missing or invalid YAML frontmatter' });
      continue;
    }

    // Schema validation
    const metaErrors = validateKnowledgeMeta(parsed.meta);
    for (const err of metaErrors) {
      issues.push({ file: filePath, slug, severity: 'error', message: err });
    }

    // RequiredTags check
    const required = requiredTagsMap[parsed.meta.domain] || [];
    for (const tag of required) {
      if (!parsed.meta.tags.includes(tag)) {
        issues.push({ file: filePath, slug, severity: 'warning', message: `Missing required tag "${tag}" for domain "${parsed.meta.domain}"` });
      }
    }

    // Staleness check
    const updatedDate = new Date(parsed.meta.updated);
    const daysSince = Math.floor((now.getTime() - updatedDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSince > STALE_THRESHOLD_DAYS) {
      issues.push({ file: filePath, slug, severity: 'warning', message: `Stale: last updated ${daysSince} days ago (threshold: ${STALE_THRESHOLD_DAYS})` });
    }

    // Related-note link validation
    for (const relSlug of parsed.meta.related) {
      if (!knowledgeSlugs.has(relSlug)) {
        issues.push({ file: filePath, slug, severity: 'warning', message: `Broken related link: "${relSlug}" does not exist in KNOWLEDGE/` });
      }
    }
  }

  const filesWithIssues = new Set(issues.map(i => i.slug)).size;

  return {
    issues,
    filesChecked: mdFiles.length,
    filesValid: mdFiles.length - filesWithIssues,
    filesWithIssues,
  };
}

/**
 * Format validation report as readable text.
 */
export function formatValidationReport(report: ValidationReport): string {
  const lines: string[] = [
    `## Knowledge Validation Report`,
    '',
    `Files checked: ${report.filesChecked} | Valid: ${report.filesValid} | With issues: ${report.filesWithIssues}`,
    '',
  ];

  if (report.issues.length === 0) {
    lines.push('✅ All knowledge files pass validation.');
    return lines.join('\n');
  }

  const errors = report.issues.filter(i => i.severity === 'error');
  const warnings = report.issues.filter(i => i.severity === 'warning');

  if (errors.length > 0) {
    lines.push(`### Errors (${errors.length})`);
    for (const e of errors) {
      lines.push(`- **${e.slug}**: ${e.message}`);
    }
    lines.push('');
  }

  if (warnings.length > 0) {
    lines.push(`### Warnings (${warnings.length})`);
    for (const w of warnings) {
      lines.push(`- ${w.slug}: ${w.message}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// --- CLI ---
if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { json: { type: 'boolean' } },
    allowPositionals: true,
  });

  const report = validateKnowledge();

  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatValidationReport(report));
  }

  process.exit(report.issues.filter(i => i.severity === 'error').length > 0 ? 1 : 0);
}
