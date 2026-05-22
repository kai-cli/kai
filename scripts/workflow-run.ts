#!/usr/bin/env bun
/**
 * workflow-run.ts — YAML workflow template runner
 *
 * Loads a workflow template, substitutes {{variable}} placeholders,
 * and executes the resulting command.
 *
 * Usage:
 *   bun scripts/workflow-run.ts <workflow-name> [--key value ...]
 *   bun scripts/workflow-run.ts --list
 *   bun scripts/workflow-run.ts <workflow-name> --help
 *
 * Trusted paths:
 *   System:  ~/.claude/workflows/   (or PAI_DIR/workflows/ via env var)
 *   Repo:    ./workflows/
 *   Project: ~/.claude/projects/{project}/workflows/
 *
 * Cloned-repo workflows (repo/.workflows/, repo/WORKFLOWS/) are NOT auto-trusted.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, basename } from 'path';
import { execSync } from 'child_process';

interface WorkflowArgument {
  name: string;
  description?: string;
  default?: string;
  required?: boolean;
  options?: string[];
}

interface WorkflowTemplate {
  name: string;
  description: string;
  command: string;
  arguments?: WorkflowArgument[];
  tags?: string[];
}

// ─── Trusted search paths ────────────────────────────────────────────────────

function getTrustedPaths(): string[] {
  const paths: string[] = [];

  // 1. Repo-local workflows/ (always trusted: user wrote them)
  const repoWorkflows = join(process.cwd(), 'workflows');
  if (existsSync(repoWorkflows)) paths.push(repoWorkflows);

  // 2. PAI system workflows (PAI_DIR env var)
  const paiDir = process.env.PAI_DIR;
  if (paiDir) {
    const systemWorkflows = join(paiDir, 'workflows');
    if (existsSync(systemWorkflows)) paths.push(systemWorkflows);
  }

  // 3. ~/.claude/workflows/
  const homeWorkflows = join(process.env.HOME ?? '', '.claude', 'workflows');
  if (existsSync(homeWorkflows)) paths.push(homeWorkflows);

  return paths;
}

// ─── Template loading ─────────────────────────────────────────────────────────

function parseYAMLWorkflow(content: string, filePath: string): WorkflowTemplate {
  // Minimal YAML parser for our fixed workflow schema.
  // We only support the specific fields used in workflow templates —
  // not a general-purpose YAML parser.
  const lines = content.split('\n');
  const result: Partial<WorkflowTemplate> = { arguments: [], tags: [] };
  let inCommand = false;
  let commandLines: string[] = [];
  let inArguments = false;
  let currentArg: Partial<WorkflowArgument> | null = null;

  for (const line of lines) {
    // Detect multi-line command block (|)
    if (/^command:\s*\|/.test(line)) {
      inCommand = true;
      inArguments = false;
      commandLines = [];
      continue;
    }

    if (/^arguments:/.test(line)) {
      if (inCommand) {
        result.command = commandLines.join('\n').trim();
        inCommand = false;
      }
      inArguments = true;
      continue;
    }

    if (/^tags:/.test(line)) {
      if (inCommand) {
        result.command = commandLines.join('\n').trim();
        inCommand = false;
      }
      inArguments = false;
      if (currentArg) {
        result.arguments!.push(currentArg as WorkflowArgument);
        currentArg = null;
      }
      continue;
    }

    if (inCommand) {
      // Command block lines are indented with spaces
      if (line.startsWith('  ') || line.startsWith('\t') || line === '') {
        commandLines.push(line.replace(/^  /, ''));
      } else {
        result.command = commandLines.join('\n').trim();
        inCommand = false;
      }
    }

    // Simple top-level fields
    const nameMatch = line.match(/^name:\s*(.+)/);
    if (nameMatch) result.name = nameMatch[1].trim().replace(/^["']|["']$/g, '');

    const descMatch = line.match(/^description:\s*(.+)/);
    if (descMatch) result.description = descMatch[1].trim().replace(/^["']|["']$/g, '');

    const singleLineCmd = line.match(/^command:\s*(?!\|)(.+)/);
    if (singleLineCmd) result.command = singleLineCmd[1].trim().replace(/^["']|["']$/g, '');

    // Argument fields (indented under `arguments:`)
    if (inArguments) {
      const argName = line.match(/^\s*- name:\s*(.+)/);
      if (argName) {
        if (currentArg) result.arguments!.push(currentArg as WorkflowArgument);
        currentArg = { name: argName[1].trim() };
        continue;
      }
      if (currentArg) {
        const argDesc = line.match(/^\s+description:\s*(.+)/);
        if (argDesc) currentArg.description = argDesc[1].trim().replace(/^["']|["']$/g, '');
        const argDef = line.match(/^\s+default:\s*(.+)/);
        if (argDef) currentArg.default = argDef[1].trim();
        const argReq = line.match(/^\s+required:\s*(true|false)/);
        if (argReq) currentArg.required = argReq[1] === 'true';
      }
    }
  }

  if (inCommand && commandLines.length > 0) {
    result.command = commandLines.join('\n').trim();
  }
  if (currentArg) result.arguments!.push(currentArg as WorkflowArgument);

  if (!result.name || !result.command) {
    throw new Error(`Invalid workflow at ${filePath}: missing name or command`);
  }

  return result as WorkflowTemplate;
}

function loadWorkflow(name: string): WorkflowTemplate | null {
  const searchPaths = getTrustedPaths();

  // Project-level shadows system-level (same name → project wins)
  // searchPaths is ordered: repo first, then system, then home
  for (const dir of searchPaths) {
    const filePath = join(dir, `${name}.yaml`);
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf8');
      return parseYAMLWorkflow(content, filePath);
    }
  }

  return null;
}

function listWorkflows(): WorkflowTemplate[] {
  const seen = new Set<string>();
  const workflows: WorkflowTemplate[] = [];
  const searchPaths = getTrustedPaths();

  for (const dir of searchPaths) {
    try {
      const files = readdirSync(dir).filter(f => f.endsWith('.yaml') && f !== 'README.yaml');
      for (const file of files) {
        const wfName = basename(file, '.yaml');
        if (seen.has(wfName)) continue; // project shadows system
        seen.add(wfName);
        try {
          const content = readFileSync(join(dir, file), 'utf8');
          workflows.push(parseYAMLWorkflow(content, join(dir, file)));
        } catch {
          // Skip malformed workflows
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  return workflows;
}

// ─── Argument substitution ────────────────────────────────────────────────────

export function substituteArgs(
  command: string,
  template: WorkflowTemplate,
  provided: Record<string, string>
): string {
  // Check for required but missing arguments
  for (const arg of template.arguments ?? []) {
    if (arg.required && !(arg.name in provided) && !arg.default) {
      throw new Error(
        `Missing required argument: --${arg.name}\n` +
        `  Description: ${arg.description ?? 'no description'}\n` +
        `  Usage: bun scripts/workflow-run.ts ${template.name} --${arg.name} <value>`
      );
    }
  }

  // Substitute {{variable}} placeholders — only from known arguments
  let result = command;
  for (const arg of template.arguments ?? []) {
    const value = provided[arg.name] ?? arg.default ?? '';
    result = result.replace(new RegExp(`\\{\\{${arg.name}\\}\\}`, 'g'), value);
  }

  // Verify no unresolved placeholders remain (would indicate template bug)
  const unresolved = result.match(/\{\{[^}]+\}\}/g);
  if (unresolved) {
    throw new Error(`Unresolved template variables: ${unresolved.join(', ')}`);
  }

  return result;
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { workflowName: string | null; args: Record<string, string>; list: boolean; help: boolean } {
  const result = { workflowName: null as string | null, args: {} as Record<string, string>, list: false, help: false };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--list') { result.list = true; i++; continue; }
    if (arg === '--help' || arg === '-h') { result.help = true; i++; continue; }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = argv[i + 1] ?? '';
      result.args[key] = value;
      i += 2;
      continue;
    }
    if (!result.workflowName) result.workflowName = arg;
    i++;
  }

  return result;
}

function printHelp(template: WorkflowTemplate): void {
  console.log(`\nWorkflow: ${template.name}`);
  console.log(`  ${template.description}`);
  if (template.arguments?.length) {
    console.log('\nArguments:');
    for (const arg of template.arguments) {
      const req = arg.required ? ' (required)' : '';
      const def = arg.default ? ` [default: ${arg.default}]` : '';
      const opts = arg.options?.length ? ` [options: ${arg.options.join(', ')}]` : '';
      console.log(`  --${arg.name}${req}${def}${opts}`);
      if (arg.description) console.log(`    ${arg.description}`);
    }
  }
  if (template.tags?.length) {
    console.log(`\nTags: ${template.tags.join(', ')}`);
  }
  console.log('');
}

async function main() {
  const argv = process.argv.slice(2);
  const { workflowName, args, list, help } = parseArgs(argv);

  if (list) {
    const workflows = listWorkflows();
    if (workflows.length === 0) {
      console.log('No workflows found in trusted paths.');
      return;
    }
    console.log('\nAvailable workflows:');
    for (const wf of workflows) {
      console.log(`  ${wf.name.padEnd(24)} ${wf.description}`);
    }
    console.log('');
    return;
  }

  if (!workflowName) {
    console.error('Usage: bun scripts/workflow-run.ts <workflow-name> [--key value ...]');
    console.error('       bun scripts/workflow-run.ts --list');
    process.exit(1);
  }

  const template = loadWorkflow(workflowName);
  if (!template) {
    console.error(`Workflow not found: ${workflowName}`);
    console.error('Run --list to see available workflows.');
    process.exit(1);
  }

  if (help) {
    printHelp(template);
    return;
  }

  let command: string;
  try {
    command = substituteArgs(template.command, template, args);
  } catch (err: any) {
    console.error(err.message);
    process.exit(1);
  }

  console.error(`[workflow-run] Executing: ${workflowName}`);
  execSync(command, { stdio: 'inherit', shell: '/bin/bash' });
}

if (import.meta.main) {
  main().catch(err => {
    console.error('[workflow-run] Error:', err.message);
    process.exit(1);
  });
}
