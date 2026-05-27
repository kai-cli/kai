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

// --- Bedrock Detection ---

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

function buildPMPrompt(config: TeamConfig): string {
  return `## Role: Project Manager / Scoping Agent

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

## Context
You are the Dev agent on a DevTeam. Implement the fix/feature based on the PM's scoping.
${retryContext}
## Issue
${config.issue}

## PM's Scoping
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

async function executePhase(
  config: TeamConfig,
  phase: string,
  agentType: string,
  model: string,
  prompt: string,
  useWorktree: boolean,
): Promise<string> {
  const startTime = Date.now();
  log(config.teamName, phase, "start", { agent: agentType });

  if (config.verbose) {
    console.log(`  [${phase}] Spawning ${agentType} (${model})...`);
  }

  const promptFile = join(tmpdir(), `devteam-${randomUUID()}.txt`);
  writeFileSync(promptFile, prompt);

  const worktreeFlag = useWorktree ? " --worktree" : "";
  const cmd = `claude -p "$(cat '${promptFile}')" --model ${model} --output-format text${worktreeFlag}`;

  const proc = Bun.spawn(["/bin/bash", "-c", cmd], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: config.cwd,
    env: { ...SPAWN_ENV, CLAUDE_CODE_MAX_TURNS: "50" },
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  const duration = Date.now() - startTime;

  try { unlinkSync(promptFile); } catch {}

  if (exitCode !== 0) {
    log(config.teamName, phase, "error", { agent: agentType, duration_ms: duration, reason: stderr.slice(0, 500) });
    if (config.verbose) {
      console.error(`  [${phase}] ERROR (${(duration / 1000).toFixed(1)}s): ${stderr.slice(0, 200)}`);
    }
    throw new Error(`${phase} agent failed: ${stderr.slice(0, 500)}`);
  }

  log(config.teamName, phase, "complete", { agent: agentType, duration_ms: duration });
  if (config.verbose) {
    console.log(`  [${phase}] Complete (${(duration / 1000).toFixed(1)}s, ${stdout.length} chars)`);
  }

  return stdout;
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

  // --- Phase 1: PM Scoping ---
  console.log("[Phase 1] PM Scoping...");
  const pmRole = config.preset.roles.find((r) => r.id === "pm" || r.id === "lead");
  const pmPrompt = buildPMPrompt(config);
  const pmFindings = await executePhase(
    config,
    "scope",
    pmRole?.agent_type || "Plan",
    pmRole?.model || "sonnet",
    pmPrompt,
    false,
  );

  // --- Phase 2: Dev Implementation (with retry support) ---
  console.log("\n[Phase 2] Dev Implementation...");
  const devRoles = config.preset.roles.filter((r) => r.id.startsWith("dev"));
  let devReport = "";
  let qaVerdict = "FAIL";
  let qaReport = "";
  let attempt = 0;
  const maxRetries = config.preset.retry_max;

  while (qaVerdict !== "PASS" && attempt <= maxRetries) {
    attempt++;
    if (attempt > 1) {
      console.log(`\n[Retry ${attempt}/${maxRetries + 1}] Dev addressing QA failures...`);
      log(config.teamName, "verify", "retry", { agent: "dev", attempt });
    }

    // Run dev agent(s)
    if (devRoles.length === 1) {
      const dev = devRoles[0];
      const devPrompt = buildDevPrompt(config, pmFindings, attempt, attempt > 1 ? qaReport : undefined);
      devReport = await executePhase(config, "implement", dev.agent_type, dev.model, devPrompt, dev.worktree);
    } else {
      // Parallel dev agents
      const devResults = await Promise.all(
        devRoles.map((dev) => {
          const devPrompt = buildDevPrompt(config, pmFindings, attempt, attempt > 1 ? qaReport : undefined);
          return executePhase(config, "implement", dev.agent_type, dev.model, devPrompt, dev.worktree);
        }),
      );
      devReport = devResults.join("\n\n---\n\n");
    }

    // --- Phase 3: QA Verification ---
    console.log("\n[Phase 3] QA Verification...");
    const qaRole = config.preset.roles.find((r) => r.id === "qa");
    if (!qaRole) {
      qaVerdict = "PASS";
      qaReport = "No QA role in preset — skipping verification.";
      break;
    }

    const qaPrompt = buildQAPrompt(config, pmFindings, devReport);
    qaReport = await executePhase(config, "verify", qaRole.agent_type, qaRole.model, qaPrompt, false);

    // Parse verdict from QA output
    if (qaReport.toLowerCase().includes("**pass**") || qaReport.toLowerCase().includes("verdict: pass")) {
      qaVerdict = "PASS";
    } else {
      qaVerdict = "FAIL";
      if (attempt > maxRetries) {
        console.log(`\n⚠️  QA failed after ${maxRetries + 1} attempts. Escalating to user.`);
        log(config.teamName, "verify", "escalate", { attempt, reason: "max retries exceeded" });
      }
    }
  }

  // --- Phase 4: Review (optional) ---
  let reviewReport = "";
  if (config.reviewMode !== "disabled" && qaVerdict === "PASS") {
    console.log(`\n[Phase 4] Review (${config.reviewMode})...`);
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

  // Save report
  const reportPath = join(TEAMS_DIR, config.teamName, "report.md");
  writeFileSync(reportPath, report);
  console.log(`\nReport saved: ${reportPath}`);
  console.log(`Run log: ${join(TEAMS_DIR, config.teamName, "run.jsonl")}`);
  console.log(`\nComplete in ${(totalMs / 1000).toFixed(1)}s`);

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

  // Detect review mode
  let reviewMode: "bedrock" | "claude-adversarial" | "disabled";
  if (values["no-review"] || !preset.review.enabled) {
    reviewMode = "disabled";
  } else {
    reviewMode = await detectReviewCapability();
  }

  // Generate team name
  const teamName = generateTeamName(values.preset!, issue);

  const config: TeamConfig = {
    preset,
    teamName,
    issue,
    cwd: resolve(values.cwd!),
    noReview: values["no-review"]!,
    verbose: values.verbose!,
    reviewMode,
  };

  // Dry run
  if (values["dry-run"]) {
    console.log("=== Dry Run ===\n");
    console.log(`Preset: ${preset.name}`);
    console.log(`Team: ${teamName}`);
    console.log(`Issue: ${issue.slice(0, 100)}`);
    console.log(`CWD: ${config.cwd}`);
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
