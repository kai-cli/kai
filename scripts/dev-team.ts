#!/usr/bin/env bun
/**
 * DevTeam — Autonomous Development Team Orchestrator
 *
 * Spins up coordinated AI agent teams (PM, Dev, QA) via TeamCreate to
 * autonomously investigate, fix, and verify bugs or build features.
 *
 * Lifecycle:
 *   Phase 0: Load preset, confirm team composition
 *   Phase 1: PM scopes work, defines criteria
 *   Phase 2: Dev implements (worktree isolated)
 *   Phase 3: QA verifies (max 2 retries)
 *   Phase 4: Bedrock panel or Claude adversarial review (optional)
 *   Phase 5: Report + cleanup
 *
 * Usage:
 *   bun dev-team.ts --preset bug-fix --issue "Login fails on Safari"
 *   bun dev-team.ts --preset feature --issue "Add dark mode toggle"
 *   bun dev-team.ts --preset investigation --issue "Memory leak in worker pool"
 *   bun dev-team.ts --preset bug-fix --github "owner/repo#123"
 *   bun dev-team.ts --preset bug-fix --no-review --issue "Typo fix"
 *   bun dev-team.ts --list-presets
 */

import { parseArgs } from "util";
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { join, resolve } from "path";
import { parse as parseYaml } from "yaml";
import { homedir, tmpdir } from "os";
import { randomUUID } from "crypto";
import { loadCredentialSpecs, validateCredentials, formatValidationResult } from "../hooks/lib/credential-validator";
import { CostTracker } from "./lib/cost-tracker";
import { StallDetector } from "./lib/stall-detector";
import { shouldRetry, parseSeverity, type RetryDecision } from "./lib/adaptive-retry";
import { CheckpointManager } from "./lib/checkpoint";
import { evaluateCondition, type PhaseContext } from "./lib/conditions";

// --- Types ---

interface RoleConfig {
  id: string;
  agent_type: string;
  model: string;
  purpose: string;
  worktree: boolean;
}

interface ReviewConfig {
  enabled: boolean;
  bedrock_models?: string[];
  fallback?: string;
}

interface PresetConfig {
  name: string;
  description: string;
  retry_max: number;
  roles: RoleConfig[];
  review: ReviewConfig;
}

interface RunLogEntry {
  ts: string;
  phase: string;
  event: string;
  agent?: string;
  duration_ms?: number;
  attempt?: number;
  reason?: string;
  mode?: string;
  models?: number;
  worktree?: string;
  total_ms?: number;
  [key: string]: unknown;
}

interface TeamConfig {
  preset: PresetConfig;
  teamName: string;
  issue: string;
  cwd: string;
  noReview: boolean;
  verbose: boolean;
  reviewMode: "bedrock" | "claude-adversarial" | "disabled";
  goalAncestry: {
    userIntent: string;
    priority: "critical" | "standard" | "exploratory";
    whyThisMatters: string;
  };
  phaseTimeoutMs: number;
  modelOverrides: Record<string, string>;
}

type RecoveryTier = "auto-retry" | "explicit-recovery" | "escalate";

interface RecoveryAction {
  tier: RecoveryTier;
  phase: string;
  agent: string;
  cause: string;
  attempt: number;
  context?: string;
}

// --- Paths ---

const PAI_DIR = join(homedir(), ".claude");
const SCRIPTS_DIR = join(PAI_DIR, "scripts");
const TEAMS_DIR = join(PAI_DIR, "teams");
const PRESETS_DIR = join(PAI_DIR, "skills", "DevTeam", "Presets");

function claudePath(): string {
  const knownDirs = [
    join(homedir(), ".local", "bin"),
    "/usr/local/bin",
    "/opt/homebrew/bin",
  ];
  for (const dir of knownDirs) {
    if (existsSync(join(dir, "claude"))) return dir;
  }
  return "";
}

const CLAUDE_DIR = claudePath();
const SPAWN_ENV = { ...process.env, PATH: `${CLAUDE_DIR}:${process.env.PATH}` };

// --- Run Log ---

function logEvent(teamName: string, entry: RunLogEntry): void {
  const logDir = join(TEAMS_DIR, teamName);
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, "run.jsonl");
  appendFileSync(logPath, JSON.stringify(entry) + "\n");
}

function log(teamName: string, phase: string, event: string, extra?: Partial<RunLogEntry>): void {
  logEvent(teamName, { ts: new Date().toISOString(), phase, event, ...extra });
}

// --- Preset Loading ---

function loadPreset(presetName: string): PresetConfig {
  const presetPath = join(PRESETS_DIR, `${presetName}.yaml`);
  if (!existsSync(presetPath)) {
    const available = listPresets();
    throw new Error(`Preset "${presetName}" not found. Available: ${available.join(", ")}`);
  }
  const content = readFileSync(presetPath, "utf-8");
  return parseYaml(content) as PresetConfig;
}

function listPresets(): string[] {
  const { readdirSync } = require("fs");
  try {
    return readdirSync(PRESETS_DIR)
      .filter((f: string) => f.endsWith(".yaml"))
      .map((f: string) => f.replace(".yaml", ""));
  } catch {
    return [];
  }
}

// --- Credential Validation ---

/**
 * Validate credentials and return review capability mode.
 * Replaces the old one-off detectReviewCapability() with generalized validation.
 */
function validateDevTeamCredentials(): { reviewMode: "bedrock" | "claude-adversarial"; warnings: string[] } {
  const credentialsPath = join(PAI_DIR, "skills", "DevTeam", "credentials.yaml");

  // If no credentials file, fall back to legacy detection
  if (!existsSync(credentialsPath)) {
    console.error("[DevTeam] No credentials.yaml found, using legacy detection");
    return { reviewMode: "claude-adversarial", warnings: [] };
  }

  try {
    const specs = loadCredentialSpecs(credentialsPath);
    const result = validateCredentials(specs);

    // Determine review mode based on AWS_PROFILE presence
    const awsProfile = process.env.AWS_PROFILE;
    const reviewMode: "bedrock" | "claude-adversarial" = awsProfile ? "bedrock" : "claude-adversarial";

    return { reviewMode, warnings: result.warnings };
  } catch (error) {
    console.error(`[DevTeam] Credential validation error: ${error}`);
    return { reviewMode: "claude-adversarial", warnings: [`Credential validation failed: ${error}`] };
  }
}

// --- Bedrock Detection (legacy, kept for backward compatibility) ---

async function detectReviewCapability(): Promise<"bedrock" | "claude-adversarial"> {
  try {
    const proc = Bun.spawn(["aws", "sts", "get-caller-identity"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    return exitCode === 0 ? "bedrock" : "claude-adversarial";
  } catch {
    return "claude-adversarial";
  }
}

// --- Team Name Generation ---

function generateTeamName(preset: string, issue: string): string {
  const slug = issue
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 30)
    .replace(/-$/, "");
  const ts = Date.now().toString(36).slice(-4);
  return `${preset}-${slug}-${ts}`;
}

// --- Agent Prompt Builders ---

function buildGoalAncestrySection(config: TeamConfig): string {
  return `## Goal Ancestry
**User Intent:** ${config.goalAncestry.userIntent}
**Priority:** ${config.goalAncestry.priority}
**Why This Matters:** ${config.goalAncestry.whyThisMatters}`;
}

function buildPMPrompt(config: TeamConfig): string {
  return `## Role: Project Manager / Scoping Agent

${buildGoalAncestrySection(config)}

## Context
You are the PM agent on a DevTeam. Your job is to scope the following issue and produce clear acceptance criteria that Dev and QA agents will work against.

## Issue
${config.issue}

## Working Directory
${config.cwd}

## Your Task
1. Analyze the issue — understand what's broken or what's needed
2. If possible, identify the likely root cause or affected area
3. Write clear, testable acceptance criteria (3-8 criteria)
4. Define scope boundaries (what NOT to change)

## Output Format
Produce a structured report:

### Reproduction / Understanding
[How to reproduce the bug, or what the feature should do]

### Root Cause Hypothesis
[Your best guess at what's causing this, or where to implement]

### Acceptance Criteria
- [ ] Criterion 1 (testable condition)
- [ ] Criterion 2 (testable condition)
- [ ] ...

### Scope Boundary
- Do NOT modify: [list files/areas to avoid]
- Focus only on: [specific area]

### Notes for Dev
[Any implementation hints or constraints]

Be specific and testable. Vague criteria ("it should work better") are useless.`;
}

function buildDevPrompt(config: TeamConfig, pmFindings: string, attempt: number, qaFeedback?: string): string {
  const retryContext = attempt > 1 && qaFeedback
    ? `\n## Previous Attempt Failed\nThis is attempt ${attempt}. QA rejected the previous fix:\n${qaFeedback}\n\nFocus ONLY on addressing these specific failures.\n`
    : "";

  return `## Role: Developer Agent

${buildGoalAncestrySection(config)}

## Context
You are the Dev agent on a DevTeam. Implement the fix/feature based on the PM's scoping.
${retryContext}
## Issue
${config.issue}

## Handoff from PM
The PM produced a structured report. Key sections to reference:
- **### Acceptance Criteria** — your primary checklist (implement ALL of these)
- **### Scope Boundary** — hard constraints (do NOT violate these)
- **### Notes for Dev** — implementation hints

## PM's Full Report
${pmFindings}

## Working Directory
${config.cwd}

## Your Task
1. Read the relevant code to understand the current state
2. Implement the minimum change that satisfies the acceptance criteria
3. Run relevant tests to verify your change
4. Ensure no regressions in related functionality

## Rules
- Minimal change — fix the bug, don't refactor the neighborhood
- Run tests before declaring done
- If you're unsure about scope, stay narrow
- Report what you changed and why`;
}

function buildQAPrompt(config: TeamConfig, pmFindings: string, devReport: string): string {
  return `## Role: QA / Verification Agent

${buildGoalAncestrySection(config)}

## Context
You are the QA agent on a DevTeam. Verify that the Dev's implementation satisfies the PM's acceptance criteria.

## Issue
${config.issue}

## PM's Acceptance Criteria
${pmFindings}

## Dev's Report
${devReport}

## Working Directory
${config.cwd}

## Your Task
1. Read the PM's acceptance criteria carefully
2. For EACH criterion, verify it is satisfied with evidence
3. Run the test suite — report pass/fail
4. Check for obvious regressions in related code
5. Produce a structured pass/fail report

## Output Format

### Verification Results
| Criterion | Status | Evidence |
|-----------|--------|----------|
| Criterion 1 | PASS/FAIL | [what you checked] |
| Criterion 2 | PASS/FAIL | [what you checked] |

### Test Results
[Test suite output summary]

### Regressions
[Any regressions found, or "None detected"]

### Verdict
**PASS** or **FAIL**

### Priority Signal
For each FAIL criterion, classify:
- **Critical Blocker** — Core functionality broken, must fix before merge
- **Standard Issue** — Incorrect behavior but not catastrophic
- **Minor Concern** — Style/optimization, acceptable to defer

Overall priority: **[Critical Blocker | Standard Issue | Minor Concern]**

If FAIL, explain exactly what's wrong so Dev can fix it on retry.`;
}

function buildAdversarialReviewPrompts(diff: string): { security: string; correctness: string; pragmatist: string } {
  const base = `You are reviewing a code diff. Be direct and critical.\n\nDIFF:\n${diff}\n\n`;

  return {
    security: base + `Focus exclusively on SECURITY concerns: injection risks, auth bypasses, data exposure, unsafe operations. If you find nothing, say so. Don't manufacture issues.`,
    correctness: base + `Focus exclusively on CORRECTNESS: logic errors, off-by-one bugs, race conditions, null handling, edge cases. If you find nothing, say so. Don't manufacture issues.`,
    pragmatist: base + `Focus on PRACTICALITY: will this actually work in production? Performance issues? Missing error handling at boundaries? Incomplete migration? If it's solid, say so.`,
  };
}

// --- Phase Execution ---

class PhaseTimeoutError extends Error {
  constructor(phase: string, timeoutMs: number) {
    super(`${phase} agent timed out after ${(timeoutMs / 1000).toFixed(0)}s`);
    this.name = "PhaseTimeoutError";
  }
}

async function executePhase(
  config: TeamConfig,
  phase: string,
  agentType: string,
  model: string,
  prompt: string,
  useWorktree: boolean,
): Promise<string> {
  const startTime = Date.now();
  const effectiveModel = config.modelOverrides[phase] || model;
  log(config.teamName, phase, "start", { agent: agentType, model: effectiveModel } as any);

  if (config.verbose) {
    console.log(`  [${phase}] Spawning ${agentType} (${effectiveModel})...`);
  }

  const promptFile = join(tmpdir(), `devteam-${randomUUID()}.txt`);
  writeFileSync(promptFile, prompt);

  const worktreeFlag = useWorktree ? " --worktree" : "";
  const cmd = `claude -p "$(cat '${promptFile}')" --model ${effectiveModel} --output-format text${worktreeFlag}`;

  const proc = Bun.spawn(["/bin/bash", "-c", cmd], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: config.cwd,
    env: { ...SPAWN_ENV, CLAUDE_CODE_MAX_TURNS: "50" },
  });

  // Race execution against timeout
  const timeoutMs = config.phaseTimeoutMs;
  const result = await Promise.race([
    (async () => {
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;
      return { stdout, stderr, exitCode, timedOut: false };
    })(),
    (async () => {
      await new Promise((r) => setTimeout(r, timeoutMs));
      proc.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 3000));
      try { proc.kill("SIGKILL"); } catch {}
      return { stdout: "", stderr: "", exitCode: -1, timedOut: true };
    })(),
  ]);

  const duration = Date.now() - startTime;
  try { unlinkSync(promptFile); } catch {}

  if (result.timedOut) {
    log(config.teamName, phase, "timeout", { agent: agentType, duration_ms: duration });
    if (config.verbose) {
      console.error(`  [${phase}] TIMEOUT after ${(duration / 1000).toFixed(1)}s`);
    }
    throw new PhaseTimeoutError(phase, timeoutMs);
  }

  if (result.exitCode !== 0) {
    log(config.teamName, phase, "error", { agent: agentType, duration_ms: duration, reason: result.stderr.slice(0, 500) });
    if (config.verbose) {
      console.error(`  [${phase}] ERROR (${(duration / 1000).toFixed(1)}s): ${result.stderr.slice(0, 200)}`);
    }
    throw new Error(`${phase} agent failed: ${result.stderr.slice(0, 500)}`);
  }

  log(config.teamName, phase, "complete", { agent: agentType, duration_ms: duration });
  if (config.verbose) {
    console.log(`  [${phase}] Complete (${(duration / 1000).toFixed(1)}s, ${result.stdout.length} chars)`);
  }

  return result.stdout;
}

// --- Recovery ---

function classifyRecovery(error: Error, phase: string, agent: string, attempt: number, maxAttempts: number): RecoveryAction {
  const isTimeout = error instanceof PhaseTimeoutError;
  const isTransient = error.message.includes("rate limit") || error.message.includes("overloaded");

  if ((isTimeout || isTransient) && attempt < maxAttempts) {
    return { tier: "auto-retry", phase, agent, cause: error.message, attempt };
  }

  if (attempt < maxAttempts) {
    return {
      tier: "explicit-recovery",
      phase,
      agent,
      cause: error.message,
      attempt,
      context: `Agent failed on attempt ${attempt}. Error: ${error.message.slice(0, 200)}. Will retry with additional context about the failure.`,
    };
  }

  return { tier: "escalate", phase, agent, cause: error.message, attempt };
}

async function executePhaseWithRecovery(
  config: TeamConfig,
  phase: string,
  agentType: string,
  model: string,
  prompt: string,
  useWorktree: boolean,
  maxRecoveryAttempts = 2,
): Promise<string> {
  for (let attempt = 1; attempt <= maxRecoveryAttempts; attempt++) {
    try {
      return await executePhase(config, phase, agentType, model, prompt, useWorktree);
    } catch (error: any) {
      const recovery = classifyRecovery(error, phase, agentType, attempt, maxRecoveryAttempts);
      log(config.teamName, phase, "recovery", { tier: recovery.tier, attempt, reason: recovery.cause } as any);

      if (recovery.tier === "escalate") {
        console.log(`\n⚠️  [${phase}] Escalating to user after ${attempt} recovery attempts.`);
        console.log(`    Cause: ${recovery.cause.slice(0, 200)}`);
        throw error;
      }

      if (recovery.tier === "auto-retry") {
        console.log(`  [${phase}] Auto-retrying (attempt ${attempt + 1}/${maxRecoveryAttempts})...`);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      // explicit-recovery: augment prompt with failure context
      console.log(`  [${phase}] Explicit recovery — retrying with failure context...`);
      prompt = `${prompt}\n\n## Recovery Context\nPrevious attempt failed: ${recovery.cause.slice(0, 300)}\nAdjust your approach to avoid this failure mode.\n`;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error(`${phase} failed after ${maxRecoveryAttempts} recovery attempts`);
}

// --- Review Phase ---

async function executeBedrockReview(config: TeamConfig, diffContent: string): Promise<string> {
  const diffPath = join(TEAMS_DIR, config.teamName, "review-diff.md");
  writeFileSync(diffPath, `# Code Changes for Review\n\n\`\`\`diff\n${diffContent}\n\`\`\``);

  const deliberateScript = join(SCRIPTS_DIR, "deliberate.ts");
  const models = config.preset.review.bedrock_models?.join(",") || "deepseek,mistral,llama-researcher";

  const proc = Bun.spawn(
    ["bun", deliberateScript, "--mode", "doc-review", "--doc", diffPath, "--models", models, "--verbose"],
    { stdout: "pipe", stderr: "pipe", cwd: config.cwd },
  );

  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return stdout;
}

async function executeAdversarialReview(config: TeamConfig, diffContent: string): Promise<string> {
  const prompts = buildAdversarialReviewPrompts(diffContent);
  const roles = ["security", "correctness", "pragmatist"] as const;

  const results = await Promise.all(
    roles.map(async (role) => {
      const pf = join(tmpdir(), `devteam-review-${randomUUID()}.txt`);
      writeFileSync(pf, prompts[role]);
      const cmd = `claude -p "$(cat '${pf}')" --model sonnet --output-format text`;
      const proc = Bun.spawn(["/bin/bash", "-c", cmd], {
        stdout: "pipe", stderr: "pipe", cwd: config.cwd, env: SPAWN_ENV,
      });
      const stdout = await new Response(proc.stdout).text();
      await proc.exited;
      try { unlinkSync(pf); } catch {}
      return { role, content: stdout };
    }),
  );

  const report = results
    .map((r) => `### ${r.role.charAt(0).toUpperCase() + r.role.slice(1)} Review\n\n${r.content}`)
    .join("\n\n---\n\n");

  return `# Adversarial Review (Claude Multi-Perspective)\n\n${report}`;
}

// --- File Scope Assignment (Atomic Checkout) ---

function assignFileScopes(pmFindings: string, devRoles: RoleConfig[]): string[] {
  // Extract file paths or areas mentioned in PM findings
  const filePatterns = pmFindings.match(/(?:^|\s)([\w/.-]+\.\w{1,5})(?:\s|$|,|:)/gm) || [];
  const areas = [...new Set(filePatterns.map((f) => f.trim()))];

  if (areas.length < 2 || devRoles.length < 2) {
    // Not enough to split — each dev gets the full scope
    return devRoles.map(() => "");
  }

  // Simple round-robin assignment
  const assignments: string[][] = devRoles.map(() => []);
  areas.forEach((area, i) => {
    assignments[i % devRoles.length].push(area);
  });

  return assignments.map((files) =>
    files.length > 0 ? files.map((f) => `- ${f}`).join("\n") : "",
  );
}

// --- Main Orchestration ---

async function orchestrate(config: TeamConfig): Promise<string> {
  const startTime = Date.now();
  console.log(`\n=== DevTeam: ${config.preset.name} ===`);
  console.log(`Team: ${config.teamName}`);
  console.log(`Issue: ${config.issue.slice(0, 100)}${config.issue.length > 100 ? "..." : ""}`);
  console.log(`Roles: ${config.preset.roles.map((r) => `${r.id}(${r.model})`).join(", ")}`);
  console.log(`Review: ${config.reviewMode}`);
  console.log(`CWD: ${config.cwd}`);
  console.log("");

  log(config.teamName, "orchestrate", "start", { preset: config.preset.name } as any);

  // Initialize defaults if not provided
  if (!config.goalAncestry) {
    config.goalAncestry = {
      userIntent: config.issue.slice(0, 150),
      priority: "standard",
      whyThisMatters: "User-reported issue affecting system functionality",
    };
  }
  if (!config.phaseTimeoutMs) config.phaseTimeoutMs = 300_000;
  if (!config.modelOverrides) config.modelOverrides = {};

  // --- v6.6.0 Intelligence: Initialize cost tracker and checkpoint manager ---
  const costTracker = new CostTracker();
  const teamDir = join(TEAMS_DIR, config.teamName);
  if (!existsSync(teamDir)) mkdirSync(teamDir, { recursive: true });
  const checkpoint = new CheckpointManager(teamDir);

  // Resume from checkpoint if previous run was interrupted
  if (checkpoint.canResume()) {
    const lastCompleted = checkpoint.getLastCompleted();
    console.log(`  Resuming from checkpoint: last completed phase = ${lastCompleted}`);
    log(config.teamName, "orchestrate", "resume", { lastCompleted } as any);
  }

  // --- Phase 1: PM Scoping ---
  console.log("[Phase 1] PM Scoping...");
  checkpoint.save("scope", "started");
  const pmRole = config.preset.roles.find((r) => r.id === "pm" || r.id === "lead");
  const pmPrompt = buildPMPrompt(config);
  const pmFindings = await executePhaseWithRecovery(
    config,
    "scope",
    pmRole?.agent_type || "Plan",
    pmRole?.model || "sonnet",
    pmPrompt,
    false,
  );
  checkpoint.save("scope", "completed", pmFindings.slice(0, 2000));
  costTracker.recordFromOutput("scope", pmRole?.model || "sonnet", pmFindings);

  // --- Phase 2: Dev Implementation (with retry support) ---
  console.log("\n[Phase 2] Dev Implementation...");
  checkpoint.save("implement", "started");
  const devRoles = config.preset.roles.filter((r) => r.id.startsWith("dev"));
  let devReport = "";
  let qaVerdict = "FAIL";
  let qaReport = "";
  let attempt = 0;
  const maxRetries = config.preset.retry_max;
  let lastRetryDecision: RetryDecision | null = null;

  while (qaVerdict !== "PASS" && attempt <= maxRetries) {
    attempt++;
    if (attempt > 1) {
      console.log(`\n[Retry ${attempt}/${maxRetries + 1}] Dev addressing QA failures...`);
      log(config.teamName, "verify", "retry", { agent: "dev", attempt });
    }

    // Check cost budget before each attempt
    if (costTracker.isOverHardLimit()) {
      console.log(`\n⚠️  Cost hard limit reached ($${costTracker.getTotalCost().toFixed(2)}). Stopping.`);
      log(config.teamName, "implement", "budget-exceeded", { cost: costTracker.getTotalCost() } as any);
      break;
    }
    if (costTracker.isOverSoftLimit() && attempt > 1) {
      console.log(`  ⚠️  Cost soft limit reached ($${costTracker.getTotalCost().toFixed(2)}). Continuing current attempt.`);
    }

    // Run dev agent(s)
    if (devRoles.length === 1) {
      const dev = devRoles[0];
      const devPrompt = buildDevPrompt(config, pmFindings, attempt, attempt > 1 ? qaReport : undefined);
      devReport = await executePhaseWithRecovery(config, "implement", dev.agent_type, dev.model, devPrompt, dev.worktree);
    } else {
      // Parallel dev agents with file-scope assignment
      const fileAssignment = assignFileScopes(pmFindings, devRoles);
      const devResults = await Promise.all(
        devRoles.map((dev, idx) => {
          const scopeHint = fileAssignment[idx]
            ? `\n## File Scope Assignment\nYou own these areas (other devs handle the rest):\n${fileAssignment[idx]}\nDo NOT modify files outside your assignment to avoid conflicts.\n`
            : "";
          const devPrompt = buildDevPrompt(config, pmFindings, attempt, attempt > 1 ? qaReport : undefined) + scopeHint;
          return executePhaseWithRecovery(config, "implement", dev.agent_type, dev.model, devPrompt, dev.worktree);
        }),
      );
      devReport = devResults.join("\n\n---\n\n");
    }
    costTracker.recordFromOutput("implement", devRoles[0]?.model || "sonnet", devReport);
    checkpoint.save("implement", "completed", devReport.slice(0, 2000));

    // --- Phase 3: QA Verification ---
    console.log("\n[Phase 3] QA Verification...");
    checkpoint.save("verify", "started");
    const qaRole = config.preset.roles.find((r) => r.id === "qa");
    if (!qaRole) {
      qaVerdict = "PASS";
      qaReport = "No QA role in preset — skipping verification.";
      break;
    }

    const qaPrompt = buildQAPrompt(config, pmFindings, devReport);
    qaReport = await executePhaseWithRecovery(config, "verify", qaRole.agent_type, qaRole.model, qaPrompt, false);
    costTracker.recordFromOutput("verify", qaRole.model, qaReport);

    // Parse verdict from QA output
    if (qaReport.toLowerCase().includes("**pass**") || qaReport.toLowerCase().includes("verdict: pass")) {
      qaVerdict = "PASS";
      checkpoint.save("verify", "completed", "PASS");
    } else {
      qaVerdict = "FAIL";
      checkpoint.save("verify", "failed", qaReport.slice(0, 1000));

      // Adaptive retry: use severity-based decision instead of simple counter
      lastRetryDecision = shouldRetry(qaReport, {
        strict: config.goalAncestry.priority === "critical",
        maxRetries,
        currentAttempt: attempt - 1,
      });

      log(config.teamName, "verify", "fail", {
        attempt,
        priority: lastRetryDecision.severity,
        reason: lastRetryDecision.reason,
      } as any);

      if (lastRetryDecision.deferred) {
        console.log(`  Minor concern deferred to report (not retrying).`);
        break;
      }

      if (!lastRetryDecision.shouldRetry) {
        console.log(`\n⚠️  ${lastRetryDecision.reason}. Escalating to user.`);
        log(config.teamName, "verify", "escalate", { attempt, reason: lastRetryDecision.reason });
        break;
      }
    }
  }

  // --- Phase 4: Review (optional, with condition evaluation) ---
  let reviewReport = "";
  const phaseContext: PhaseContext = {
    output: { scope: pmFindings, implement: devReport, verify: qaReport },
    metrics: { totalCostUsd: costTracker.getTotalCost() },
  };
  const shouldRunReview = config.reviewMode !== "disabled" && qaVerdict === "PASS"
    && evaluateCondition("metrics.totalCostUsd > 0.50", phaseContext);

  if (shouldRunReview) {
    console.log(`\n[Phase 4] Review (${config.reviewMode})...`);
    checkpoint.save("review", "started");
    log(config.teamName, "review", "start", { mode: config.reviewMode });

    // Get the diff for review
    const diffProc = Bun.spawn(["git", "diff", "HEAD~1"], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: config.cwd,
    });
    const diffContent = await new Response(diffProc.stdout).text();
    await diffProc.exited;

    if (diffContent.trim()) {
      if (config.reviewMode === "bedrock") {
        reviewReport = await executeBedrockReview(config, diffContent);
      } else {
        reviewReport = await executeAdversarialReview(config, diffContent);
      }
      log(config.teamName, "review", "complete", { mode: config.reviewMode });
    } else {
      reviewReport = "No diff available for review.";
      log(config.teamName, "review", "skipped", { reason: "no diff" });
    }
  }

  // --- Phase 5: Report ---
  const totalMs = Date.now() - startTime;
  console.log(`\n[Phase 5] Generating report...`);
  log(config.teamName, "report", "complete", { total_ms: totalMs });

  const report = formatFinalReport(config, pmFindings, devReport, qaVerdict, qaReport, reviewReport, totalMs, attempt);

  // Save report and cost summary
  const reportPath = join(TEAMS_DIR, config.teamName, "report.md");
  writeFileSync(reportPath, report);

  // Cost tracking summary
  const costSummary = costTracker.formatTable();
  if (costSummary) {
    console.log(`\n  Cost breakdown:`);
    console.log(costSummary);
    appendFileSync(reportPath, `\n\n## Cost Summary\n\n\`\`\`\n${costSummary}\n\`\`\`\nTotal: $${costTracker.getTotalCost().toFixed(4)}\n`);
  }

  // Checkpoint cleanup on success
  if (qaVerdict === "PASS") {
    checkpoint.cleanup();
  }

  console.log(`\nReport saved: ${reportPath}`);
  console.log(`Run log: ${join(TEAMS_DIR, config.teamName, "run.jsonl")}`);
  console.log(`\nComplete in ${(totalMs / 1000).toFixed(1)}s | Cost: $${costTracker.getTotalCost().toFixed(4)}`);

  return report;
}

// --- Report Formatting ---

function formatFinalReport(
  config: TeamConfig,
  pmFindings: string,
  devReport: string,
  qaVerdict: string,
  qaReport: string,
  reviewReport: string,
  totalMs: number,
  attempts: number,
): string {
  const lines: string[] = [];
  lines.push(`# DevTeam Report: ${config.preset.name}`);
  lines.push("");
  lines.push(`**Issue:** ${config.issue}`);
  lines.push(`**Team:** ${config.teamName}`);
  lines.push(`**Preset:** ${config.preset.name}`);
  lines.push(`**Duration:** ${(totalMs / 1000).toFixed(1)}s`);
  lines.push(`**Attempts:** ${attempts}`);
  lines.push(`**QA Verdict:** ${qaVerdict}`);
  lines.push(`**Review Mode:** ${config.reviewMode}`);
  lines.push("");

  lines.push("## PM Scoping");
  lines.push("");
  lines.push(pmFindings);
  lines.push("");
  lines.push("---");
  lines.push("");

  lines.push("## Dev Implementation");
  lines.push("");
  lines.push(devReport);
  lines.push("");
  lines.push("---");
  lines.push("");

  lines.push("## QA Verification");
  lines.push("");
  lines.push(qaReport);
  lines.push("");

  if (reviewReport) {
    lines.push("---");
    lines.push("");
    lines.push("## Review");
    lines.push("");
    lines.push(reviewReport);
    lines.push("");
  }

  return lines.join("\n");
}

// --- CLI ---

async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      preset: { type: "string", default: "bug-fix" },
      issue: { type: "string", default: "" },
      github: { type: "string", default: "" },
      cwd: { type: "string", default: process.cwd() },
      priority: { type: "string", default: "" },
      why: { type: "string", default: "" },
      timeout: { type: "string", default: "" },
      "model-override": { type: "string", default: "" },
      "no-review": { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
      "list-presets": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`Usage: bun dev-team.ts [options]

Options:
  --preset <name>     Team preset: bug-fix, feature, investigation, code-review
  --issue <text>      Issue description
  --github <ref>      GitHub issue reference (owner/repo#123)
  --cwd <path>        Working directory for agents (default: current)
  --priority <level>  Goal priority: critical, standard, exploratory (default: standard)
  --why <text>        Why this matters (consequence of not doing it)
  --timeout <sec>     Per-phase timeout in seconds (default: 300)
  --model-override <spec>  Override model for phases (e.g., "scope:opus,implement:opus")
  --no-review         Skip the review phase
  --verbose           Show per-phase timing and agent output
  --list-presets      Show available presets and exit
  --dry-run           Show what would be executed without running agents
  --help              Show this help

Examples:
  bun dev-team.ts --preset bug-fix --issue "Login fails on Safari"
  bun dev-team.ts --preset feature --issue "Add dark mode toggle" --verbose
  bun dev-team.ts --preset investigation --issue "Memory leak in worker pool"
  bun dev-team.ts --preset bug-fix --github "myorg/myapp#456"
  bun dev-team.ts --preset bug-fix --no-review --issue "Typo in error message"`);
    process.exit(0);
  }

  if (values["list-presets"]) {
    console.log("Available presets:\n");
    for (const name of listPresets()) {
      const preset = loadPreset(name);
      const roles = preset.roles.map((r) => r.id).join(", ");
      console.log(`  ${name.padEnd(16)} ${preset.name.padEnd(20)} Roles: ${roles}`);
    }
    process.exit(0);
  }

  // Resolve issue
  let issue = values.issue || positionals.join(" ").trim();
  if (values.github && !issue) {
    // Fetch GitHub issue title/body
    const ghRef = values.github;
    const proc = Bun.spawn(["gh", "issue", "view", ghRef, "--json", "title,body"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const ghOut = await new Response(proc.stdout).text();
    const ghExit = await proc.exited;
    if (ghExit === 0) {
      const ghData = JSON.parse(ghOut);
      issue = `${ghData.title}\n\n${ghData.body}`;
    } else {
      console.error(`Failed to fetch GitHub issue: ${values.github}`);
      process.exit(1);
    }
  }

  if (!issue) {
    console.error("Provide an issue: --issue \"description\" or --github owner/repo#123");
    process.exit(1);
  }

  // Load preset
  const preset = loadPreset(values.preset!);

  // Validate credentials and detect review mode
  let reviewMode: "bedrock" | "claude-adversarial" | "disabled";
  let credentialWarnings: string[] = [];

  if (values["no-review"] || !preset.review.enabled) {
    reviewMode = "disabled";
  } else {
    const validation = validateDevTeamCredentials();
    reviewMode = validation.reviewMode;
    credentialWarnings = validation.warnings;

    if (credentialWarnings.length > 0 && values.verbose) {
      console.log("\n⚠️  Credential Warnings:");
      for (const warning of credentialWarnings) {
        console.log(`  • ${warning}`);
      }
    }
  }

  // Generate team name
  const teamName = generateTeamName(values.preset!, issue);

  // Parse model overrides: "scope:opus,implement:opus" → { scope: "opus", implement: "opus" }
  const modelOverrides: Record<string, string> = {};
  if (values["model-override"]) {
    for (const pair of values["model-override"].split(",")) {
      const [phase, model] = pair.split(":");
      if (phase && model) modelOverrides[phase.trim()] = model.trim();
    }
  }

  const config: TeamConfig = {
    preset,
    teamName,
    issue,
    cwd: resolve(values.cwd!),
    noReview: values["no-review"]!,
    verbose: values.verbose!,
    reviewMode,
    goalAncestry: {
      userIntent: issue.slice(0, 150),
      priority: (["critical", "standard", "exploratory"].includes(values.priority!) ? values.priority : "standard") as "critical" | "standard" | "exploratory",
      whyThisMatters: values.why || "User-reported issue affecting system functionality",
    },
    phaseTimeoutMs: values.timeout ? parseInt(values.timeout, 10) * 1000 : 300_000,
    modelOverrides,
  };

  // Dry run
  if (values["dry-run"]) {
    console.log("=== Dry Run ===\n");
    console.log(`Preset: ${preset.name}`);
    console.log(`Team: ${teamName}`);
    console.log(`Issue: ${issue.slice(0, 100)}`);
    console.log(`CWD: ${config.cwd}`);
    console.log(`Priority: ${config.goalAncestry.priority}`);
    console.log(`Why: ${config.goalAncestry.whyThisMatters}`);
    console.log(`Timeout: ${config.phaseTimeoutMs / 1000}s`);
    if (Object.keys(config.modelOverrides).length > 0) {
      console.log(`Model overrides: ${Object.entries(config.modelOverrides).map(([p, m]) => `${p}→${m}`).join(", ")}`);
    }
    console.log(`Review: ${reviewMode}`);
    console.log(`Retry max: ${preset.retry_max}`);
    console.log(`\nRoles:`);
    for (const role of preset.roles) {
      console.log(`  ${role.id.padEnd(12)} ${role.agent_type.padEnd(16)} ${role.model.padEnd(8)} worktree=${role.worktree}`);
    }
    console.log("\nNo agents spawned (dry run).");
    process.exit(0);
  }

  // Run orchestration
  try {
    const report = await orchestrate(config);
    console.log("\n" + report);
  } catch (e: any) {
    console.error(`\nFatal: ${e.message}`);
    log(teamName, "orchestrate", "fatal", { reason: e.message });
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(`Fatal: ${e.message}`);
    process.exit(1);
  });
}
