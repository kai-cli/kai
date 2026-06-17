#!/usr/bin/env bun
/**
 * PostCompactRecovery.hook.ts — Re-inject context after context compaction
 *
 * TRIGGER: SessionStart (with source: 'compact')
 *
 * PURPOSE: After Claude Code compacts a long conversation, identity, behavioral
 * rules, and Algorithm state are summarized or dropped. This hook detects
 * compaction and re-injects ~1.5KB of critical context as additionalContext.
 *
 * WHAT IT INJECTS:
 * - DA name, principal name, timezone
 * - Current Algorithm format rules (which mode, current phase if mid-task)
 * - Top behavioral reminders from AISTEERINGRULES
 */

import { readHookInput } from './lib/hook-io';
import { getDAName, getPrincipalName, getPrincipal } from './lib/identity';
import { paiPath } from './lib/paths';
import { readFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { basename } from 'path';
import { buildRecoveryBlock } from './lib/recovery-block';

/**
 * H2 (W6): after compaction the memcarry resume context is lost too. Re-inject it by re-reading the
 * CACHED resume payload (mem resume ships the cache immediately, no blocking probes). Returns a short
 * resume block or null. Degrades silently — never blocks recovery.
 */
function memcarryResumeBlock(projectDir: string): { block: string | null; cursorQuery: string } {
  try {
    const PAI = process.env.PAI_DIR ?? `${process.env.HOME}/.claude`;
    const cli = process.env.MEMCARRY_CLI ?? `${PAI}/memcarry/packages/cli/src/index.ts`;
    if (!existsSync(cli)) return { block: null, cursorQuery: '' };
    const project = basename(projectDir);
    // resume ships the CACHED payload immediately; the async verify it kicks is detached + idempotent,
    // so re-running on compaction is cheap and safe (no --no-verify flag exists / needed).
    const raw = execFileSync('bun', ['run', cli, 'resume', project, '--start', projectDir],
      { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] });
    const payload = JSON.parse(raw);
    if (!payload?.found) return { block: null, cursorQuery: '' };
    const lines = [`<memcarry-resume project="${project}" reinjected-after-compaction>`,
      `NEXT: ${payload.cursor.next}`, `WHERE: ${payload.cursor.summary}`, `</memcarry-resume>`];
    // The cursor (next + summary) is the "what am I working on" signal — used as the recall query for
    // H2 lesson re-injection, since the compaction event carries no user prompt.
    const cursorQuery = `${payload.cursor.next ?? ''} ${payload.cursor.summary ?? ''}`.trim();
    return { block: lines.join('\n'), cursorQuery };
  } catch {
    return { block: null, cursorQuery: '' };
  }
}

/**
 * H2 lesson re-injection: after compaction, re-surface the relevant memcarry LESSONS too (not just the
 * resume cursor). Recalls against the resume cursor text (the compaction event has no user prompt).
 * Uses the SHARED recallLessons helper (same as MemRecall) so the two can't drift. Never throws.
 */
async function memcarryRecallBlock(projectDir: string, query: string): Promise<string | null> {
  if (!query.trim()) return null;
  try {
    const PAI = process.env.PAI_DIR ?? `${process.env.HOME}/.claude`;
    const STORE = process.env.MEMCARRY_STORE ?? `${PAI}/MEMORY/memcarry/store`;
    const CACHE = process.env.MEMCARRY_VEC_CACHE ?? `${PAI}/memcarry/index/recall-vectors.json`;
    const { recallLessons } = await import('./lib/memcarry-semantic.js');
    const { hits } = await recallLessons(STORE, CACHE, query, basename(projectDir), 5);
    if (hits.length === 0) return null;
    const lines = [`<memcarry-recall reinjected-after-compaction>`];
    for (const h of hits) lines.push(`- ${h.claim}`);
    lines.push(`</memcarry-recall>`);
    return lines.join('\n');
  } catch {
    return null;
  }
}

async function main() {
  const input = await readHookInput();
  if (!input) process.exit(0);

  // Only fire on compaction, not normal session start
  if ((input as any).source !== 'compact') process.exit(0);

  const daName = getDAName();
  const principalName = getPrincipalName();
  const timezone = getPrincipal().timezone;
  const sessionId = input.session_id;

  // Read current Algorithm phase if mid-task
  let parsedAlgorithmState: { phase: string; effort: string; prd_path: string } | undefined;
  try {
    if (sessionId) {
      const statePath = paiPath('MEMORY', 'STATE', 'algorithms', `${sessionId}.json`);
      if (existsSync(statePath)) {
        const state = JSON.parse(readFileSync(statePath, 'utf-8'));
        if (state.active && state.phase) {
          parsedAlgorithmState = {
            phase: state.phase,
            effort: state.effort || 'standard',
            prd_path: state.prd_path || 'unknown',
          };
        }
      }
    }
  } catch {
    // State unavailable — skip
  }

  const recoveryBlock = buildRecoveryBlock({
    daName,
    principalName,
    timezone,
    algorithmState: parsedAlgorithmState,
  });

  // H2: re-inject memcarry context lost in compaction — both the resume CURSOR and the relevant
  // LESSONS (recalled against the cursor). Appended, each degrades to nothing independently.
  const projectDir = process.env.CLAUDE_PROJECT_DIR || (input as any).cwd || process.cwd();
  const { block: resumeBlock, cursorQuery } = memcarryResumeBlock(projectDir);
  const recallBlock = await memcarryRecallBlock(projectDir, cursorQuery);
  const memBlocks = [resumeBlock, recallBlock].filter(Boolean).join('\n\n');
  const fullBlock = memBlocks ? `${recoveryBlock}\n\n${memBlocks}` : recoveryBlock;

  console.log(JSON.stringify({ additionalContext: fullBlock }));
  console.error(`[PostCompactRecovery] Recovery context injected for session ${sessionId?.slice(0, 8) || 'unknown'}${resumeBlock ? ' (+memcarry-resume)' : ''}${recallBlock ? ' (+memcarry-recall)' : ''}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[PostCompactRecovery] Error:', err);
  process.exit(0);
});
