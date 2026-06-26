#!/usr/bin/env bun
/**
 * codex-trust-bootstrap.ts — safely add the current repo to Codex trusted projects.
 *
 * This keeps the PAI/Codex default posture at `approval_policy = "on-request"` while removing the
 * repeated per-project trust setup for repos the maintainer explicitly chooses to trust.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export interface TrustBootstrapOptions {
  projectPath?: string;
  configPath?: string;
  dryRun?: boolean;
  cwd?: string;
}

export interface TrustBootstrapResult {
  configPath: string;
  projectPath: string;
  changed: boolean;
  content: string;
}

function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return `${homedir()}${path.slice(1)}`;
  return path;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

export function defaultCodexConfigPath(): string {
  return resolve(process.env.CODEX_HOME ? expandHome(process.env.CODEX_HOME) : `${homedir()}/.codex`, 'config.toml');
}

export function detectGitRoot(cwd = process.cwd()): string | null {
  const res = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
    timeout: 1000,
  });
  if (res.status !== 0) return null;
  return res.stdout.trim() || null;
}

export function resolveProjectPath(inputPath?: string, cwd = process.cwd()): string {
  if (inputPath) return resolve(expandHome(inputPath));
  return resolve(detectGitRoot(cwd) ?? cwd);
}

export function hasTrustedProject(content: string, projectPath: string): boolean {
  const table = findProjectTable(content, projectPath);
  return table ? table.trustLevel === 'trusted' : false;
}

interface ProjectTable {
  start: number;
  end: number;
  trustLine: number | null;
  trustLevel: string | null;
}

function parseProjectHeader(line: string): string | null {
  const match = line.match(/^\s*\[projects\.(("[^"\\]*(?:\\.[^"\\]*)*"))\]\s*$/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function findProjectTable(content: string, projectPath: string): ProjectTable | null {
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (parseProjectHeader(lines[i]) !== projectPath) continue;

    let end = lines.length;
    let trustLine: number | null = null;
    let trustLevel: string | null = null;

    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*\[/.test(lines[j])) {
        end = j;
        break;
      }
      const trust = lines[j].match(/^\s*trust_level\s*=\s*"([^"]*)"\s*(?:#.*)?$/);
      if (trust) {
        trustLine = j;
        trustLevel = trust[1];
      }
    }

    return { start: i, end, trustLine, trustLevel };
  }
  return null;
}

export function addTrustedProjectEntry(content: string, projectPath: string): { content: string; changed: boolean } {
  const table = findProjectTable(content, projectPath);
  if (table?.trustLevel === 'trusted') return { content, changed: false };

  if (table) {
    const newline = content.includes('\r\n') ? '\r\n' : '\n';
    const lines = content.split(/\r?\n/);
    if (table.trustLine !== null) {
      lines[table.trustLine] = 'trust_level = "trusted"';
    } else {
      let insertAt = table.end;
      while (insertAt > table.start + 1 && lines[insertAt - 1].trim() === '') insertAt--;
      lines.splice(insertAt, 0, 'trust_level = "trusted"');
    }
    return { content: lines.join(newline), changed: true };
  }

  const trimmed = content.replace(/\s*$/, '');
  const entry = `[projects.${tomlString(projectPath)}]\ntrust_level = "trusted"\n`;
  return {
    content: trimmed ? `${trimmed}\n\n${entry}` : entry,
    changed: true,
  };
}

export function bootstrapCodexTrust(options: TrustBootstrapOptions = {}): TrustBootstrapResult {
  const configPath = resolve(expandHome(options.configPath ?? defaultCodexConfigPath()));
  const projectPath = resolveProjectPath(options.projectPath, options.cwd);
  const before = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
  const { content, changed } = addTrustedProjectEntry(before, projectPath);

  if (changed && !options.dryRun) {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, content);
  }

  return { configPath, projectPath, changed, content };
}

function usage(): string {
  return `Usage: bun scripts/codex-trust-bootstrap.ts [--project PATH] [--config PATH] [--dry-run]

Adds a Codex trusted-project entry for the current git root by default.
Keeps approval policy unchanged; this does not enable approval_policy="never".
`;
}

function parseArgs(argv: string[]): TrustBootstrapOptions & { help?: boolean } {
  const out: TrustBootstrapOptions & { help?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--project') out.projectPath = argv[++i];
    else if (arg === '--config') out.configPath = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

if (import.meta.main) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      process.exit(0);
    }

    const result = bootstrapCodexTrust(args);
    const action = result.changed ? (args.dryRun ? 'would trust' : 'trusted') : 'already trusted';
    console.log(`Codex project ${action}: ${result.projectPath}`);
    console.log(`Config: ${result.configPath}`);
  } catch (err: any) {
    console.error(`codex-trust-bootstrap failed: ${err?.message ?? err}`);
    console.error(usage());
    process.exit(1);
  }
}
