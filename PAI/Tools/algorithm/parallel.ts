/**
 * algorithm/parallel.ts - Parallel agent execution for loop mode
 */

import { readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { buildWorkerPrompt } from "./prompts";
import { readPRD, countCriteria, updateFrontmatter } from "./state";
import type { CriteriaInfo, AgentAssignment } from "./types";

// ─── Domain-Aware Criteria Partitioning ──────────────────────────────────────

export function partitionCriteria(criteriaInfo: CriteriaInfo, agentCount: number): AgentAssignment[] {
  const failing = criteriaInfo.criteria.filter(c => c.status === "failing");
  if (failing.length === 0) return [];

  // Extract domain prefix from ISC ID: ISC-TIER-1 → "TIER", ISC-A-1 → "A", ISC-CLI-3 → "CLI"
  function getDomain(id: string): string {
    // Match ISC-{DOMAIN}-{N} pattern — domain is everything between first ISC- and last -N
    const match = id.match(/^ISC-(.+)-\d+$/);
    return match ? match[1] : id;
  }

  // Group failing criteria by domain prefix
  const domainGroups = new Map<string, Array<{ id: string; description: string }>>();
  for (const c of failing) {
    const domain = getDomain(c.id);
    if (!domainGroups.has(domain)) domainGroups.set(domain, []);
    domainGroups.get(domain)!.push({ id: c.id, description: c.description });
  }

  // Sort domain groups by size (largest first) for greedy load-balancing
  const sortedDomains = [...domainGroups.entries()].sort((a, b) => b[1].length - a[1].length);

  // Cap agents at number of domain groups (each domain stays together)
  const effectiveAgentCount = Math.min(agentCount, sortedDomains.length);
  const agents: AgentAssignment[] = [];
  for (let i = 0; i < effectiveAgentCount; i++) {
    agents.push({ agentId: i + 1, criteriaIds: [], criteriaDetails: [] });
  }

  // Greedy load-balancing: assign each domain group to the agent with fewest criteria
  for (const [, groupCriteria] of sortedDomains) {
    // Find agent with the fewest criteria assigned
    let minAgent = agents[0];
    for (const agent of agents) {
      if (agent.criteriaIds.length < minAgent.criteriaIds.length) {
        minAgent = agent;
      }
    }
    for (const c of groupCriteria) {
      minAgent.criteriaIds.push(c.id);
      minAgent.criteriaDetails.push(c);
    }
  }

  // Filter out agents with no criteria assigned (shouldn't happen, but safety)
  return agents.filter(a => a.criteriaIds.length > 0);
}

// ─── Parallel Iteration Runner ──────────────────────────────────────────────

export async function runParallelIteration(
  prdPath: string,
  assignments: AgentAssignment[],
  iteration: number,
): Promise<void> {
  const startTime = Date.now();
  const processes = assignments.map(assignment => {
    const criterion = assignment.criteriaDetails[0]; // One criterion per agent
    const prompt = buildWorkerPrompt(prdPath, assignment.agentId, criterion, iteration);
    const proc = Bun.spawn(["claude", "-p", prompt,
      "--allowedTools", "Edit,Write,Bash,Read,Glob,Grep,WebFetch,WebSearch,NotebookEdit",
    ], {
      cwd: dirname(prdPath),
      stdout: "pipe",
      stderr: "pipe",
    });
    return { assignment, proc };
  });

  // Wait for all agents to complete
  const results = await Promise.all(
    processes.map(async ({ assignment, proc }) => {
      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      return { assignment, exitCode, stdout, stderr };
    })
  );

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\x1b[90m  ⏱ Agents finished in ${elapsed}s\x1b[0m`);
  console.log("");

  // Parse agent stdout for RESULT lines — agents report pass/fail via stdout only
  const passedIds: string[] = [];
  for (const { assignment, stdout } of results) {
    const cId = assignment.criteriaIds[0];
    // Look for "RESULT: ISC-xxx PASS" in agent output
    if (stdout.includes(`RESULT: ${cId} PASS`) || stdout.includes(`${cId} PASS`)) {
      passedIds.push(cId);
    }
    // Also check if agent edited the PRD despite instructions (fallback detection)
  }

  // Parent updates PRD checkboxes sequentially — no concurrent writes
  if (passedIds.length > 0) {
    let prdContent = readFileSync(prdPath, "utf-8");
    for (const id of passedIds) {
      const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      prdContent = prdContent.replace(
        new RegExp(`- \\[ \\] ${escapedId}:`),
        `- [x] ${id}:`
      );
    }
    writeFileSync(prdPath, prdContent);
  }

  // Re-read PRD to get consolidated state after parent updates
  const postPrd = readPRD(prdPath);
  const postCriteria = countCriteria(postPrd.content);

  // Update frontmatter with consolidated results
  updateFrontmatter(prdPath, {
    verification_summary: `"${postCriteria.passing}/${postCriteria.total}"`,
    failing_criteria: postCriteria.failingIds.length > 0
      ? `[${postCriteria.failingIds.join(", ")}]`
      : "[]",
    last_phase: "VERIFY",
    updated: new Date().toISOString().split("T")[0],
  });

  // ── Per-agent results ──
  console.log(`  \x1b[1mAgent Results:\x1b[0m`);
  for (const { assignment, exitCode } of results) {
    const cId = assignment.criteriaIds[0];
    const detail = assignment.criteriaDetails[0];
    const desc = detail.description.length > 40 ? detail.description.slice(0, 37) + "..." : detail.description;
    const criterion = postCriteria.criteria.find(c => c.id === cId);
    const passed = criterion?.status === "passing";
    if (exitCode !== 0) {
      console.log(`  \x1b[31m  Agent ${assignment.agentId} ✗ CRASHED\x1b[0m  ${cId}: ${desc}`);
    } else if (passed) {
      console.log(`  \x1b[32m  Agent ${assignment.agentId} ✓ PASS\x1b[0m    ${cId}: ${desc}`);
    } else {
      console.log(`  \x1b[33m  Agent ${assignment.agentId} ✗ FAIL\x1b[0m    ${cId}: ${desc}`);
    }
  }
  console.log("");

  // ── Full criteria scoreboard ──
  console.log(`  \x1b[90m── Criteria Scoreboard ──────────────────────────────────────\x1b[0m`);
  for (const c of postCriteria.criteria) {
    const icon = c.status === "passing" ? "\x1b[32m✓\x1b[0m" : "\x1b[90m·\x1b[0m";
    const idPad = c.id.padEnd(14);
    const desc = c.description.length > 50 ? c.description.slice(0, 47) + "..." : c.description;
    console.log(`  ${icon} ${idPad} ${desc}`);
  }
  const pct = postCriteria.total > 0 ? Math.round((postCriteria.passing / postCriteria.total) * 100) : 0;
  console.log(`  \x1b[90m── ${postCriteria.passing}/${postCriteria.total} passing (${pct}%) ────────────────────────────────────\x1b[0m`);
  console.log("");
}
