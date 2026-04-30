#!/usr/bin/env bun
/**
 * RoutingCandidates.ts — Surface frequently-read files missing from routing table
 *
 * Reads MEMORY/STATE/read-log.jsonl (written by ReadTracker.hook.ts), aggregates
 * reads by path across sessions, cross-references PAI/CONTEXT_ROUTING.md, and
 * outputs paths that appear in ≥N distinct sessions but have no routing entry.
 *
 * Usage:
 *   bun PAI/Tools/RoutingCandidates.ts
 *   bun PAI/Tools/RoutingCandidates.ts --threshold 3
 *   bun PAI/Tools/RoutingCandidates.ts --days 30
 *   bun PAI/Tools/RoutingCandidates.ts --json
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { parseArgs } from 'util';
import { getPaiDir, paiPath } from '../../hooks/lib/paths';

const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: {
    threshold: { type: 'string', default: '3' },
    days: { type: 'string', default: '90' },
    json: { type: 'boolean', default: false },
  },
  strict: false,
});

const THRESHOLD = parseInt(args.threshold as string, 10) || 3;
const DAYS = parseInt(args.days as string, 10) || 90;
const JSON_OUTPUT = args.json as boolean;

const paiDir = getPaiDir();
const LOG_FILE = paiPath('MEMORY', 'STATE', 'read-log.jsonl');
const ROUTING_FILE = join(paiDir, 'PAI', 'CONTEXT_ROUTING.md');

interface ReadLogEntry {
  timestamp: string;
  session_id: string;
  path: string;
  project_dir: string;
}

interface Candidate {
  path: string;
  sessions: number;
  lastSeen: string;
  firstSeen: string;
}

function loadLog(): ReadLogEntry[] {
  if (!existsSync(LOG_FILE)) return [];
  const cutoff = Date.now() - DAYS * 24 * 60 * 60 * 1000;
  return readFileSync(LOG_FILE, 'utf-8')
    .split('\n')
    .filter(l => l.trim())
    .flatMap(line => {
      try {
        const entry = JSON.parse(line) as ReadLogEntry;
        if (new Date(entry.timestamp).getTime() < cutoff) return [];
        return [entry];
      } catch { return []; }
    });
}

function loadRoutedPaths(): Set<string> {
  const routed = new Set<string>();
  if (!existsSync(ROUTING_FILE)) return routed;
  const content = readFileSync(ROUTING_FILE, 'utf-8');
  // Extract all backtick-quoted paths from the routing table
  const re = /`([^`]+)`/g;
  let match;
  while ((match = re.exec(content)) !== null) {
    const p = match[1];
    if (p.startsWith('PAI/') || p.startsWith('~/') || p.startsWith('~/.claude/')) {
      routed.add(p);
    }
  }
  return routed;
}

function aggregateByPath(entries: ReadLogEntry[]): Map<string, { sessions: Set<string>; timestamps: string[] }> {
  const map = new Map<string, { sessions: Set<string>; timestamps: string[] }>();
  for (const entry of entries) {
    if (!map.has(entry.path)) {
      map.set(entry.path, { sessions: new Set(), timestamps: [] });
    }
    const agg = map.get(entry.path)!;
    agg.sessions.add(entry.session_id);
    agg.timestamps.push(entry.timestamp);
  }
  return map;
}

function findCandidates(
  aggregated: Map<string, { sessions: Set<string>; timestamps: string[] }>,
  routed: Set<string>
): Candidate[] {
  const candidates: Candidate[] = [];

  for (const [path, data] of aggregated) {
    if (data.sessions.size < THRESHOLD) continue;
    // Skip if already routed (check both as-is and with PAI/ prefix variants)
    if (routed.has(path) || routed.has(`PAI/${path}`)) continue;
    // Skip if any routed path ends with this file's basename
    const basename = path.split('/').pop() ?? path;
    const alreadyRouted = Array.from(routed).some(r => r.endsWith(basename));
    if (alreadyRouted) continue;

    const sorted = data.timestamps.sort();
    candidates.push({
      path,
      sessions: data.sessions.size,
      lastSeen: sorted[sorted.length - 1],
      firstSeen: sorted[0],
    });
  }

  return candidates.sort((a, b) => b.sessions - a.sessions);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const entries = loadLog();
const routed = loadRoutedPaths();
const aggregated = aggregateByPath(entries);
const candidates = findCandidates(aggregated, routed);

if (JSON_OUTPUT) {
  console.log(JSON.stringify({ threshold: THRESHOLD, days: DAYS, candidates }, null, 2));
  process.exit(0);
}

if (entries.length === 0) {
  console.log(`No read-log data found at ${LOG_FILE}`);
  console.log('ReadTracker.hook.ts must run for a few sessions before candidates appear.');
  process.exit(0);
}

if (candidates.length === 0) {
  console.log(`No routing candidates found (threshold: ${THRESHOLD} sessions, window: ${DAYS} days).`);
  console.log(`Tracked ${aggregated.size} unique paths across ${new Set(entries.map(e => e.session_id)).size} sessions.`);
  process.exit(0);
}

console.log(`\nRouting Candidates (read in ≥${THRESHOLD} sessions, last ${DAYS} days)\n`);
console.log(`${'Path'.padEnd(60)} Sessions  Last Seen`);
console.log('─'.repeat(85));

for (const c of candidates) {
  const lastDate = c.lastSeen.slice(0, 10);
  console.log(`${c.path.padEnd(60)} ${String(c.sessions).padEnd(9)} ${lastDate}`);
}

console.log(`\n${candidates.length} candidate(s). Run: bun PAI/Tools/RoutingAudit.ts propose --threshold ${THRESHOLD}`);
