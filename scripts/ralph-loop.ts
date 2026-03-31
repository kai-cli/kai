#!/usr/bin/env bun
/**
 * Ralph Loop — Autonomous PRD Execution for PAI
 *
 * Mode 1 (single): Invokes `claude -p` against one PRD until all ISC criteria pass.
 * Mode 2 (parallel): Splits criteria into child PRDs, spawns N parallel agents.
 *
 * Safety: max iterations, stuck detection, budget cap, CLI error circuit breaker,
 *         per-child tracking, orphan cleanup via SIGINT handler.
 *
 * Usage:
 *   bun run ralph-loop.ts <prd-path> [options]
 *   bun run ralph-loop.ts <prd-path> --parallel --max-agents 3 [options]
 */

import { parseArgs } from "util";
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, rmSync } from "fs";
import { join, dirname, resolve } from "path";

// --- Types ---

interface PRDState {
  phase: string;
  progress: string;
  passed: number;
  total: number;
  criteria: { id: string; text: string; done: boolean }[];
}

interface IterationLog {
  iteration: number;
  agent?: string;
  prd_path?: string;
  timestamp: string;
  phase_before: string;
  phase_after: string;
  passed_before: number;
  passed_after: number;
  delta: number;
  duration_ms: number;
  exit_code: number;
  stop_reason: string | null;
  aggregated?: boolean;
}

interface LoopOptions {
  maxIterations: number;
  maxBudgetUsd: number;
  stuckThreshold: number;
  model: string;
  permissionMode: string;
  notify: boolean;
  verbose: boolean;
  dryRun: boolean;
  // Parallel mode
  parallel: boolean;
  maxAgents: number;
  groups: string;
  useWorktree: boolean;
}

// --- PRD Parsing ---

function parsePRD(prdPath: string): PRDState {
  if (!existsSync(prdPath)) {
    throw new Error(`PRD not found: ${prdPath}`);
  }

  const content = readFileSync(prdPath, "utf-8");

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) throw new Error("No YAML frontmatter found in PRD");

  const fm = fmMatch[1];
  const phase = fm.match(/^phase:\s*(.+)$/m)?.[1]?.trim() ?? "unknown";
  const progress = fm.match(/^progress:\s*(.+)$/m)?.[1]?.trim() ?? "0/0";

  const criteria: PRDState["criteria"] = [];
  const criteriaRegex = /^- \[([ x])\] (ISC-\w+): (.+)$/gm;
  let match;
  while ((match = criteriaRegex.exec(content)) !== null) {
    criteria.push({
      id: match[2],
      text: match[3],
      done: match[1] === "x",
    });
  }

  const passed = criteria.filter((c) => c.done).length;
  const total = criteria.length;

  return { phase, progress, passed, total, criteria };
}

// --- Prompt Builders ---

function buildPrompt(prdPath: string, state: PRDState, iteration: number, maxIterations: number): string {
  const failing = state.criteria
    .filter((c) => !c.done)
    .map((c) => `  - ${c.id}: ${c.text}`)
    .join("\n");

  return `You are resuming autonomous work on an existing PAI PRD.

PRD path: ${prdPath}
Current phase: ${state.phase}
Progress: ${state.passed}/${state.total} criteria passed
Iteration: ${iteration}/${maxIterations}

INSTRUCTIONS:
1. Read the PRD at the path above
2. Your CLAUDE.md loads automatically — follow Algorithm instructions
3. Resume from the current phase — do NOT restart from OBSERVE
4. Work on the next failing criteria:
${failing}
5. After completing work, update the PRD: mark criteria - [x], update progress and phase
6. If ALL criteria pass, set phase to "complete" in the PRD frontmatter
7. If you encounter a criterion that requires human input, add a note to ## Decisions explaining why, and stop

Focus on making measurable progress. Every criterion you complete is progress.`;
}

function buildChildPrompt(
  childPrdPath: string,
  parentPrdPath: string,
  state: PRDState,
  iteration: number,
  maxIterations: number
): string {
  const failing = state.criteria
    .filter((c) => !c.done)
    .map((c) => `  - ${c.id}: ${c.text}`)
    .join("\n");

  return `You are an autonomous agent working on a subset of criteria from a parent PRD.

Child PRD path: ${childPrdPath}
Parent PRD path: ${parentPrdPath}
Progress: ${state.passed}/${state.total} of YOUR criteria passed
Iteration: ${iteration}/${maxIterations}

INSTRUCTIONS:
1. Read YOUR child PRD at the path above
2. You may also read the parent PRD for context, but do NOT modify it
3. Work on your assigned criteria only:
${failing}
4. Update YOUR child PRD: mark criteria [x], update progress and phase
5. If ALL your criteria pass, set your child PRD phase to "complete"
6. If a criterion requires human input, note it in ## Decisions and stop

Focus only on your assigned criteria. Other agents handle the rest.`;
}

// --- Claude Invocation ---

async function invokeClaudeP(
  prompt: string,
  options: LoopOptions,
  budgetPerInvocation: number,
  extraArgs: string[] = []
): Promise<{ exitCode: number; output: string; proc: ReturnType<typeof Bun.spawn> }> {
  const args = [
    "-p",
    prompt,
    "--output-format", "text",
    "--model", options.model,
    "--permission-mode", options.permissionMode,
    "--max-budget-usd", String(budgetPerInvocation),
    ...extraArgs,
  ];

  if (options.verbose) {
    console.log(`  [claude] model=${options.model}, budget=$${budgetPerInvocation.toFixed(2)}`);
  }

  const proc = Bun.spawn(["claude", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });

  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  return { exitCode, output, proc };
}

// --- Logging ---

function logIteration(logPath: string, entry: IterationLog): void {
  appendFileSync(logPath, JSON.stringify(entry) + "\n");
}

// --- Notification ---

function sendNotification(title: string, message: string): void {
  try {
    Bun.spawnSync([
      "osascript",
      "-e",
      `display notification "${message}" with title "${title}"`,
    ]);
  } catch {
    // Notification failure is non-fatal
  }
}

// --- Parallel Mode: Criteria Grouping ---

function parseGroups(groupsStr: string, criteria: PRDState["criteria"]): string[][] {
  // Filter out anti-criteria (ISC-A*) — they stay in parent
  const normalCriteria = criteria.filter((c) => !c.id.startsWith("ISC-A"));

  if (groupsStr) {
    // Manual groups: "1-8,9-16,17-24"
    return groupsStr.split(",").map((range) => {
      const [start, end] = range.trim().split("-").map(Number);
      return normalCriteria
        .filter((c) => {
          const num = parseInt(c.id.replace("ISC-", ""), 10);
          return num >= start && num <= end;
        })
        .map((c) => c.id);
    });
  }

  // Round-robin split — not specified, distribute evenly
  // This is handled by the caller using maxAgents
  return [];
}

function roundRobinGroups(criteria: PRDState["criteria"], maxAgents: number): string[][] {
  const normalCriteria = criteria.filter((c) => !c.id.startsWith("ISC-A"));
  const groups: string[][] = Array.from({ length: maxAgents }, () => []);

  normalCriteria.forEach((c, i) => {
    groups[i % maxAgents].push(c.id);
  });

  return groups.filter((g) => g.length > 0);
}

// --- Parallel Mode: Child PRD Creation ---

function createChildPRD(
  parentDir: string,
  childIndex: number,
  parentPrdPath: string,
  parentTask: string,
  criteriaIds: string[],
  allCriteria: PRDState["criteria"]
): string {
  const childDir = join(parentDir, "children");
  if (!existsSync(childDir)) mkdirSync(childDir, { recursive: true });

  const childPath = join(childDir, `child-${childIndex}.md`);
  const childCriteria = allCriteria.filter((c) => criteriaIds.includes(c.id));
  const criteriaLines = childCriteria
    .map((c) => `- [${c.done ? "x" : " "}] ${c.id}: ${c.text}`)
    .join("\n");

  const passed = childCriteria.filter((c) => c.done).length;

  const content = `---
task: "Child ${childIndex} of: ${parentTask}"
slug: child-${childIndex}
effort: standard
phase: execute
progress: ${passed}/${childCriteria.length}
mode: autonomous
started: ${new Date().toISOString()}
updated: ${new Date().toISOString()}
parent: ${resolve(parentPrdPath)}
---

## Context

Autonomous child agent working on criteria subset from parent PRD.
Parent: ${resolve(parentPrdPath)}
Criteria assigned: ${criteriaIds[0]} through ${criteriaIds[criteriaIds.length - 1]}

## Criteria

${criteriaLines}

## Decisions

## Verification
`;

  writeFileSync(childPath, content);
  return childPath;
}

// --- Parallel Mode: Progress Aggregation ---

function aggregateChildrenToParent(parentPrdPath: string, childPaths: string[]): { totalDelta: number } {
  const parentContent = readFileSync(parentPrdPath, "utf-8");
  let updatedContent = parentContent;
  let totalDelta = 0;

  for (const childPath of childPaths) {
    if (!existsSync(childPath)) continue;
    const childState = parsePRD(childPath);

    for (const criterion of childState.criteria) {
      if (criterion.done) {
        // Mark corresponding parent criterion as done
        const unchecked = `- [ ] ${criterion.id}:`;
        const checked = `- [x] ${criterion.id}:`;
        if (updatedContent.includes(unchecked)) {
          updatedContent = updatedContent.replace(unchecked, checked);
          totalDelta++;
        }
      }
    }
  }

  if (totalDelta > 0) {
    // Update progress count in frontmatter
    const parentState = parsePRD(parentPrdPath);
    const newPassed = parentState.passed + totalDelta;
    updatedContent = updatedContent.replace(
      /^progress:\s*.+$/m,
      `progress: ${newPassed}/${parentState.total}`
    );
    updatedContent = updatedContent.replace(
      /^updated:\s*.+$/m,
      `updated: ${new Date().toISOString()}`
    );
    writeFileSync(parentPrdPath, updatedContent);
  }

  return { totalDelta };
}

// --- Orphan Cleanup ---

const activeProcesses: Set<ReturnType<typeof Bun.spawn>> = new Set();

function killAllChildren(): void {
  for (const proc of activeProcesses) {
    try {
      proc.kill();
    } catch {
      // Process may have already exited
    }
  }
  activeProcesses.clear();
}

process.on("SIGINT", () => {
  console.log("\n\nSIGINT received — killing all child processes...");
  killAllChildren();
  process.exit(10);
});

process.on("SIGTERM", () => {
  killAllChildren();
  process.exit(10);
});

// --- Single Mode Loop ---

async function runSingleMode(prdPath: string, opts: LoopOptions, logPath: string): Promise<never> {
  let consecutiveNoProgress = 0;
  let consecutiveErrors = 0;
  const budgetPerInvocation = opts.maxBudgetUsd / opts.maxIterations;

  for (let iteration = 1; iteration <= opts.maxIterations; iteration++) {
    const iterStart = Date.now();
    const before = parsePRD(prdPath);

    if (before.phase === "complete" || before.passed === before.total) {
      console.log(`\n[${iteration}] PRD complete! ${before.passed}/${before.total} criteria passed.`);
      if (opts.notify) sendNotification("Ralph Loop", `PRD complete! ${before.passed}/${before.total}`);
      process.exit(0);
    }

    console.log(`[${iteration}/${opts.maxIterations}] Phase: ${before.phase} | Progress: ${before.passed}/${before.total} | Stuck: ${consecutiveNoProgress}/${opts.stuckThreshold}`);

    const prompt = buildPrompt(prdPath, before, iteration, opts.maxIterations);
    const { exitCode, output } = await invokeClaudeP(prompt, opts, budgetPerInvocation);
    const duration = Date.now() - iterStart;

    // Log agent output for diagnostics
    if (opts.verbose && output) {
      const outputPath = logPath.replace('.log', `.iter${iteration}.output.txt`);
      try { writeFileSync(outputPath, output); } catch {}
      console.log(`  Output: ${output.length} chars → ${outputPath}`);
    }

    if (exitCode !== 0) {
      consecutiveErrors++;
      console.log(`  ERROR: claude exited with code ${exitCode} (${consecutiveErrors}/3)`);
      if (consecutiveErrors >= 3) {
        logIteration(logPath, { iteration, timestamp: new Date().toISOString(), phase_before: before.phase, phase_after: before.phase, passed_before: before.passed, passed_after: before.passed, delta: 0, duration_ms: duration, exit_code: exitCode, stop_reason: "cli_error_circuit_breaker" });
        console.log("\nCircuit breaker: 3 consecutive CLI errors. Stopping.");
        if (opts.notify) sendNotification("Ralph Loop", "Stopped: CLI error circuit breaker");
        process.exit(4);
      }
      continue;
    }
    consecutiveErrors = 0;

    const after = parsePRD(prdPath);
    const delta = after.passed - before.passed;

    logIteration(logPath, { iteration, timestamp: new Date().toISOString(), phase_before: before.phase, phase_after: after.phase, passed_before: before.passed, passed_after: after.passed, delta, duration_ms: duration, exit_code: exitCode, stop_reason: null });
    console.log(`  Done in ${(duration / 1000).toFixed(1)}s | Delta: +${delta} criteria | Now: ${after.passed}/${after.total}`);

    if (after.phase === "complete" || after.passed === after.total) {
      console.log(`\nPRD complete! All ${after.total} criteria passed.`);
      if (opts.notify) sendNotification("Ralph Loop", `PRD complete! ${after.total}/${after.total}`);
      process.exit(0);
    }

    if (delta === 0) {
      consecutiveNoProgress++;
      if (consecutiveNoProgress >= opts.stuckThreshold) {
        logIteration(logPath, { iteration: iteration + 1, timestamp: new Date().toISOString(), phase_before: after.phase, phase_after: after.phase, passed_before: after.passed, passed_after: after.passed, delta: 0, duration_ms: 0, exit_code: 0, stop_reason: "stuck_detection" });
        console.log(`\nStuck detection: ${opts.stuckThreshold} consecutive iterations with no progress.`);
        after.criteria.filter((c) => !c.done).forEach((c) => console.log(`  [ ] ${c.id}: ${c.text}`));
        if (opts.notify) sendNotification("Ralph Loop", "Stopped: stuck detection");
        process.exit(2);
      }
    } else {
      consecutiveNoProgress = 0;
    }
  }

  const finalState = parsePRD(prdPath);
  console.log(`\nMax iterations (${opts.maxIterations}) reached. Progress: ${finalState.passed}/${finalState.total}`);
  if (opts.notify) sendNotification("Ralph Loop", `Max iterations reached: ${finalState.passed}/${finalState.total}`);
  process.exit(1);
}

// --- Parallel Mode Loop ---

async function runParallelMode(prdPath: string, opts: LoopOptions, logPath: string): Promise<never> {
  const parentState = parsePRD(prdPath);
  const parentDir = dirname(prdPath);
  const parentTask = readFileSync(prdPath, "utf-8").match(/^task:\s*(.+)$/m)?.[1]?.trim() ?? "unknown";

  // Determine groups
  let groups: string[][];
  if (opts.groups) {
    groups = parseGroups(opts.groups, parentState.criteria);
  } else {
    groups = roundRobinGroups(parentState.criteria, opts.maxAgents);
  }

  if (groups.length === 0) {
    console.error("No criteria groups could be formed. Check --groups or criteria.");
    process.exit(6);
  }

  const actualAgents = Math.min(groups.length, opts.maxAgents);
  const budgetPerAgent = opts.maxBudgetUsd / actualAgents;
  const budgetPerAgentPerIteration = budgetPerAgent / opts.maxIterations;

  // Create child PRDs
  const childPaths: string[] = [];
  for (let i = 0; i < actualAgents; i++) {
    const childPath = createChildPRD(parentDir, i + 1, prdPath, parentTask, groups[i], parentState.criteria);
    childPaths.push(childPath);
  }

  const antiCriteria = parentState.criteria.filter((c) => c.id.startsWith("ISC-A"));

  console.log(`\n=== Ralph Loop — Parallel Mode ===`);
  console.log(`Parent PRD: ${prdPath}`);
  console.log(`Agents: ${actualAgents}`);
  console.log(`Budget per agent: $${budgetPerAgent.toFixed(2)}`);
  console.log(`Anti-criteria (parent-checked): ${antiCriteria.length}`);
  for (let i = 0; i < actualAgents; i++) {
    console.log(`  Child ${i + 1}: ${groups[i].length} criteria [${groups[i][0]}..${groups[i][groups[i].length - 1]}]`);
  }
  console.log();

  if (opts.dryRun) {
    console.log("--- DRY RUN (parallel) ---");
    for (let i = 0; i < actualAgents; i++) {
      console.log(`\n--- Child ${i + 1} PRD ---`);
      console.log(readFileSync(childPaths[i], "utf-8"));
    }
    console.log("\n--- Child 1 prompt sample ---");
    const childState = parsePRD(childPaths[0]);
    console.log(buildChildPrompt(childPaths[0], prdPath, childState, 1, opts.maxIterations));
    // Cleanup child PRDs on dry run
    rmSync(join(parentDir, "children"), { recursive: true, force: true });
    process.exit(0);
  }

  // Per-child tracking
  const stuckCounters = new Map<string, number>();
  const errorCounters = new Map<string, number>();
  const completedChildren = new Set<string>();

  for (let iteration = 1; iteration <= opts.maxIterations; iteration++) {
    const iterStart = Date.now();

    // Determine which children still need work
    const activeChildren = childPaths.filter((p) => !completedChildren.has(p));
    if (activeChildren.length === 0) break;

    console.log(`[Round ${iteration}/${opts.maxIterations}] Active agents: ${activeChildren.length}/${actualAgents}`);

    // Spawn all active children in parallel
    const childPromises = activeChildren.map(async (childPath, idx) => {
      const childState = parsePRD(childPath);
      if (childState.phase === "complete" || childState.passed === childState.total) {
        completedChildren.add(childPath);
        return { childPath, exitCode: 0, delta: 0, duration: 0, skipped: true };
      }

      const beforePassed = childState.passed;
      const prompt = buildChildPrompt(childPath, prdPath, childState, iteration, opts.maxIterations);
      const extraArgs = opts.useWorktree ? ["--worktree", `child-${idx + 1}`] : [];

      const childStart = Date.now();
      const { exitCode, proc } = await invokeClaudeP(prompt, opts, budgetPerAgentPerIteration, extraArgs);
      activeProcesses.delete(proc);
      const duration = Date.now() - childStart;

      const afterState = parsePRD(childPath);
      const delta = afterState.passed - beforePassed;

      return { childPath, exitCode, delta, duration, skipped: false, beforePassed, afterPassed: afterState.passed };
    });

    const results = await Promise.allSettled(childPromises);
    const roundDuration = Date.now() - iterStart;

    // Process results
    let roundTotalDelta = 0;
    let allStuckOrErrored = true;

    for (const result of results) {
      if (result.status === "rejected") continue;
      const r = result.value;
      if (r.skipped) continue;

      const childName = r.childPath.split("/").pop()!.replace(".md", "");

      // Handle errors
      if (r.exitCode !== 0) {
        const errCount = (errorCounters.get(r.childPath) ?? 0) + 1;
        errorCounters.set(r.childPath, errCount);
        console.log(`  ${childName}: ERROR (exit ${r.exitCode}, ${errCount}/3)`);
        if (errCount >= 3) {
          completedChildren.add(r.childPath); // Stop this child
          console.log(`  ${childName}: Circuit breaker — removing from active pool`);
        }
        continue;
      }
      errorCounters.set(r.childPath, 0);

      // Log child iteration
      const childState = parsePRD(r.childPath);
      logIteration(logPath, {
        iteration,
        agent: childName,
        prd_path: r.childPath,
        timestamp: new Date().toISOString(),
        phase_before: "execute",
        phase_after: childState.phase,
        passed_before: r.beforePassed!,
        passed_after: r.afterPassed!,
        delta: r.delta,
        duration_ms: r.duration,
        exit_code: 0,
        stop_reason: null,
      });

      console.log(`  ${childName}: +${r.delta} criteria in ${(r.duration / 1000).toFixed(1)}s (${r.afterPassed}/${childState.total})`);

      // Stuck detection per child
      if (r.delta === 0) {
        const sc = (stuckCounters.get(r.childPath) ?? 0) + 1;
        stuckCounters.set(r.childPath, sc);
        if (sc >= opts.stuckThreshold) {
          completedChildren.add(r.childPath);
          console.log(`  ${childName}: Stuck (${sc}/${opts.stuckThreshold}) — removing from active pool`);
          logIteration(logPath, { iteration, agent: childName, prd_path: r.childPath, timestamp: new Date().toISOString(), phase_before: childState.phase, phase_after: childState.phase, passed_before: r.afterPassed!, passed_after: r.afterPassed!, delta: 0, duration_ms: 0, exit_code: 0, stop_reason: "stuck_detection" });
        }
      } else {
        stuckCounters.set(r.childPath, 0);
        allStuckOrErrored = false;
      }

      roundTotalDelta += r.delta;

      // Mark child complete if all its criteria pass
      if (childState.phase === "complete" || childState.passed === childState.total) {
        completedChildren.add(r.childPath);
        console.log(`  ${childName}: COMPLETE (${childState.passed}/${childState.total})`);
      }
    }

    // Aggregate to parent
    const { totalDelta: aggregatedDelta } = aggregateChildrenToParent(prdPath, childPaths);
    const parentAfter = parsePRD(prdPath);

    logIteration(logPath, {
      iteration,
      agent: "parent",
      prd_path: prdPath,
      timestamp: new Date().toISOString(),
      phase_before: parentAfter.phase,
      phase_after: parentAfter.phase,
      passed_before: parentAfter.passed - aggregatedDelta,
      passed_after: parentAfter.passed,
      delta: aggregatedDelta,
      duration_ms: roundDuration,
      exit_code: 0,
      stop_reason: null,
      aggregated: true,
    });

    console.log(`  [Aggregated] Parent: ${parentAfter.passed}/${parentAfter.total} | Round delta: +${aggregatedDelta} | Time: ${(roundDuration / 1000).toFixed(1)}s`);

    // Check parent completion (non-anti criteria all done)
    const nonAntiPassed = parentAfter.criteria.filter((c) => !c.id.startsWith("ISC-A") && c.done).length;
    const nonAntiTotal = parentAfter.criteria.filter((c) => !c.id.startsWith("ISC-A")).length;
    if (nonAntiPassed === nonAntiTotal) {
      console.log(`\nAll non-anti criteria passed (${nonAntiPassed}/${nonAntiTotal}). Check anti-criteria manually.`);
      if (opts.notify) sendNotification("Ralph Loop", `Parallel complete! ${parentAfter.passed}/${parentAfter.total}`);
      process.exit(0);
    }

    // All children stuck or errored
    if (allStuckOrErrored && completedChildren.size >= actualAgents) {
      console.log("\nAll children stuck or errored. Stopping.");
      if (opts.notify) sendNotification("Ralph Loop", "All agents stuck");
      process.exit(2);
    }
  }

  const finalState = parsePRD(prdPath);
  console.log(`\nMax iterations (${opts.maxIterations}) reached. Progress: ${finalState.passed}/${finalState.total}`);
  if (opts.notify) sendNotification("Ralph Loop", `Max iterations: ${finalState.passed}/${finalState.total}`);
  process.exit(1);
}

// --- Main ---

async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      "max-iterations": { type: "string", default: "5" },
      "max-budget-usd": { type: "string", default: "5.00" },
      "stuck-threshold": { type: "string", default: "3" },
      model: { type: "string", default: "opus" },
      "permission-mode": { type: "string", default: "auto" },
      notify: { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      // Parallel options
      parallel: { type: "boolean", default: false },
      "max-agents": { type: "string", default: "3" },
      groups: { type: "string", default: "" },
      worktree: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  const prdPath = positionals[0];
  if (!prdPath) {
    console.error("Usage: bun run ralph-loop.ts <prd-path> [options]");
    console.error("       bun run ralph-loop.ts <prd-path> --parallel [--max-agents 3] [--groups '1-8,9-16']");
    process.exit(5);
  }

  const opts: LoopOptions = {
    maxIterations: parseInt(values["max-iterations"]!, 10),
    maxBudgetUsd: parseFloat(values["max-budget-usd"]!),
    stuckThreshold: parseInt(values["stuck-threshold"]!, 10),
    model: values.model!,
    permissionMode: values["permission-mode"]!,
    notify: values.notify!,
    verbose: values.verbose!,
    dryRun: values["dry-run"]!,
    parallel: values.parallel!,
    maxAgents: parseInt(values["max-agents"]!, 10),
    groups: values.groups!,
    useWorktree: values.worktree!,
  };

  // Parse initial state
  let state: PRDState;
  try {
    state = parsePRD(prdPath);
  } catch (e: any) {
    console.error(`PRD parse error: ${e.message}`);
    process.exit(5);
  }

  const logPath = join(dirname(prdPath), "ralph-loop.log");

  if (!opts.parallel) {
    // Single mode header
    console.log(`\n=== Ralph Loop ===`);
    console.log(`PRD: ${prdPath}`);
    console.log(`Phase: ${state.phase}`);
    console.log(`Progress: ${state.passed}/${state.total}`);
    console.log(`Max iterations: ${opts.maxIterations}`);
    console.log(`Budget: $${opts.maxBudgetUsd.toFixed(2)}`);
    console.log(`Stuck threshold: ${opts.stuckThreshold}`);
    console.log(`Model: ${opts.model}`);
    console.log(`Log: ${logPath}\n`);

    if (state.phase === "complete") {
      console.log("PRD already complete. Nothing to do.");
      process.exit(0);
    }

    if (opts.dryRun) {
      console.log("--- DRY RUN ---");
      console.log("Failing criteria:");
      state.criteria.filter((c) => !c.done).forEach((c) => console.log(`  [ ] ${c.id}: ${c.text}`));
      console.log("\nPrompt that would be sent:");
      console.log(buildPrompt(prdPath, state, 1, opts.maxIterations));
      process.exit(0);
    }

    await runSingleMode(prdPath, opts, logPath);
  } else {
    await runParallelMode(prdPath, opts, logPath);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(`Fatal error: ${e.message}`);
  killAllChildren();
  process.exit(5);
});
