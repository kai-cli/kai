/**
 * algorithm/loop.ts - Loop mode execution engine
 */

import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { spawnSync, spawn } from "child_process";
import { randomUUID } from "crypto";
import {
  readPRD,
  countCriteria,
  extractPRDTitle,
  updateFrontmatter,
  createLoopState,
  updateLoopStateForIteration,
  finalizeLoopState,
  writeAlgorithmState,
  writeSessionName,
  voiceNotify,
  syncCriteriaToState,
} from "./state";
import { buildIterationPrompt } from "./prompts";
import { runParallelIteration, partitionCriteria } from "./parallel";
import { appendPRDChangelog, detectPlateau } from "./prd";
import { runMonitor, formatViolations, type MonitorContext } from "./monitor";
import { PlanningObserver } from "./observer";

// ─── Core Loop Mode ─────────────────────────────────────────────────────────

export async function runLoop(prdPath: string, maxOverride?: number, agentCount: number = 1): Promise<void> {
  const absPath = resolve(prdPath);
  if (!existsSync(absPath)) {
    console.error(`\x1b[31mError:\x1b[0m PRD not found: ${absPath}`);
    process.exit(1);
  }

  let { frontmatter, content } = readPRD(absPath);
  const max = maxOverride ?? frontmatter.maxIterations;
  const prdTitle = extractPRDTitle(content);
  const effortLevel = frontmatter.effort_level || "Standard";

  // Check preconditions
  if (frontmatter.status === "COMPLETE") {
    console.log(`\x1b[32m✓\x1b[0m PRD already COMPLETE: ${frontmatter.id}`);
    return;
  }

  if (frontmatter.loopStatus === "running") {
    console.error(`\x1b[31mError:\x1b[0m Loop already running on ${frontmatter.id}`);
    process.exit(1);
  }

  // ── Dashboard: Create loop session ──
  const loopSessionId = randomUUID();
  const initialCriteria = countCriteria(content);
  const state = createLoopState(loopSessionId, absPath, frontmatter.id, prdTitle, max, initialCriteria, effortLevel, agentCount);

  writeAlgorithmState(state);
  const sessionNameSuffix = agentCount > 1 ? ` (${agentCount} agents)` : "";
  writeSessionName(loopSessionId, `Loop: ${prdTitle}${sessionNameSuffix}`);

  // ── Voice: Loop starting ──
  const agentMsg = agentCount > 1 ? ` ${agentCount} parallel agents.` : "";
  voiceNotify(`Starting loop on ${prdTitle}. ${initialCriteria.total} criteria, ${initialCriteria.passing} already passing.${agentMsg}`);

  // Initialize Loop in PRD
  updateFrontmatter(absPath, {
    loopStatus: "running",
    maxIterations: max,
  });

  const bar = (p: number, t: number, w: number = 20) => {
    const pct = t > 0 ? p / t : 0;
    const filled = Math.round(pct * w);
    return `${"█".repeat(filled)}${"░".repeat(w - filled)} ${Math.round(pct * 100)}%`;
  };

  console.log("");
  console.log(`\x1b[36m╔${"═".repeat(66)}╗\x1b[0m`);
  console.log(`\x1b[36m║\x1b[0m  \x1b[1mTHE ALGORITHM\x1b[0m — Loop Mode${" ".repeat(40)}\x1b[36m║\x1b[0m`);
  console.log(`\x1b[36m╠${"═".repeat(66)}╣\x1b[0m`);
  console.log(`\x1b[36m║\x1b[0m  PRD:       ${frontmatter.id.padEnd(53)}\x1b[36m║\x1b[0m`);
  console.log(`\x1b[36m║\x1b[0m  Title:     ${prdTitle.slice(0, 53).padEnd(53)}\x1b[36m║\x1b[0m`);
  console.log(`\x1b[36m║\x1b[0m  Session:   ${loopSessionId.slice(0, 8).padEnd(53)}\x1b[36m║\x1b[0m`);
  const configLine = `Max iterations: ${max}${agentCount > 1 ? ` | Agents: ${agentCount}` : ""}`;
  console.log(`\x1b[36m║\x1b[0m  ${configLine.padEnd(64)}\x1b[36m║\x1b[0m`);
  const progressLine = `Progress: ${initialCriteria.passing}/${initialCriteria.total} ${bar(initialCriteria.passing, initialCriteria.total)}`;
  console.log(`\x1b[36m║\x1b[0m  ${progressLine.padEnd(64)}\x1b[36m║\x1b[0m`);
  console.log(`\x1b[36m╚${"═".repeat(66)}╝\x1b[0m`);
  console.log("");

  // Initialize planning observer for divergence tracking
  const observer = new PlanningObserver({
    divergenceThreshold: 0.3,
    maxReplans: 2,
  });

  // Main loop
  while (true) {
    // Re-read PRD (may have been updated by SDK iteration)
    const prd = readPRD(absPath);
    frontmatter = prd.frontmatter;
    const criteria = countCriteria(prd.content);

    // ── Exit: COMPLETE ──
    if (frontmatter.status === "COMPLETE") {
      updateFrontmatter(absPath, { loopStatus: "completed" });
      finalizeLoopState(state, "completed", criteria);
      writeAlgorithmState(state);
      writeSessionName(loopSessionId, `Loop: ${prdTitle} [COMPLETE]`);
      const totalTime = ((Date.now() - state.algorithmStartedAt) / 1000).toFixed(0);
      voiceNotify(`Loop complete! All ${criteria.total} criteria passing after ${frontmatter.iteration} iterations.`);

      console.log("");
      console.log(`\x1b[32m╔${"═".repeat(66)}╗\x1b[0m`);
      console.log(`\x1b[32m║\x1b[0m  \x1b[1m\x1b[32m✓ THE ALGORITHM — COMPLETE\x1b[0m${" ".repeat(40)}\x1b[32m║\x1b[0m`);
      console.log(`\x1b[32m╠${"═".repeat(66)}╣\x1b[0m`);
      console.log(`\x1b[32m║\x1b[0m  PRD:        ${(frontmatter.id || "").padEnd(52)}\x1b[32m║\x1b[0m`);
      console.log(`\x1b[32m║\x1b[0m  Iterations: ${String(frontmatter.iteration).padEnd(52)}\x1b[32m║\x1b[0m`);
      console.log(`\x1b[32m║\x1b[0m  Criteria:   ${`${criteria.passing}/${criteria.total} ${bar(criteria.passing, criteria.total)}`.padEnd(52)}\x1b[32m║\x1b[0m`);
      console.log(`\x1b[32m║\x1b[0m  Time:       ${`${totalTime}s`.padEnd(52)}\x1b[32m║\x1b[0m`);
      console.log(`\x1b[32m╚${"═".repeat(66)}╝\x1b[0m`);
      return;
    }

    // ── Exit: BLOCKED ──
    if (frontmatter.status === "BLOCKED") {
      updateFrontmatter(absPath, { loopStatus: "completed" });
      finalizeLoopState(state, "blocked", criteria);
      writeAlgorithmState(state);
      writeSessionName(loopSessionId, `Loop: ${prdTitle} [BLOCKED]`);
      voiceNotify(`Loop blocked. ${criteria.passing} of ${criteria.total} passing. Remaining criteria need human review.`);

      console.log("");
      console.log(`\x1b[33m⚠ THE ALGORITHM — BLOCKED\x1b[0m`);
      console.log(`  PRD: ${frontmatter.id}`);
      console.log(`  Criteria: ${criteria.passing}/${criteria.total} passing, ${criteria.failing} need interactive review`);
      return;
    }

    // ── Exit: Max iterations ──
    if (frontmatter.iteration >= max) {
      updateFrontmatter(absPath, { loopStatus: "failed" });
      finalizeLoopState(state, "failed", criteria);
      writeAlgorithmState(state);
      writeSessionName(loopSessionId, `Loop: ${prdTitle} [FAILED]`);
      voiceNotify(`Loop reached max iterations. ${criteria.passing} of ${criteria.total} passing after ${max} iterations.`);

      console.log("");
      console.log(`\x1b[33m⚠ THE ALGORITHM — Max iterations reached (${max})\x1b[0m`);
      console.log(`  PRD: ${frontmatter.id}`);
      console.log(`  Criteria: ${criteria.passing}/${criteria.total} passing`);
      return;
    }

    // ── Exit: Paused externally ──
    if (frontmatter.loopStatus === "paused") {
      finalizeLoopState(state, "paused", criteria);
      // Keep active=true for paused so dashboard shows it's resumable
      state.active = true;
      state.currentPhase = "PLAN";
      delete state.completedAt;
      writeAlgorithmState(state);
      writeSessionName(loopSessionId, `Loop: ${prdTitle} [PAUSED]`);
      voiceNotify(`Loop paused at ${criteria.passing} of ${criteria.total} criteria.`);

      console.log("");
      console.log(`\x1b[33m⏸ THE ALGORITHM — Paused\x1b[0m`);
      console.log(`  Resume with: algorithm resume -p ${absPath}`);
      return;
    }

    // ── Exit: Stopped externally ──
    if (frontmatter.loopStatus === "stopped") {
      finalizeLoopState(state, "stopped", criteria);
      writeAlgorithmState(state);
      writeSessionName(loopSessionId, `Loop: ${prdTitle} [STOPPED]`);
      voiceNotify(`Loop stopped.`);

      console.log("");
      console.log(`\x1b[31m■ THE ALGORITHM — Stopped\x1b[0m`);
      return;
    }

    // ── Run iteration ──
    const newIteration = frontmatter.iteration + 1;
    const iterStartTime = Date.now();

    updateFrontmatter(absPath, { iteration: newIteration, updated: new Date().toISOString().split("T")[0] });

    // Dashboard: Update state for this iteration
    updateLoopStateForIteration(state, newIteration, criteria);

    // Populate agents array in state when parallel
    if (agentCount > 1) {
      const assignments = partitionCriteria(criteria, agentCount);
      state.agents = assignments.map(a => ({
        name: `agent-${a.agentId}`,
        agentType: "loop-worker",
        status: "active",
        task: `Criteria: ${a.criteriaIds.join(", ")}`,
        criteriaIds: a.criteriaIds,
        phase: "EXECUTE",
      }));
    }

    writeAlgorithmState(state);
    const iterSessionSuffix = agentCount > 1 ? ` (${agentCount} agents)` : "";
    writeSessionName(loopSessionId, `Loop: ${prdTitle} [${criteria.passing}/${criteria.total} iter ${newIteration}]${iterSessionSuffix}`);

    console.log(`\x1b[36m━━━ Iteration ${newIteration}/${max} ${"━".repeat(Math.max(0, 50 - String(newIteration).length - String(max).length))}\x1b[0m`);
    console.log(`  Progress: ${criteria.passing}/${criteria.total} ${bar(criteria.passing, criteria.total)} | Failing: ${criteria.failing}`);
    if (agentCount > 1) {
      const effectiveAgents = Math.min(agentCount, criteria.failing);
      console.log(`  Agents this round: ${effectiveAgents}${effectiveAgents < agentCount ? ` (capped — only ${criteria.failing} failing)` : ""}`);
    }
    console.log("");

    // ── Parallel path: multiple agents ──
    if (agentCount > 1 && criteria.failing > 1) {
      const assignments = partitionCriteria(criteria, agentCount);

      // Show per-agent assignment with full criterion description
      for (const a of assignments) {
        const detail = a.criteriaDetails[0];
        const desc = detail.description.length > 50 ? detail.description.slice(0, 47) + "..." : detail.description;
        console.log(`  \x1b[33mAgent ${a.agentId}\x1b[0m → ${detail.id}: ${desc}`);
      }
      console.log("");
      console.log(`  \x1b[90m⏳ ${assignments.length} agents working...\x1b[0m`);

      // Run parallel iteration (async)
      await runParallelIteration(absPath, assignments, newIteration);

      const iterEndTime = Date.now();
      const postPrd = readPRD(absPath);
      const postCriteria = countCriteria(postPrd.content);

      // Record iteration in loop history
      if (!state.loopHistory) state.loopHistory = [];
      state.loopHistory.push({
        iteration: newIteration,
        startedAt: iterStartTime,
        completedAt: iterEndTime,
        criteriaPassing: postCriteria.passing,
        criteriaTotal: postCriteria.total,
      });

      // Dashboard: Sync updated criteria
      syncCriteriaToState(state, postCriteria);
      state.loopIteration = newIteration;
      state.agents = []; // Clear agents after completion
      writeAlgorithmState(state);

      const gained = postCriteria.passing - criteria.passing;
      const iterElapsed = ((iterEndTime - iterStartTime) / 1000).toFixed(0);
      if (gained > 0) {
        voiceNotify(`Iteration ${newIteration} complete. ${postCriteria.passing} of ${postCriteria.total} passing. Gained ${gained}.`);
      } else {
        voiceNotify(`Iteration ${newIteration} complete. ${postCriteria.passing} of ${postCriteria.total}. No new criteria passed.`);
      }

      const pct = postCriteria.total > 0 ? Math.round((postCriteria.passing / postCriteria.total) * 100) : 0;
      console.log(`  \x1b[1mIteration ${newIteration} Summary:\x1b[0m \x1b[32m+${gained}\x1b[0m | ${postCriteria.passing}/${postCriteria.total} passing (${pct}%) | ${iterElapsed}s`);
      if (postCriteria.passing >= postCriteria.total) {
        updateFrontmatter(absPath, { status: "COMPLETE" });
      }

      // Append CHANGELOG entry to PRD
      appendPRDChangelog(absPath, newIteration, criteria, postCriteria, iterEndTime - iterStartTime);

      // Plateau detection: if last 3 iterations had zero progress, exit BLOCKED
      if (state.loopHistory && detectPlateau(state.loopHistory, 3)) {
        console.log(`\x1b[33m  Plateau detected — no progress in last 3 iterations\x1b[0m`);
        updateFrontmatter(absPath, { status: "BLOCKED", loopStatus: "completed" });
      }

      console.log("");
      Bun.sleepSync(2000);
      continue;
    }

    // ── Sequential path: single agent (existing behavior) ──
    const prompt = buildIterationPrompt(absPath, newIteration, max);

    const result = spawnSync("claude", [
      "-p", prompt,
      "--allowedTools", "Edit,Write,Bash,Read,Glob,Grep,WebFetch,WebSearch,Task,TaskCreate,TaskUpdate,TaskList,NotebookEdit",
    ], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 600_000, // 10 minute timeout per iteration
      cwd: dirname(absPath), // Run from PRD's directory context
    });

    const iterEndTime = Date.now();

    if (result.error) {
      console.error(`\x1b[31m  Error in iteration ${newIteration}:\x1b[0m ${result.error.message}`);
      if (!state.loopHistory) state.loopHistory = [];
      state.loopHistory.push({
        iteration: newIteration,
        startedAt: iterStartTime,
        completedAt: iterEndTime,
        criteriaPassing: criteria.passing,
        criteriaTotal: criteria.total,
      });
      writeAlgorithmState(state);
      continue;
    }

    if (result.status !== 0) {
      const stderr = result.stderr?.toString().trim();
      console.error(`\x1b[31m  claude -p exited with status ${result.status}\x1b[0m`);
      if (stderr) console.error(`  ${stderr.slice(0, 200)}`);
      if (!state.loopHistory) state.loopHistory = [];
      state.loopHistory.push({
        iteration: newIteration,
        startedAt: iterStartTime,
        completedAt: iterEndTime,
        criteriaPassing: criteria.passing,
        criteriaTotal: criteria.total,
      });
      writeAlgorithmState(state);
      continue;
    }

    // Re-read PRD to get post-iteration criteria state
    const postPrd = readPRD(absPath);
    const postCriteria = countCriteria(postPrd.content);

    // Record iteration in loop history
    if (!state.loopHistory) state.loopHistory = [];
    state.loopHistory.push({
      iteration: newIteration,
      startedAt: iterStartTime,
      completedAt: iterEndTime,
      criteriaPassing: postCriteria.passing,
      criteriaTotal: postCriteria.total,
    });

    // Dashboard: Sync updated criteria
    syncCriteriaToState(state, postCriteria);
    state.loopIteration = newIteration;
    writeAlgorithmState(state);

    // Voice: Progress update
    const gained = postCriteria.passing - criteria.passing;
    if (gained > 0) {
      voiceNotify(`Iteration ${newIteration} complete. ${postCriteria.passing} of ${postCriteria.total} passing. Gained ${gained}.`);
    } else {
      voiceNotify(`Iteration ${newIteration} complete. ${postCriteria.passing} of ${postCriteria.total}. No new criteria passed.`);
    }

    // Log output summary
    const stdout = result.stdout?.toString().trim() || "";
    if (stdout) {
      const summary = stdout.slice(0, 200).replace(/\n/g, " ");
      console.log(`\x1b[90m  Output: ${summary}${stdout.length > 200 ? "..." : ""}\x1b[0m`);
    }

    // Meta-cognitive monitor: check output for policy violations
    if (stdout) {
      const monitorContext: MonitorContext = {
        sessionMessages: newIteration,
        hasToolCalls: stdout.includes("[Edit]") || stdout.includes("[Write]") || stdout.includes("[Bash]"),
        hasTests: stdout.includes("test") || stdout.includes("spec"),
        mode: "algorithm",
      };
      const violations = runMonitor(stdout, monitorContext);
      if (violations.length > 0) {
        console.log(`\x1b[33m  Monitor: ${violations.length} policy violation(s)\x1b[0m`);
        for (const v of violations.slice(0, 2)) {
          console.log(`\x1b[33m    → [${v.policyId}] ${v.message}\x1b[0m`);
        }
      }
    }

    // Planning observer: track divergence between expected progress and actual
    observer.setExpectation(`iteration-${newIteration}`, `Resolve ${criteria.failing} failing criteria`);
    const divergence = observer.evaluatePhase(
      `iteration-${newIteration}`,
      `Resolved ${gained} of ${criteria.failing} failing criteria. Now ${postCriteria.passing}/${postCriteria.total}.`
    );

    if (divergence.shouldReplan) {
      console.log(`\x1b[33m  Observer: divergence ${divergence.score.toFixed(2)} — consider replanning\x1b[0m`);
    }

    console.log(`  \x1b[32m+${gained}\x1b[0m criteria — now ${postCriteria.passing}/${postCriteria.total} passing`);

    // Append CHANGELOG entry to PRD
    appendPRDChangelog(absPath, newIteration, criteria, postCriteria, iterEndTime - iterStartTime);

    // Plateau detection: if last 3 iterations had zero progress, exit BLOCKED
    if (state.loopHistory && detectPlateau(state.loopHistory, 3)) {
      console.log(`\x1b[33m  Plateau detected — no progress in last 3 iterations\x1b[0m`);
      updateFrontmatter(absPath, { status: "BLOCKED", loopStatus: "completed" });
    }

    // Brief pause between iterations
    Bun.sleepSync(2000);
  }
}

// ─── Pause / Resume / Stop ──────────────────────────────────────────────────

export function pauseLoop(prdPath: string): void {
  const absPath = resolve(prdPath);
  const { frontmatter } = readPRD(absPath);
  if (frontmatter.loopStatus !== "running") {
    console.log(`Loop is not running on ${frontmatter.id} (status: ${frontmatter.loopStatus || "idle"})`);
    return;
  }
  updateFrontmatter(absPath, { loopStatus: "paused" });
  voiceNotify(`Loop paused on ${frontmatter.id}.`);
  console.log(`\x1b[33m⏸ Paused\x1b[0m Loop on ${frontmatter.id}`);
  console.log(`  Resume with: algorithm resume -p ${absPath}`);
}

export async function resumeLoop(prdPath: string): Promise<void> {
  const absPath = resolve(prdPath);
  const { frontmatter } = readPRD(absPath);
  if (frontmatter.loopStatus !== "paused") {
    console.log(`Loop is not paused on ${frontmatter.id} (status: ${frontmatter.loopStatus || "idle"})`);
    return;
  }
  updateFrontmatter(absPath, { loopStatus: "running" });
  voiceNotify(`Resuming loop on ${frontmatter.id}.`);
  console.log(`\x1b[36m▶ Resuming\x1b[0m Loop on ${frontmatter.id}`);
  await runLoop(absPath);
}

export function stopLoop(prdPath: string): void {
  const absPath = resolve(prdPath);
  const { frontmatter } = readPRD(absPath);
  updateFrontmatter(absPath, { loopStatus: "stopped" });
  voiceNotify(`Loop stopped on ${frontmatter.id}.`);
  console.log(`\x1b[31m■ Stopped\x1b[0m Loop on ${frontmatter.id}`);
}
