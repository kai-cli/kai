#!/usr/bin/env bun

import { existsSync, readFileSync } from 'fs';
import { validateWorkItem, type WorkItem } from './orchestrator/schema';
import { runAdversarialReview } from './orchestrator/workflows/adversarial-review';
import { runPrReview } from './orchestrator/workflows/pr-review';

interface CliResult {
  status: 'complete' | 'fixed' | 'blocked' | 'failed';
  workItemId?: string;
  workflow?: string;
  reason: string;
  artifacts?: string[];
  packets?: string[];
  findings?: number;
  checkState?: string;
  commentsWritten?: number;
  errors?: string[];
  warnings?: string[];
}

function printHelp(): void {
  console.log(`PAI Orchestrator

Usage:
  pai orchestrator run <work-item.json> [--dry-run]
  pai orchestrator status <work-item-id>
  pai orchestrator resume <work-item-id>

Current 7.7 slice:
  - validates durable work-item schemas
  - fixture-backed dry-run only
  - no live agent, GitHub, push, merge, or public KAI mutation paths
`);
}

function printResult(result: CliResult): void {
  console.log(JSON.stringify(result, null, 2));
}

function readWorkItem(path: string): { workItem?: WorkItem; errors: string[]; warnings: string[] } {
  if (!existsSync(path)) return { errors: [`Work item file not found: ${path}`], warnings: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    const validation = validateWorkItem(parsed);
    return { workItem: validation.value, errors: validation.errors, warnings: validation.warnings };
  } catch (error) {
    return { errors: [`Failed to parse work item JSON: ${error instanceof Error ? error.message : String(error)}`], warnings: [] };
  }
}

export async function runCli(args: string[]): Promise<number> {
  const [command, firstArg, ...rest] = args;
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    printHelp();
    return 0;
  }

  if (command === 'run') {
    const dryRun = rest.includes('--dry-run');
    if (!firstArg) {
      printResult({ status: 'failed', reason: 'Missing work-item path.', errors: ['Usage: run <work-item.json> [--dry-run]'] });
      return 2;
    }
    const loaded = readWorkItem(firstArg);
    if (!loaded.workItem) {
      printResult({ status: 'failed', reason: 'Work item validation failed.', errors: loaded.errors, warnings: loaded.warnings });
      return 2;
    }
    if (!dryRun) {
      printResult({
        status: 'blocked',
        workItemId: loaded.workItem.id,
        workflow: loaded.workItem.type,
        reason: 'Workflow execution is not implemented in this 7.7 foundation slice. Re-run with --dry-run to validate only.',
        warnings: loaded.warnings,
      });
      return 2;
    }
    if (loaded.workItem.type === 'adversarial-review') {
      const result = await runAdversarialReview(loaded.workItem, { dryRun: true });
      printResult({
        status: result.status === 'failed' ? 'failed' : result.status === 'blocked' ? 'blocked' : 'complete',
        workItemId: result.workItemId,
        workflow: result.workflow,
        reason: result.decision.reason,
        artifacts: result.artifacts.map((artifact) => artifact.path ?? artifact.id),
        packets: result.packets.map((packet) => packet.id),
        findings: result.findings.length,
        warnings: result.warnings,
      });
      return result.status === 'failed' ? 2 : 0;
    }
    if (loaded.workItem.type === 'pr-review') {
      const result = await runPrReview(loaded.workItem, { dryRun: true });
      printResult({
        status: result.status === 'failed' ? 'failed' : result.status === 'blocked' ? 'blocked' : result.status === 'fixed' ? 'fixed' : 'complete',
        workItemId: result.workItemId,
        workflow: result.workflow,
        reason: result.decision.reason,
        artifacts: result.artifacts.map((artifact) => artifact.path ?? artifact.id),
        packets: result.packets.map((packet) => packet.id),
        findings: result.findings.length,
        checkState: result.checkState,
        commentsWritten: result.commentsWritten,
        warnings: result.warnings,
      });
      return result.status === 'failed' ? 2 : 0;
    }
    printResult({
      status: 'blocked',
      workItemId: loaded.workItem.id,
      workflow: loaded.workItem.type,
      reason: 'Dry-run validated the work item. Execution engines are intentionally not active in this foundation slice.',
      artifacts: [],
      warnings: loaded.warnings,
    });
    return 0;
  }

  if (command === 'status' || command === 'resume') {
    if (!firstArg) {
      printResult({ status: 'failed', reason: `Missing work-item id for ${command}.`, errors: [`Usage: ${command} <work-item-id>`] });
      return 2;
    }
    printResult({
      status: 'blocked',
      workItemId: firstArg,
      reason: `The ${command} command is reserved for the ledger slice and is not implemented yet.`,
    });
    return 2;
  }

  printResult({ status: 'failed', reason: `Unknown orchestrator command: ${command}`, errors: ['Use --help for usage.'] });
  return 2;
}

if (import.meta.main) {
  process.exit(await runCli(process.argv.slice(2)));
}
