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
function memcarryResumeBlock(projectDir: string): string | null {
  try {
    const PAI = process.env.PAI_DIR ?? `${process.env.HOME}/.claude`;
    const cli = process.env.MEMCARRY_CLI ?? `${PAI}/memcarry/packages/cli/src/index.ts`;
    if (!existsSync(cli)) return null;
    const project = basename(projectDir);
    // resume ships the CACHED payload immediately; the async verify it kicks is detached + idempotent,
    // so re-running on compaction is cheap and safe (no --no-verify flag exists / needed).
    const raw = execFileSync('bun', ['run', cli, 'resume', project, '--start', projectDir],
      { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] });
    const payload = JSON.parse(raw);
    if (!payload?.found) return null;
    const lines = [`<memcarry-resume project="${project}" reinjected-after-compaction>`,
      `NEXT: ${payload.cursor.next}`, `WHERE: ${payload.cursor.summary}`, `</memcarry-resume>`];
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

  // H2: re-inject the memcarry resume context too (lost in compaction). Appended, degrades to nothing.
  const projectDir = process.env.CLAUDE_PROJECT_DIR || (input as any).cwd || process.cwd();
  const memBlock = memcarryResumeBlock(projectDir);
  const fullBlock = memBlock ? `${recoveryBlock}\n\n${memBlock}` : recoveryBlock;

  console.log(JSON.stringify({ additionalContext: fullBlock }));
  console.error(`[PostCompactRecovery] Recovery context injected for session ${sessionId?.slice(0, 8) || 'unknown'}${memBlock ? ' (+memcarry)' : ''}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[PostCompactRecovery] Error:', err);
  process.exit(0);
});
