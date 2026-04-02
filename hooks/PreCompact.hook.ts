#!/usr/bin/env bun
/**
 * PreCompact.hook.ts - Preserve context across compaction (PreCompact)
 *
 * PURPOSE:
 * Fires before context compaction (auto or manual). Does two things:
 * 1. Injects a compact identity + state block as additionalContext so it
 *    survives INTO the compact summary (superior to post-hoc recovery).
 * 2. Writes a checkpoint file to WORK session scratch dir as a breadcrumb.
 *
 * TRIGGER: PreCompact
 *
 * INPUT:
 * - stdin: Hook input JSON (session_id, trigger: "manual"|"auto")
 * - Files: MEMORY/STATE/current-work-{session_id}.json
 *          MEMORY/STATE/algorithms/{session_id}.json
 *          ~/.claude/settings.json (for identity)
 *
 * OUTPUT:
 * - stdout: JSON { additionalContext: "..." } — injected into compaction input
 * - stderr: Status messages
 * - exit(0): Always (non-blocking, never interrupts compaction)
 *
 * SIDE EFFECTS:
 * - Creates: MEMORY/WORK/<dir>/scratch/compaction-checkpoint-<timestamp>.md
 *
 * DESIGN NOTES:
 * - Does NOT mark work as COMPLETED (unlike SessionSummary)
 * - Does NOT delete current-work.json (session stays active)
 * - additionalContext injection is strictly better than post-compaction recovery
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BASE_DIR = process.env.PAI_DIR || join(process.env.HOME!, '.claude');
const MEMORY_DIR = join(BASE_DIR, 'MEMORY');
const STATE_DIR = join(MEMORY_DIR, 'STATE');
const WORK_DIR = join(MEMORY_DIR, 'WORK');
const SETTINGS_PATH = join(BASE_DIR, 'settings.json');

interface HookInput {
  session_id?: string;
  trigger?: 'manual' | 'auto';
}

interface CurrentWork {
  session_id: string;
  session_dir: string;
  current_task: string;
  task_title: string;
  created_at: string;
}

interface AlgorithmState {
  currentPhase?: string;
  effortLevel?: string;
  active?: boolean;
  summary?: string;
}

function loadIdentity(): { daName: string; principalName: string; timezone: string } {
  try {
    const settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
    return {
      daName: settings.daidentity?.name || 'Assistant',
      principalName: settings.principal?.name || 'User',
      timezone: settings.principal?.timezone || 'UTC',
    };
  } catch {
    return { daName: 'Assistant', principalName: 'User', timezone: 'UTC' };
  }
}

function loadAlgorithmState(sessionId: string): AlgorithmState | null {
  try {
    const path = join(STATE_DIR, 'algorithms', `${sessionId}.json`);
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {}
  return null;
}

async function main() {
  try {
    let input: HookInput = {};
    try {
      const raw = await Promise.race([
        Bun.stdin.text(),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
      ]);
      if (raw && raw.trim()) {
        input = JSON.parse(raw);
      }
    } catch {
      // Proceed without input
    }

    const { session_id, trigger = 'auto' } = input;

    // Load identity and algorithm state for additionalContext injection
    const identity = loadIdentity();
    const algoState = session_id ? loadAlgorithmState(session_id) : null;

    // Build compact preservation block (~800 tokens max)
    const phase = algoState?.currentPhase || 'unknown';
    const effort = algoState?.effortLevel || 'unknown';
    const preservationBlock = [
      `## COMPACT PRESERVATION BLOCK`,
      `DA: ${identity.daName} | Principal: ${identity.principalName} | TZ: ${identity.timezone}`,
      `Algorithm phase: ${phase} | Effort: ${effort}`,
      `Key rules: Follow CLAUDE.md mode selection. Algorithm ISC must be measurable state.`,
      `Address user as "${identity.principalName}" always. Never "the user" or other generic names.`,
      algoState?.summary ? `Session context: ${algoState.summary.slice(0, 200)}` : '',
    ].filter(Boolean).join('\n');

    // Output additionalContext JSON to stdout — injected into compaction input
    console.log(JSON.stringify({ additionalContext: preservationBlock }));
    console.error(`[PreCompact] Injected ${preservationBlock.length} chars as additionalContext`);

    // Write sentinel for PostCompactRecovery (one-shot, TTL 5 min)
    if (session_id) {
      const sentinelPath = join(STATE_DIR, `pending-recovery-${session_id}.json`);
      writeFileSync(sentinelPath, JSON.stringify({
        session_id,
        timestamp: Date.now(),
        trigger,
        daName: identity.daName,
        principalName: identity.principalName,
        phase,
        effort,
        summary: algoState?.summary?.slice(0, 200) || null,
      }), 'utf-8');
      console.error(`[PreCompact] Sentinel written for PostCompactRecovery`);
    }

    // Also write checkpoint file (breadcrumb for resume)
    let stateFile: string | null = null;
    if (session_id) {
      const scoped = join(STATE_DIR, `current-work-${session_id}.json`);
      if (existsSync(scoped)) stateFile = scoped;
    }
    if (!stateFile) {
      const legacy = join(STATE_DIR, 'current-work.json');
      if (existsSync(legacy)) stateFile = legacy;
    }

    if (stateFile) {
      const currentWork: CurrentWork = JSON.parse(readFileSync(stateFile, 'utf-8'));
      const scratchDir = join(WORK_DIR, currentWork.session_dir, 'scratch');
      if (!existsSync(scratchDir)) {
        mkdirSync(scratchDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const checkpointPath = join(scratchDir, `compaction-checkpoint-${timestamp}.md`);
      const checkpointContent = [
        `# Compaction Checkpoint`,
        ``,
        `**Triggered:** ${new Date().toISOString()}`,
        `**Trigger type:** ${trigger}`,
        `**Session:** ${currentWork.session_id}`,
        `**Active task:** ${currentWork.task_title}`,
        `**Work dir:** ${currentWork.session_dir}`,
        `**Algorithm phase:** ${phase}`,
        ``,
        `## Context Note`,
        `Context was compacted at this point. The session is still ACTIVE.`,
        `Identity+state was injected as additionalContext into the compaction input.`,
        `Resume by reading the PRD at WORK/${currentWork.session_dir}/tasks/`,
        `and rebuilding working memory from the ISC section.`,
      ].join('\n');

      writeFileSync(checkpointPath, checkpointContent, 'utf-8');
      console.error(`[PreCompact] Checkpoint written: ${checkpointPath}`);

      // Write HANDOFF.md if PRD exists and has unchecked criteria
      const prdPath = join(WORK_DIR, currentWork.session_dir, 'PRD.md');
      if (existsSync(prdPath)) {
        try {
          const prdContent = readFileSync(prdPath, 'utf-8');
          const unchecked = prdContent.match(/^- \[ \] ISC-.+$/gm) || [];
          const checked = prdContent.match(/^- \[x\] ISC-.+$/gm) || [];
          if (unchecked.length > 0) {
            const handoffPath = join(WORK_DIR, currentWork.session_dir, 'HANDOFF.md');
            const total = checked.length + unchecked.length;
            const decisionsMatch = prdContent.match(/## Decisions\n([\s\S]*?)(?=\n## |\n---|\Z)/);
            const decisions = decisionsMatch ? decisionsMatch[1].trim() : 'None recorded';
            const handoffContent = [
              `---`,
              `session_id: ${currentWork.session_id}`,
              `handoff_type: compaction`,
              `timestamp: ${new Date().toISOString()}`,
              `phase_at_handoff: ${phase}`,
              `progress: ${checked.length}/${total}`,
              `---`,
              ``,
              `## What Was Done`,
              ...checked.map(c => `- ${c.replace(/^- \[x\] /, '')}`),
              ``,
              `## What Remains`,
              ...unchecked.map(c => `- ${c.replace(/^- \[ \] /, '')}`),
              ``,
              `## Key Decisions Made`,
              decisions,
              ``,
              `## Context Needed to Continue`,
              `- Read PRD at: MEMORY/WORK/${currentWork.session_dir}/PRD.md`,
              `- Algorithm state at: MEMORY/STATE/algorithms/${currentWork.session_id}.json`,
              ``,
              `## Suggested Next Step`,
              `Resume from ${phase} phase. ${unchecked.length} criteria remain.`,
            ].join('\n');
            writeFileSync(handoffPath, handoffContent, 'utf-8');
            console.error(`[PreCompact] HANDOFF.md written (${checked.length}/${total} done)`);
          }
        } catch (e) {
          console.error(`[PreCompact] HANDOFF.md generation failed: ${e}`);
        }
      }
    } else {
      console.error('[PreCompact] No active work session found (checkpoint skipped)');
    }

    console.error(`[PreCompact] Session remains active — ${trigger} compaction proceeding`);
    process.exit(0);
  } catch (error) {
    console.error(`[PreCompact] Error: ${error}`);
    process.exit(0);
  }
}

main();
