#!/usr/bin/env bun
/**
 * RoutingAudit.ts — Audit and sync CONTEXT_ROUTING.md
 *
 * Modes:
 *   audit  — Check all paths, report stale/missing (default)
 *   sync   — Discover new project memory dirs, add to routing table
 *   fix    — Remove dead paths + add discovered ones
 *
 * Usage:
 *   bun RoutingAudit.ts                # audit only
 *   bun RoutingAudit.ts sync           # audit + show proposed additions
 *   bun RoutingAudit.ts fix            # audit + apply fixes
 *   bun RoutingAudit.ts --json         # machine-readable output
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { getPaiDir } from '../../hooks/lib/paths';

const HOME = homedir();
const paiDir = getPaiDir();
const ROUTING_FILE = join(paiDir, 'PAI', 'CONTEXT_ROUTING.md');
const PROJECTS_DIR = join(HOME, 'Projects');
const MEMORY_BASE = join(HOME, '.claude', 'projects');
const MEM_PREFIX = '-Users-your.name-Projects-';

interface AuditResult {
  ok: string[];
  stale: string[];
  discovered: { project: string; memoryDir: string; fileCount: number }[];
  timestamp: string;
}

function expandPath(p: string): string {
  let expanded = p.replace(/^~/, HOME);
  expanded = expanded.replace(/\$\{PROJECTS_DIR\}/g, PROJECTS_DIR);
  expanded = expanded.replace(/\$HOME/g, HOME);
  return expanded;
}

function extractPaths(content: string): string[] {
  const paths: string[] = [];
  const re = /`([^`]+)`/g;
  let match;
  while ((match = re.exec(content)) !== null) {
    const p = match[1];
    if (p.startsWith('gh ') || p.startsWith('{MEM}') || p.includes('|') || p === 'Path' || p.endsWith('-')) continue;
    if (p.startsWith('PAI/') || p.startsWith('~/') || p.startsWith('~/.claude/')) {
      paths.push(p);
    }
  }
  return paths;
}

function resolveForCheck(p: string): string {
  if (p.startsWith('PAI/')) return join(paiDir, p);
  return expandPath(p);
}

function discoverNewProjects(content: string): AuditResult['discovered'] {
  const discovered: AuditResult['discovered'] = [];
  if (!existsSync(MEMORY_BASE)) return discovered;

  const existingProjects = new Set<string>();
  const memRe = /\{MEM\}([^/]+)/g;
  let m;
  while ((m = memRe.exec(content)) !== null) {
    existingProjects.add(m[1]);
  }

  const dirs = readdirSync(MEMORY_BASE).filter(d => d.startsWith(MEM_PREFIX));
  for (const dir of dirs) {
    const project = dir.replace(MEM_PREFIX, '');
    if (existingProjects.has(project)) continue;

    const memDir = join(MEMORY_BASE, dir, 'memory');
    if (!existsSync(memDir)) continue;

    const files = readdirSync(memDir).filter(f => f.endsWith('.md'));
    if (files.length === 0) continue;

    discovered.push({ project, memoryDir: memDir, fileCount: files.length });
  }
  return discovered;
}

function generateMemorySection(project: string, memDir: string): string {
  const files = readdirSync(memDir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md');
  const lines: string[] = [];
  const fileCount = files.length + 1;

  lines.push(`### ${project} (${fileCount} files)`);
  lines.push('');
  lines.push('| Topic | Path |');
  lines.push('|-------|------|');
  lines.push(`| Index | \`{MEM}${project}/memory/MEMORY.md\` |`);

  for (const f of files.sort()) {
    const name = f.replace('.md', '').replace(/_/g, ' ');
    lines.push(`| ${name} | \`{MEM}${project}/memory/${f}\` |`);
  }

  return lines.join('\n');
}

function run() {
  const args = process.argv.slice(2);
  const mode = args.find(a => !a.startsWith('-')) || 'audit';
  const jsonOutput = args.includes('--json');

  if (!existsSync(ROUTING_FILE)) {
    console.error(`Context routing file not found: ${ROUTING_FILE}`);
    process.exit(1);
  }

  const content = readFileSync(ROUTING_FILE, 'utf-8');
  const paths = extractPaths(content);

  const result: AuditResult = {
    ok: [],
    stale: [],
    discovered: [],
    timestamp: new Date().toISOString(),
  };

  for (const p of paths) {
    const resolved = resolveForCheck(p);
    if (existsSync(resolved)) {
      result.ok.push(p);
    } else {
      result.stale.push(p);
    }
  }

  result.discovered = discoverNewProjects(content);

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Context Routing Audit — ${result.ok.length} ok, ${result.stale.length} stale, ${result.discovered.length} new`);
  console.log('');

  if (result.stale.length > 0) {
    console.log('STALE (path does not exist):');
    for (const p of result.stale) {
      console.log(`  ✗ ${p}`);
    }
    console.log('');
  }

  if (result.discovered.length > 0) {
    console.log('DISCOVERED (project memory not in routing table):');
    for (const d of result.discovered) {
      console.log(`  + ${d.project} (${d.fileCount} memory files)`);
    }
    console.log('');
  }

  if (mode === 'fix' && (result.stale.length > 0 || result.discovered.length > 0)) {
    let updated = content;

    for (const stale of result.stale) {
      const escaped = stale.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const lineRe = new RegExp(`\\|[^|]*\\|[^|]*\`${escaped}\`[^|]*\\|\\n?`, 'g');
      updated = updated.replace(lineRe, '');
    }

    if (result.discovered.length > 0) {
      const sections: string[] = [];
      for (const d of result.discovered) {
        sections.push(generateMemorySection(d.project, d.memoryDir));
      }
      updated = updated.trimEnd() + '\n\n' + sections.join('\n\n') + '\n';
    }

    writeFileSync(ROUTING_FILE, updated);
    console.log(`Applied: removed ${result.stale.length} stale, added ${result.discovered.length} new sections`);
  } else if (mode === 'sync' && result.discovered.length > 0) {
    let updated = content;
    const sections: string[] = [];
    for (const d of result.discovered) {
      sections.push(generateMemorySection(d.project, d.memoryDir));
    }
    updated = updated.trimEnd() + '\n\n' + sections.join('\n\n') + '\n';
    writeFileSync(ROUTING_FILE, updated);
    console.log(`Added ${result.discovered.length} new project sections`);
  }

  if (result.stale.length === 0 && result.discovered.length === 0) {
    console.log('All paths valid, no new projects found.');
  }

  // Write drift state for hook consumption
  const stateDir = join(paiDir, 'MEMORY', 'STATE');
  const driftFile = join(stateDir, 'routing-drift.json');
  writeFileSync(driftFile, JSON.stringify({
    lastAudit: result.timestamp,
    staleCount: result.stale.length,
    discoveredCount: result.discovered.length,
    stale: result.stale,
    discovered: result.discovered.map(d => d.project),
  }, null, 2));
}

run();
