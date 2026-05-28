/**
 * algorithm/state.ts - Algorithm state persistence and management
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import type { LoopAlgorithmState, CriteriaInfo, PRDFrontmatter } from "./types";

const HOME = process.env.HOME || "~";
const BASE_DIR = process.env.PAI_DIR || join(HOME, ".claude");
const ALGORITHMS_DIR = join(BASE_DIR, "MEMORY", "STATE", "algorithms");
const SESSION_NAMES_PATH = join(BASE_DIR, "MEMORY", "STATE", "session-names.json");

// ─── Directory Management ───────────────────────────────────────────────────

export function ensureAlgorithmsDir(): void {
  if (!existsSync(ALGORITHMS_DIR)) mkdirSync(ALGORITHMS_DIR, { recursive: true });
}

// ─── Algorithm State I/O ─────────────────────────────────────────────────────

export function readAlgorithmState(sessionId: string): LoopAlgorithmState | null {
  try {
    const file = join(ALGORITHMS_DIR, `${sessionId}.json`);
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

export function writeAlgorithmState(state: LoopAlgorithmState): void {
  ensureAlgorithmsDir();
  state.effortLevel = state.sla;
  writeFileSync(join(ALGORITHMS_DIR, `${state.sessionId}.json`), JSON.stringify(state, null, 2));
}

// ─── Session Names Registry ──────────────────────────────────────────────────

export function readSessionNames(): Record<string, string> {
  try {
    if (existsSync(SESSION_NAMES_PATH)) {
      return JSON.parse(readFileSync(SESSION_NAMES_PATH, "utf-8"));
    }
  } catch {}
  return {};
}

export function writeSessionName(sessionId: string, name: string): void {
  const names = readSessionNames();
  names[sessionId] = name;
  writeFileSync(SESSION_NAMES_PATH, JSON.stringify(names, null, 2));
}

export function removeSessionName(sessionId: string): void {
  const names = readSessionNames();
  delete names[sessionId];
  writeFileSync(SESSION_NAMES_PATH, JSON.stringify(names, null, 2));
}

// ─── Notification ───────────────────────────────────────────────────────────

export function voiceNotify(message: string): void {
  console.error(`[loop] ${message}`);
}

// ─── PRD Title Extraction ───────────────────────────────────────────────────

export function extractPRDTitle(content: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "Untitled PRD";
}

// ─── PRD Frontmatter Parsing ─────────────────────────────────────────────────

export function readPRD(path: string): { frontmatter: PRDFrontmatter; content: string; raw: string } {
  const raw = readFileSync(path, "utf-8");
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new Error(`Invalid PRD format: no frontmatter found in ${path}`);
  }

  const yamlBlock = match[1];
  const content = match[2];

  // Simple YAML parsing — no heavy dependencies
  const fm: Record<string, unknown> = {};
  for (const line of yamlBlock.split("\n")) {
    const kvMatch = line.match(/^(\w+):\s*(.*)$/);
    if (kvMatch) {
      const [, key, val] = kvMatch;
      if (val === "null" || val === "") fm[key] = null;
      else if (val === "true") fm[key] = true;
      else if (val === "false") fm[key] = false;
      else if (val === "[]") fm[key] = [];
      else if (/^\[.*\]$/.test(val)) {
        fm[key] = val.slice(1, -1).split(",").map(s => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      }
      else if (/^\d+$/.test(val)) fm[key] = parseInt(val, 10);
      else fm[key] = val.replace(/^["']|["']$/g, "");
    }
  }

  return {
    frontmatter: {
      prd: fm.prd === true,
      id: (fm.id as string) || "unknown",
      status: (fm.status as string) || "DRAFT",
      mode: (fm.mode as string) || "interactive",
      effort_level: (fm.effort_level as string) || (fm.sla_tier as string) || "Standard",
      iteration: (fm.iteration as number) || 0,
      maxIterations: (fm.maxIterations as number) || 128,
      loopStatus: (fm.loopStatus as string) || null,
      last_phase: (fm.last_phase as string) || null,
      failing_criteria: Array.isArray(fm.failing_criteria) ? fm.failing_criteria as string[] : [],
      verification_summary: (fm.verification_summary as string) || "0/0",
      ...fm,
    },
    content,
    raw,
  };
}

export function updateFrontmatter(path: string, updates: Record<string, unknown>): void {
  const raw = readFileSync(path, "utf-8");
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`Invalid PRD format in ${path}`);

  let yamlBlock = match[1];
  const content = match[2];

  for (const [key, value] of Object.entries(updates)) {
    const strVal = value === null ? "null" : String(value);
    const regex = new RegExp(`^(${key}):.*$`, "m");
    if (regex.test(yamlBlock)) {
      yamlBlock = yamlBlock.replace(regex, `${key}: ${strVal}`);
    } else {
      yamlBlock += `\n${key}: ${strVal}`;
    }
  }

  writeFileSync(path, `---\n${yamlBlock}\n---\n${content}`);
}

// ─── Criteria Counting & Parsing ─────────────────────────────────────────────

export function countCriteria(content: string): CriteriaInfo {
  const criteria: CriteriaInfo["criteria"] = [];

  // Parse all checked criteria
  const checkedMatches = content.matchAll(/- \[x\] (ISC-[A-Za-z0-9-]+):\s*(.+?)(?:\s*\|\s*Verify:.*)?$/gm);
  for (const m of checkedMatches) {
    criteria.push({ id: m[1], description: m[2].trim(), status: "passing" });
  }

  // Parse all unchecked criteria
  const uncheckedMatches = content.matchAll(/- \[ \] (ISC-[A-Za-z0-9-]+):\s*(.+?)(?:\s*\|\s*Verify:.*)?$/gm);
  for (const m of uncheckedMatches) {
    criteria.push({ id: m[1], description: m[2].trim(), status: "failing" });
  }

  // Fallback to legacy format
  if (criteria.length === 0) {
    const legacyChecked = content.matchAll(/- \[x\] ([CA]\d+):\s*(.+)$/gm);
    for (const m of legacyChecked) criteria.push({ id: m[1], description: m[2].trim(), status: "passing" });
    const legacyUnchecked = content.matchAll(/- \[ \] ([CA]\d+):\s*(.+)$/gm);
    for (const m of legacyUnchecked) criteria.push({ id: m[1], description: m[2].trim(), status: "failing" });
  }

  const passing = criteria.filter(c => c.status === "passing").length;
  const failing = criteria.filter(c => c.status === "failing").length;
  const failingIds = criteria.filter(c => c.status === "failing").map(c => c.id);

  return { total: criteria.length, passing, failing, failingIds, criteria };
}

// ─── Dashboard State Sync ────────────────────────────────────────────────────

export function syncCriteriaToState(state: LoopAlgorithmState, criteriaInfo: CriteriaInfo): void {
  state.criteria = criteriaInfo.criteria.map(c => ({
    id: c.id,
    description: c.description,
    type: c.id.startsWith("ISC-A") ? "anti-criterion" as const : "criterion" as const,
    status: c.status === "passing" ? "completed" as const : "pending" as const,
    createdInPhase: "OBSERVE",
  }));
}

export function createLoopState(
  sessionId: string,
  prdPath: string,
  prdId: string,
  title: string,
  max: number,
  criteriaInfo: CriteriaInfo,
  effortLevel: string = "Standard",
  agentCount: number = 1,
): LoopAlgorithmState {
  const now = Date.now();
  const state: LoopAlgorithmState = {
    active: true,
    sessionId,
    taskDescription: `Loop: ${title}`,
    currentPhase: "EXECUTE",
    phaseStartedAt: now,
    algorithmStartedAt: now,
    sla: effortLevel as any,
    criteria: [],
    agents: [],
    capabilities: ["Task Tool", "SDK", "Loop Runner"],
    prdPath,
    phaseHistory: [{ phase: "EXECUTE", startedAt: now, criteriaCount: criteriaInfo.total, agentCount: agentCount }],
    loopMode: true,
    loopIteration: 0,
    loopMaxIterations: max,
    loopPrdId: prdId,
    loopPrdPath: prdPath,
    loopHistory: [],
    parallelAgents: agentCount,
    mode: "loop",
  };
  syncCriteriaToState(state, criteriaInfo);
  return state;
}

export function updateLoopStateForIteration(
  state: LoopAlgorithmState,
  iteration: number,
  criteriaInfo: CriteriaInfo,
): void {
  state.active = true;
  state.loopIteration = iteration;
  state.currentPhase = "EXECUTE";
  state.phaseStartedAt = Date.now();
  state.taskDescription = `Loop: ${state.loopPrdId} [${criteriaInfo.passing}/${criteriaInfo.total} iter ${iteration}]`;
  syncCriteriaToState(state, criteriaInfo);
}

export function finalizeLoopState(
  state: LoopAlgorithmState,
  outcome: "completed" | "failed" | "blocked" | "paused" | "stopped",
  criteriaInfo: CriteriaInfo,
): void {
  state.active = false;
  state.completedAt = Date.now();
  state.currentPhase = outcome === "completed" ? "COMPLETE" : "VERIFY";
  state.summary = `${outcome}: ${criteriaInfo.passing}/${criteriaInfo.total} criteria in ${state.loopIteration} iterations`;
  syncCriteriaToState(state, criteriaInfo);

  // Close last phase history entry
  if (state.phaseHistory.length > 0) {
    const last = state.phaseHistory[state.phaseHistory.length - 1];
    if (!last.completedAt) last.completedAt = Date.now();
  }
}
