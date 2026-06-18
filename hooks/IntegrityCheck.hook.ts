#!/usr/bin/env bun
/**
 * IntegrityCheck.hook.ts - PAI Integrity Check (SessionEnd)
 *
 * Runs system integrity check — detects PAI system file changes, spawns background maintenance.
 * Doc cross-ref integrity is handled by StopOrchestrator → DocCrossRefIntegrity (Stop event).
 *
 * TRIGGER: SessionEnd
 * PERFORMANCE: ~50ms (single transcript parse, one handler call). Non-blocking.
 */

import { getCachedTranscript } from './lib/transcript-cache';
import { handleSystemIntegrity } from './handlers/SystemIntegrity';
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

interface HookInput {
  session_id: string;
  transcript_path: string;
  hook_event_name: string;
}

async function readStdin(): Promise<HookInput | null> {
  try {
    const decoder = new TextDecoder();
    const reader = Bun.stdin.stream().getReader();
    let input = '';
    const timeout = new Promise<void>(r => setTimeout(r, 500));
    const read = (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        input += decoder.decode(value, { stream: true });
      }
    })();
    await Promise.race([read, timeout]);
    if (input.trim()) return JSON.parse(input) as HookInput;
  } catch {}
  return null;
}

/** Check skills-lock.json for drift — log warning, never block. */
function checkSkillsLock(): void {
  const paiDir = process.env.PAI_DIR ?? join(process.env.HOME ?? '', '.claude');
  const lockScript = join(paiDir, 'scripts', 'skills-lock.ts');
  const lockFile = join(paiDir, 'skills-lock.json');

  if (!existsSync(lockScript) || !existsSync(lockFile)) return;

  const result = spawnSync('bun', [lockScript, 'verify'], {
    cwd: paiDir,
    encoding: 'utf8',
    timeout: 10000,
  });

  if (result.status !== 0) {
    console.error('[IntegrityCheck] skills-lock drift detected — run: bun scripts/skills-lock.ts generate');
    console.error('[IntegrityCheck] Run: bun scripts/skills-lock.ts diff for details');
  } else {
    console.error('[IntegrityCheck] skills-lock OK');
  }
}

async function main() {
  const hookInput = await readStdin();
  if (!hookInput?.transcript_path) { process.exit(0); }

  const parsed = getCachedTranscript(hookInput.transcript_path);

  // Check skills-lock drift (warning only, never blocks session)
  checkSkillsLock();

  // Run system integrity check (doc cross-ref is handled by StopOrchestrator)
  await handleSystemIntegrity(parsed, hookInput);

  process.exit(0);
}

main().catch(() => process.exit(0));
