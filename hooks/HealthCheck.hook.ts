#!/usr/bin/env bun
/**
 * HealthCheck.hook.ts — Verify environment integrity (SessionStart)
 *
 * In dev setups where ~/.claude is a symlink to a source repo, verifies
 * the symlink hasn't been redirected (e.g. by an unguarded installer).
 * Silently exits in non-symlink installs (direct clone, CI, kai).
 *
 * TRIGGER: SessionStart
 * OUTPUT: stderr (warnings if symlink is wrong)
 */

import { readlinkSync, lstatSync, existsSync } from 'fs';
import { resolve, join, basename } from 'path';

const HOME = process.env.HOME ?? '';
const CLAUDE_DIR = join(HOME, '.claude');

function main() {
  // Skip for subagents
  if (process.env.CLAUDE_AGENT_TYPE !== undefined) {
    process.exit(0);
  }

  try {
    const stat = lstatSync(CLAUDE_DIR);

    // Only relevant for symlinked dev setups
    if (!stat.isSymbolicLink()) {
      process.exit(0);
    }

    const target = resolve(readlinkSync(CLAUDE_DIR));

    // Detect if symlink points to an unexpected repo.
    // In a dev setup, the symlink target's basename should match what PAI_DIR resolves to.
    const paiDir = process.env.PAI_DIR ? resolve(process.env.PAI_DIR) : '';
    if (paiDir && target !== paiDir) {
      console.error(`🚨 ~/.claude → ${target}`);
      console.error(`   Expected: ${paiDir}`);
      console.error('   Bedrock, statusline, hooks, and settings may be broken.');
      console.error(`   Fix: ln -sfn ${paiDir} ~/.claude`);
      process.exit(0);
    }

    // Sanity: does the target actually have a config/ directory?
    if (!existsSync(join(target, 'config', 'hooks.jsonc'))) {
      console.error(`⚠️  ~/.claude → ${target} but config/hooks.jsonc is missing`);
    }
  } catch {
    // ~/.claude doesn't exist — not our problem to diagnose at hook level
  }

  process.exit(0);
}

main().catch((err) => { console.error(`[HealthCheck] Error:`, err); process.exit(0); });
