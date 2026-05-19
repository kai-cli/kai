#!/usr/bin/env bun
/**
 * ContradictionDetector.ts — Find conflicting versioned claims across knowledge files.
 *
 * Groups files by shared tag overlap, extracts versioned claims (entity + version pattern),
 * and flags conflicts where the same entity has different versions in overlapping files.
 *
 * Usage: bun PAI/Tools/ContradictionDetector.ts [--json]
 */

import { parseArgs } from 'util';
import { loadAllKnowledge, type KnowledgeFile } from '../../hooks/lib/knowledge-schema';

export interface VersionedClaim {
  entity: string;
  version: string;
  file: string;
  slug: string;
  line: string;
}

export interface Contradiction {
  entity: string;
  claims: VersionedClaim[];
}

export interface ContradictionReport {
  contradictions: Contradiction[];
  claimsExtracted: number;
  filesAnalyzed: number;
  groupsChecked: number;
}

// Match patterns like: "postgres v16.2", "kernel 5.15", "deploy_app:104", "v4.9.0"
const VERSION_PATTERNS = [
  /\b([a-zA-Z][\w.-]+)\s+v?(\d+\.\d+(?:\.\d+)?(?:[.-]\w+)?)\b/g,    // entity vN.N.N or entity N.N.N
  /\b([a-zA-Z][\w.-]+):(\d+)\b/g,                                       // entity:N (e.g. build_wrt:104)
];

/**
 * Extract versioned claims from a knowledge file body.
 */
export function extractClaims(file: KnowledgeFile): VersionedClaim[] {
  const claims: VersionedClaim[] = [];
  const lines = file.body.split('\n');

  for (const line of lines) {
    if (line.startsWith('#') || line.trim().length === 0) continue;

    for (const pattern of VERSION_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(line)) !== null) {
        const entity = normalizeEntity(match[1]);
        const version = match[2];

        if (shouldSkip(entity, version)) continue;

        claims.push({
          entity,
          version,
          file: file.path,
          slug: file.slug,
          line: line.trim(),
        });
      }
    }
  }

  return claims;
}

/**
 * Detect contradictions across all knowledge files.
 */
export function detectContradictions(): ContradictionReport {
  const knowledgeFiles = loadAllKnowledge();
  const allClaims: VersionedClaim[] = [];

  for (const kf of knowledgeFiles) {
    allClaims.push(...extractClaims(kf));
  }

  // Group files by shared tags (≥2 tags in common)
  const groups = groupByTagOverlap(knowledgeFiles);

  // Within each group, find contradictions
  const contradictions: Contradiction[] = [];
  const seen = new Set<string>();

  for (const group of groups) {
    const groupSlugs = new Set(group.map(kf => kf.slug));
    const groupClaims = allClaims.filter(c => groupSlugs.has(c.slug));

    // Group claims by entity
    const byEntity = new Map<string, VersionedClaim[]>();
    for (const claim of groupClaims) {
      const existing = byEntity.get(claim.entity) || [];
      existing.push(claim);
      byEntity.set(claim.entity, existing);
    }

    // Find entities with multiple different versions across different files
    for (const [entity, entityClaims] of byEntity) {
      const uniqueVersions = new Map<string, VersionedClaim>();
      for (const claim of entityClaims) {
        const key = `${claim.slug}:${claim.version}`;
        if (!uniqueVersions.has(key)) {
          uniqueVersions.set(key, claim);
        }
      }

      const byFile = new Map<string, string>();
      for (const claim of uniqueVersions.values()) {
        const existingVersion = byFile.get(claim.slug);
        if (existingVersion && existingVersion !== claim.version) {
          // Same entity, same file, different versions — internal update, not contradiction
          continue;
        }
        byFile.set(claim.slug, claim.version);
      }

      // Check across files
      const distinctVersionsByFile = [...byFile.entries()];
      const versionValues = new Set(distinctVersionsByFile.map(([_, v]) => v));

      if (versionValues.size > 1 && distinctVersionsByFile.length > 1) {
        const key = `${entity}:${[...versionValues].sort().join(',')}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const relevantClaims = distinctVersionsByFile.map(([slug, version]) => {
          return entityClaims.find(c => c.slug === slug && c.version === version)!;
        }).filter(Boolean);

        contradictions.push({ entity, claims: relevantClaims });
      }
    }
  }

  return {
    contradictions,
    claimsExtracted: allClaims.length,
    filesAnalyzed: knowledgeFiles.length,
    groupsChecked: groups.length,
  };
}

/**
 * Format contradiction report as readable text.
 */
export function formatContradictionReport(report: ContradictionReport): string {
  const lines: string[] = [
    '## Contradiction Detection Report',
    '',
    `Files analyzed: ${report.filesAnalyzed} | Claims extracted: ${report.claimsExtracted} | Groups checked: ${report.groupsChecked}`,
    '',
  ];

  if (report.contradictions.length === 0) {
    lines.push('✅ No contradictions detected.');
    return lines.join('\n');
  }

  lines.push(`### Potential Contradictions (${report.contradictions.length})`);
  lines.push('');

  for (const c of report.contradictions) {
    lines.push(`**${c.entity}**:`);
    for (const claim of c.claims) {
      lines.push(`  - ${claim.slug}: \`${claim.version}\` — "${claim.line.substring(0, 100)}"`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// --- Helpers ---

function groupByTagOverlap(files: KnowledgeFile[]): KnowledgeFile[][] {
  const groups: KnowledgeFile[][] = [];
  const processed = new Set<string>();

  for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
      const shared = files[i].meta.tags.filter(t => files[j].meta.tags.includes(t));
      if (shared.length >= 2) {
        const key = [files[i].slug, files[j].slug].sort().join('+');
        if (!processed.has(key)) {
          processed.add(key);
          groups.push([files[i], files[j]]);
        }
      }
    }
  }

  return groups;
}

function normalizeEntity(entity: string): string {
  return entity.toLowerCase().replace(/[-_]/g, '');
}

function shouldSkip(entity: string, version: string): boolean {
  // Skip common false positives
  const skipEntities = ['http', 'https', 'port', 'step', 'tab', 'flow', 'section', 'item', 'line', 'page', 'slot'];
  if (skipEntities.includes(entity.toLowerCase())) return true;
  // Skip very short entities (likely noise)
  if (entity.length < 3) return true;
  // Skip if version looks like a year
  if (/^20\d{2}$/.test(version)) return true;
  return false;
}

// --- CLI ---
if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { json: { type: 'boolean' } },
    allowPositionals: true,
  });

  const report = detectContradictions();

  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatContradictionReport(report));
  }
}
