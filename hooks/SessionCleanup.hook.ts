#!/usr/bin/env bun
/**
 * SessionCleanup.hook.ts - Mark Work Complete and Clear State (SessionEnd)
 *
 * PURPOSE:
 * Finalizes a Claude Code session by marking the current work directory as
 * COMPLETED, clearing session state, resetting Kitty tab, and cleaning up
 * session name entries.
 *
 * TRIGGER: SessionEnd
 *
 * INPUT:
 * - stdin: Hook input JSON (session_id, transcript_path)
 * - Files: MEMORY/STATE/current-work.json
 *
 * OUTPUT:
 * - stdout: None
 * - stderr: Status messages
 * - exit(0): Always (non-blocking)
 *
 * SIDE EFFECTS:
 * - Updates: MEMORY/WORK/<dir>/PRD.md or META.yaml (status: COMPLETED)
 * - Deletes: MEMORY/STATE/current-work.json (clears session state)
 * - Resets: Kitty tab title and color to defaults
 * - Cleans: session-names.json entry (prevents ghost entries)
 *
 * INTER-HOOK RELATIONSHIPS:
 * - COORDINATES WITH: WorkCompletionLearning (both run at SessionEnd)
 * - MUST RUN AFTER: WorkCompletionLearning (learning capture uses state before clear)
 *
 * PERFORMANCE:
 * - Non-blocking: Yes
 * - Typical execution: <50ms
 */

import { writeFileSync, existsSync, readFileSync, unlinkSync, statSync, renameSync, readdirSync, mkdirSync } from 'fs';
import { spawn } from 'child_process';
import { atomicWriteJSON } from './lib/atomic';
import { join } from 'path';
import { getISOTimestamp } from './lib/time';
import { setTabState, cleanupKittySession } from './lib/tab-setter';
import { paiPath } from './lib/paths';

const MEMORY_DIR = paiPath('MEMORY');
const STATE_DIR = paiPath('MEMORY', 'STATE');
const WORK_DIR = paiPath('MEMORY', 'WORK');

// Session-scoped state file lookup with legacy fallback
function findStateFile(sessionId?: string): string | null {
  if (sessionId) {
    const scoped = join(STATE_DIR, `current-work-${sessionId}.json`);
    if (existsSync(scoped)) return scoped;
  }
  const legacy = join(STATE_DIR, 'current-work.json');
  if (existsSync(legacy)) return legacy;
  return null;
}

interface CurrentWork {
  session_id: string;
  session_dir: string;
  created_at: string;
  prd_path?: string;
  // Legacy fields (backward compat)
  current_task?: string;
  task_title?: string;
  task_count?: number;
}

/**
 * Mark work directory as completed and clear session state
 */
function clearSessionWork(sessionId?: string): void {
  try {
    const stateFile = findStateFile(sessionId);
    if (!stateFile) {
      console.error('[SessionCleanup] No current work to complete');
      return;
    }

    // Read current work state
    const content = readFileSync(stateFile, 'utf-8');
    const currentWork: CurrentWork = JSON.parse(content);

    // Guard: don't process another session's state
    if (sessionId && currentWork.session_id !== sessionId) {
      console.error('[SessionCleanup] State file belongs to different session, skipping');
      return;
    }

    // Write HANDOFF.md if PRD has unchecked criteria (session handoff protocol v3.13.0)
    if (currentWork.session_dir) {
      const workPath = join(WORK_DIR, currentWork.session_dir);
      const prdPath = join(workPath, 'PRD.md');
      if (existsSync(prdPath)) {
        try {
          const prdContent = readFileSync(prdPath, 'utf-8');
          const unchecked = prdContent.match(/^- \[ \] ISC-.+$/gm) || [];
          const checked = prdContent.match(/^- \[x\] ISC-.+$/gm) || [];
          if (unchecked.length > 0) {
            const total = checked.length + unchecked.length;
            // Extract algorithm phase from state file
            let phase = 'unknown';
            try {
              const algoPath = join(STATE_DIR, 'algorithms', `${currentWork.session_id}.json`);
              if (existsSync(algoPath)) {
                const algoState = JSON.parse(readFileSync(algoPath, 'utf-8'));
                phase = algoState.currentPhase || 'unknown';
              }
            } catch {}
            const decisionsMatch = prdContent.match(/## Decisions\n([\s\S]*?)(?=\n## |\n---|$)/);
            const decisions = decisionsMatch ? decisionsMatch[1].trim() : 'None recorded';
            const handoffContent = [
              `---`,
              `session_id: ${currentWork.session_id}`,
              `handoff_type: session_end`,
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
            writeFileSync(join(workPath, 'HANDOFF.md'), handoffContent, 'utf-8');
            console.error(`[SessionCleanup] HANDOFF.md written (${checked.length}/${total} done)`);
          }
        } catch (e) {
          console.error(`[SessionCleanup] HANDOFF.md generation failed: ${e}`);
        }
      }
    }

    // Mark work directory as COMPLETED — update PRD.md frontmatter (primary) or META.yaml (legacy)
    if (currentWork.session_dir) {
      const workPath = join(WORK_DIR, currentWork.session_dir);
      const prdPath = join(workPath, 'PRD.md');
      const metaPath = join(workPath, 'META.yaml');
      let marked = false;

      // Primary: update PRD.md frontmatter (consolidated format)
      if (existsSync(prdPath)) {
        let prdContent = readFileSync(prdPath, 'utf-8');
        prdContent = prdContent.replace(/^status: ACTIVE$/m, 'status: COMPLETED');
        prdContent = prdContent.replace(/^completed_at: null$/m, `completed_at: "${getISOTimestamp()}"`);
        writeFileSync(prdPath, prdContent, 'utf-8');
        marked = true;
      }

      // Legacy fallback: update META.yaml if it exists
      if (existsSync(metaPath)) {
        let metaContent = readFileSync(metaPath, 'utf-8');
        metaContent = metaContent.replace(/^status: "ACTIVE"$/m, 'status: "COMPLETED"');
        metaContent = metaContent.replace(/^completed_at: null$/m, `completed_at: "${getISOTimestamp()}"`);
        writeFileSync(metaPath, metaContent, 'utf-8');
        marked = true;
      }

      if (marked) {
        console.error(`[SessionCleanup] Marked work directory as COMPLETED: ${currentWork.session_dir}`);
      }
    }

    // Delete state file
    unlinkSync(stateFile);
    console.error('[SessionCleanup] Cleared session work state');

    // Clean session-names.json entry to prevent IDLE ghost on activity page
    if (sessionId || currentWork.session_id) {
      const sid = sessionId || currentWork.session_id;
      const snPath = join(STATE_DIR, 'session-names.json');
      try {
        if (existsSync(snPath)) {
          const names = JSON.parse(readFileSync(snPath, 'utf-8'));
          if (names[sid]) {
            delete names[sid];
            atomicWriteJSON(snPath, names);
            console.error(`[SessionCleanup] Removed session ${sid} from session-names.json`);
          }
        }
      } catch (e) {
        console.error(`[SessionCleanup] Failed to clean session-names.json: ${e}`);
      }
    }
  } catch (error) {
    console.error(`[SessionCleanup] Error clearing session work: ${error}`);
  }
}

async function main() {
  try {
    // Read input from stdin with timeout — SessionEnd hooks may receive
    // empty or slow stdin. Proceed regardless since state is read from disk.
    let sessionId: string | undefined;
    try {
      const input = await Promise.race([
        Bun.stdin.text(),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
      ]);
      if (input && input.trim()) {
        const parsed = JSON.parse(input);
        sessionId = parsed.session_id;
      }
    } catch {
      // Timeout or parse error — proceed without session_id
    }

    // Clear plan-pending state (no plan survives session end)
    const planPendingPath = join(STATE_DIR, 'plan-pending.json');
    if (existsSync(planPendingPath)) {
      try { unlinkSync(planPendingPath); } catch {}
      console.error('[SessionCleanup] Cleared plan-pending state');
    }

    // Mark work as complete and clear state
    clearSessionWork(sessionId);

    // Reset Kitty tab to neutral styling — no lingering colored backgrounds
    try {
      setTabState({ title: '', state: 'idle', sessionId });
      console.error('[SessionCleanup] Tab reset to default styling');
    } catch {
      console.error('[SessionCleanup] Tab reset failed (non-critical)');
    }

    // Clean up per-session kitty env file (prevents unbounded file accumulation)
    if (sessionId) {
      cleanupKittySession(sessionId);
      console.error(`[SessionCleanup] Cleaned up kitty session: ${sessionId}`);
    }

    // ── Memory retention cleanup (daily-gated) ──
    runRetentionCleanup();

    // ── LearningPatternSynthesis backstop (14-day-gated) ──
    // Primary trigger is `pai curate`; this ensures synthesis doesn't go stale
    // if curate isn't run for an extended period.
    maybeRunSynthesisBackstop();
    maybeAutoConsolidate();

    console.error('[SessionCleanup] Session ended, work marked complete');
    process.exit(0);
  } catch (error) {
    // Silent failure - don't disrupt workflow
    console.error(`[SessionCleanup] SessionEnd hook error: ${error}`);
    process.exit(0);
  }
}

/**
 * Run retention cleanup at most once per 24 hours.
 * Rotates oversized events.jsonl and deletes stale state files.
 */
function runRetentionCleanup(): void {
  const LAST_CLEANUP_PATH = join(STATE_DIR, 'last-cleanup.json');
  const ONE_DAY_MS = 86_400_000;

  try {
    // Check if we've run cleanup recently
    if (existsSync(LAST_CLEANUP_PATH)) {
      const lastCleanup = JSON.parse(readFileSync(LAST_CLEANUP_PATH, 'utf-8'));
      if (Date.now() - lastCleanup.timestamp < ONE_DAY_MS) return;
    }

    // Read retention config from settings.json
    let eventsMaxSizeMB = 100;
    let stateMaxAgeDays = 30;
    try {
      const settingsPath = join(paiPath(), 'settings.json');
      if (existsSync(settingsPath)) {
        const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
        eventsMaxSizeMB = settings.memory?.retention?.eventsMaxSizeMB ?? 100;
        stateMaxAgeDays = settings.memory?.retention?.stateMaxAgeDays ?? 30;
      }
    } catch {}

    const maxAgeMs = stateMaxAgeDays * ONE_DAY_MS;
    const now = Date.now();
    let cleaned = 0;

    // 1. Rotate events.jsonl if oversized
    const eventsPath = join(MEMORY_DIR, 'LEARNING', 'SIGNALS', 'events.jsonl');
    try {
      if (existsSync(eventsPath)) {
        const stat = statSync(eventsPath);
        const sizeMB = stat.size / (1024 * 1024);
        if (sizeMB > eventsMaxSizeMB) {
          const archiveName = `events.${new Date().toISOString().slice(0, 10)}.jsonl`;
          const archivePath = join(MEMORY_DIR, 'LEARNING', 'SIGNALS', archiveName);
          renameSync(eventsPath, archivePath);
          writeFileSync(eventsPath, '', 'utf-8');
          console.error(`[SessionCleanup] Rotated events.jsonl (${sizeMB.toFixed(1)}MB) → ${archiveName}`);
          cleaned++;
        }
      }
    } catch (e) {
      console.error(`[SessionCleanup] events.jsonl rotation failed: ${e}`);
    }

    // 2. Clean prompt-analysis-cache — files are valid for 30 seconds only.
    // Any file older than 24h is permanently stale (session long gone).
    const promptCacheDir = join(STATE_DIR, 'prompt-analysis-cache');
    try {
      if (existsSync(promptCacheDir)) {
        for (const file of readdirSync(promptCacheDir)) {
          if (!file.endsWith('.json')) continue;
          const filePath = join(promptCacheDir, file);
          try {
            if (now - statSync(filePath).mtimeMs > ONE_DAY_MS) {
              unlinkSync(filePath);
              cleaned++;
            }
          } catch {}
        }
      }
    } catch {}

    // 2b. Clean pending-recovery-*.json — these were written by PreCompact but
    // PostCompactRecovery reads from algorithms/ instead. Never consumed. Purge any
    // older than 24h (and PreCompact no longer writes new ones).
    try {
      for (const file of readdirSync(STATE_DIR)) {
        if (!file.startsWith('pending-recovery-') || !file.endsWith('.json')) continue;
        const filePath = join(STATE_DIR, file);
        try {
          if (now - statSync(filePath).mtimeMs > ONE_DAY_MS) {
            unlinkSync(filePath);
            cleaned++;
          }
        } catch {}
      }
    } catch {}

    // 2c. Clean orphaned current-work-*.json files whose WORK/ dir no longer exists
    try {
      for (const file of readdirSync(STATE_DIR)) {
        if (!file.startsWith('current-work-') || !file.endsWith('.json')) continue;
        const filePath = join(STATE_DIR, file);
        try {
          const cw = JSON.parse(readFileSync(filePath, 'utf-8'));
          if (cw.session_dir) {
            const workPath = join(WORK_DIR, cw.session_dir);
            if (!existsSync(workPath)) {
              unlinkSync(filePath);
              cleaned++;
            }
          }
        } catch {}
      }
    } catch {}

    // 3. Delete stale algorithm state files
    const algosDir = join(STATE_DIR, 'algorithms');
    try {
      if (existsSync(algosDir)) {
        for (const file of readdirSync(algosDir)) {
          const filePath = join(algosDir, file);
          try {
            const stat = statSync(filePath);
            if (now - stat.mtimeMs > maxAgeMs) {
              unlinkSync(filePath);
              cleaned++;
            }
          } catch {}
        }
      }
    } catch {}

    // 3. Cap ratings.jsonl to last 500 entries
    const ratingsPath = join(MEMORY_DIR, 'LEARNING', 'SIGNALS', 'ratings.jsonl');
    try {
      if (existsSync(ratingsPath)) {
        const lines = readFileSync(ratingsPath, 'utf-8').trim().split('\n').filter(l => l);
        if (lines.length > 500) {
          writeFileSync(ratingsPath, lines.slice(-500).join('\n') + '\n', 'utf-8');
          console.error(`[SessionCleanup] Capped ratings.jsonl: ${lines.length} → 500`);
          cleaned++;
        }
      }
    } catch (e) { console.error(`[SessionCleanup] ratings cap failed: ${e}`); }

    // 4. Cap algorithm-reflections.jsonl to last 200 entries
    const reflectionsPath = join(MEMORY_DIR, 'LEARNING', 'REFLECTIONS', 'algorithm-reflections.jsonl');
    try {
      if (existsSync(reflectionsPath)) {
        const lines = readFileSync(reflectionsPath, 'utf-8').trim().split('\n').filter(l => l);
        if (lines.length > 200) {
          writeFileSync(reflectionsPath, lines.slice(-200).join('\n') + '\n', 'utf-8');
          console.error(`[SessionCleanup] Capped algorithm-reflections.jsonl: ${lines.length} → 200`);
          cleaned++;
        }
      }
    } catch (e) { console.error(`[SessionCleanup] reflections cap failed: ${e}`); }

    // 5. Archive LEARNING/ALGORITHM and LEARNING/SYSTEM files older than 90 days
    const LEARNING_TTL_MS = 90 * ONE_DAY_MS;
    for (const category of ['ALGORITHM', 'SYSTEM']) {
      const categoryDir = join(MEMORY_DIR, 'LEARNING', category);
      if (!existsSync(categoryDir)) continue;
      try {
        for (const monthDir of readdirSync(categoryDir, { withFileTypes: true })) {
          if (!monthDir.isDirectory()) continue;
          const monthPath = join(categoryDir, monthDir.name);
          for (const file of readdirSync(monthPath)) {
            if (!file.endsWith('.md') && !file.endsWith('.jsonl')) continue;
            const filePath = join(monthPath, file);
            try {
              if (now - statSync(filePath).mtimeMs > LEARNING_TTL_MS) {
                const archiveDir = join(categoryDir, '.archive', monthDir.name);
                mkdirSync(archiveDir, { recursive: true });
                renameSync(filePath, join(archiveDir, file));
                cleaned++;
              }
            } catch {}
          }
        }
      } catch {}
    }

    // 5b. FAILURES cleanup: delete tool-calls.json after 30 days; keep CONTEXT.md + sentiment.json permanently.
    // 30 days is sufficient — loadFailurePatterns() only surfaces 5 most recent, and tool-calls.json
    // is only useful if you're debugging a specific failure within a month of it happening.
    // Transcripts are not stored here — they live in native Claude Code session storage.
    const TOOL_CALLS_TTL_MS = 30 * ONE_DAY_MS;
    const failuresDir = join(MEMORY_DIR, 'LEARNING', 'FAILURES');
    if (existsSync(failuresDir)) {
      try {
        for (const monthDir of readdirSync(failuresDir, { withFileTypes: true })) {
          if (!monthDir.isDirectory() || monthDir.name.startsWith('.')) continue;
          const monthPath = join(failuresDir, monthDir.name);
          for (const failDir of readdirSync(monthPath, { withFileTypes: true })) {
            if (!failDir.isDirectory()) continue;
            const failPath = join(monthPath, failDir.name);
            // Delete tool-calls.json after 30 days
            const toolCallsPath = join(failPath, 'tool-calls.json');
            try {
              if (existsSync(toolCallsPath) && now - statSync(toolCallsPath).mtimeMs > TOOL_CALLS_TTL_MS) {
                unlinkSync(toolCallsPath);
                cleaned++;
              }
            } catch {}
            // Delete any transcript.jsonl that snuck in (legacy or copied)
            const transcriptPath = join(failPath, 'transcript.jsonl');
            try {
              if (existsSync(transcriptPath)) {
                unlinkSync(transcriptPath);
                cleaned++;
              }
            } catch {}
          }
        }
      } catch {}
    }

    // 6. Archive RELATIONSHIP months older than 6 months
    const relationshipDir = join(MEMORY_DIR, 'RELATIONSHIP');
    try {
      if (existsSync(relationshipDir)) {
        for (const monthDir of readdirSync(relationshipDir, { withFileTypes: true })) {
          if (!monthDir.isDirectory() || monthDir.name.startsWith('.')) continue;
          const monthPath = join(relationshipDir, monthDir.name);
          try {
            if (now - statSync(monthPath).mtimeMs > 180 * ONE_DAY_MS) {
              const archiveDir = join(relationshipDir, '.archive');
              mkdirSync(archiveDir, { recursive: true });
              renameSync(monthPath, join(archiveDir, monthDir.name));
              console.error(`[SessionCleanup] Archived RELATIONSHIP/${monthDir.name}`);
              cleaned++;
            }
          } catch {}
        }
      }
    } catch {}

    // Record cleanup timestamp
    atomicWriteJSON(LAST_CLEANUP_PATH, { timestamp: now });
    if (cleaned > 0) {
      console.error(`[SessionCleanup] Retention cleanup: ${cleaned} items cleaned`);
    }
  } catch (e) {
    console.error(`[SessionCleanup] Retention cleanup failed: ${e}`);
  }
}

/**
 * Backstop: if LearningPatternSynthesis hasn't run in 14 days, spawn it detached.
 * Primary trigger is `pai curate`; this ensures synthesis doesn't go stale.
 */
export function maybeRunSynthesisBackstop(): void {
  const SYNTHESIS_GATE_DAYS = 14;
  const synthStatePath = join(STATE_DIR, 'synthesis-state.json');
  try {
    let daysSince = SYNTHESIS_GATE_DAYS + 1; // default to stale
    if (existsSync(synthStatePath)) {
      const state = JSON.parse(readFileSync(synthStatePath, 'utf-8'));
      if (state.lastRun) {
        daysSince = (Date.now() - new Date(state.lastRun).getTime()) / 86_400_000;
      }
    }
    if (daysSince >= SYNTHESIS_GATE_DAYS) {
      const synthPath = join(paiPath(), 'PAI', 'Tools', 'LearningPatternSynthesis.ts');
      if (existsSync(synthPath)) {
        const proc = spawn('bun', [synthPath, '--month'], {
          detached: true,
          stdio: 'ignore',
          env: { ...process.env },
        });
        proc.unref();
        console.error(`[SessionCleanup] Synthesis backstop triggered (${Math.floor(daysSince)}d since last run)`);
      }
    }
  } catch { /* non-critical */ }
}

/**
 * Auto-consolidate eligible STAGING entries (daily, max 3 promotions).
 */
export function maybeAutoConsolidate(): void {
  try {
    const consolidatePath = join(paiPath(), 'PAI', 'Tools', 'AutoConsolidate.ts');
    if (!existsSync(consolidatePath)) return;

    const proc = spawn('bun', [consolidatePath], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    });
    proc.unref();
    console.error('[SessionCleanup] Auto-consolidation check spawned');
  } catch { /* non-critical */ }
}

if (import.meta.main) { main(); }
