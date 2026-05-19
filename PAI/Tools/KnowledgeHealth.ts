#!/usr/bin/env bun
/**
 * KnowledgeHealth.ts — Per-domain reference frequency and staleness analysis.
 *
 * Reads memory-reads.jsonl telemetry to determine which knowledge domains
 * are actively used, idle, or dormant. Surfaces in CLI and Board API.
 *
 * Usage: bun PAI/Tools/KnowledgeHealth.ts [--json]
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parseArgs } from 'util';
import { paiPath } from '../../hooks/lib/paths';
import { loadAllKnowledge } from '../../hooks/lib/knowledge-schema';

export interface DomainHealthEntry {
  domain: string;
  lastReferenced: string | null;
  count30d: number;
  count90d: number;
  countTotal: number;
  status: 'ACTIVE' | 'IDLE' | 'DORMANT' | 'NEVER';
}

export interface HealthReport {
  domains: DomainHealthEntry[];
  totalReads: number;
  telemetrySpanDays: number;
  generatedAt: string;
}

interface ReadEntry {
  timestamp: string;
  domains_injected: string[];
}

const READS_PATH = () => paiPath('MEMORY', 'STATE', 'memory-reads.jsonl');

/**
 * Analyze knowledge domain health from telemetry.
 */
export function analyzeHealth(): HealthReport {
  const entries = loadReadEntries();
  const knowledgeFiles = loadAllKnowledge();
  const allDomains = new Set(knowledgeFiles.map(kf => kf.meta.domain));

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  const domainStats = new Map<string, { lastRef: Date | null; count30: number; count90: number; total: number }>();

  for (const domain of allDomains) {
    domainStats.set(domain, { lastRef: null, count30: 0, count90: 0, total: 0 });
  }

  for (const entry of entries) {
    const ts = new Date(entry.timestamp);
    for (const domain of entry.domains_injected) {
      let stats = domainStats.get(domain);
      if (!stats) {
        stats = { lastRef: null, count30: 0, count90: 0, total: 0 };
        domainStats.set(domain, stats);
        allDomains.add(domain);
      }

      stats.total++;
      if (!stats.lastRef || ts > stats.lastRef) stats.lastRef = ts;
      if (ts >= thirtyDaysAgo) stats.count30++;
      if (ts >= ninetyDaysAgo) stats.count90++;
    }
  }

  const domains: DomainHealthEntry[] = [];
  for (const [domain, stats] of domainStats) {
    let status: DomainHealthEntry['status'];
    if (!stats.lastRef) {
      status = 'NEVER';
    } else if (stats.lastRef >= thirtyDaysAgo) {
      status = 'ACTIVE';
    } else if (stats.lastRef >= ninetyDaysAgo) {
      status = 'IDLE';
    } else {
      status = 'DORMANT';
    }

    domains.push({
      domain,
      lastReferenced: stats.lastRef?.toISOString().split('T')[0] ?? null,
      count30d: stats.count30,
      count90d: stats.count90,
      countTotal: stats.total,
      status,
    });
  }

  domains.sort((a, b) => b.countTotal - a.countTotal);

  let spanDays = 0;
  if (entries.length >= 2) {
    const first = new Date(entries[0].timestamp);
    const last = new Date(entries[entries.length - 1].timestamp);
    spanDays = Math.ceil((last.getTime() - first.getTime()) / (1000 * 60 * 60 * 24));
  }

  return {
    domains,
    totalReads: entries.length,
    telemetrySpanDays: spanDays,
    generatedAt: now.toISOString(),
  };
}

/**
 * Format health report as a readable CLI table.
 */
export function formatHealthReport(report: HealthReport): string {
  const lines: string[] = [
    '## Knowledge Domain Health',
    '',
    `Telemetry: ${report.totalReads} reads over ${report.telemetrySpanDays} days`,
    '',
    '| Domain | Last Referenced | 30d | 90d | Total | Status |',
    '|--------|---------------|-----|-----|-------|--------|',
  ];

  for (const d of report.domains) {
    const lastRef = d.lastReferenced ?? 'never';
    const statusIcon = d.status === 'ACTIVE' ? '✅' : d.status === 'IDLE' ? '⚠️' : d.status === 'DORMANT' ? '💤' : '❌';
    lines.push(`| ${d.domain} | ${lastRef} | ${d.count30d} | ${d.count90d} | ${d.countTotal} | ${statusIcon} ${d.status} |`);
  }

  const dormant = report.domains.filter(d => d.status === 'DORMANT' || d.status === 'NEVER');
  if (dormant.length > 0) {
    lines.push('');
    lines.push(`⚠️ ${dormant.length} domain(s) dormant/never referenced — consider reviewing in \`pai curate\`.`);
  }

  return lines.join('\n');
}

function loadReadEntries(): ReadEntry[] {
  const path = READS_PATH();
  if (!existsSync(path)) return [];

  try {
    const raw = readFileSync(path, 'utf-8');
    const entries: ReadEntry[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.timestamp && Array.isArray(obj.domains_injected)) {
          entries.push({ timestamp: obj.timestamp, domains_injected: obj.domains_injected });
        }
      } catch { /* skip malformed lines */ }
    }
    return entries;
  } catch {
    return [];
  }
}

// --- CLI ---
if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { json: { type: 'boolean' } },
    allowPositionals: true,
  });

  const report = analyzeHealth();

  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatHealthReport(report));
  }
}
