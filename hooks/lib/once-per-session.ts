// once-per-session.ts — Prevent hooks from re-firing on compaction/resume
//
// Hooks call runOncePerSession() at the top. If this session already ran
// this hook, it exits. Otherwise it writes a sentinel and continues.

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getPaiDir } from './paths';

const STATE_DIR = join(getPaiDir(), 'MEMORY', 'STATE');

export function alreadyRanForSession(hookName: string, sessionId: string | null): boolean {
  if (!sessionId) return false;
  try {
    const last = readFileSync(join(STATE_DIR, `.once-${hookName}`), 'utf-8').trim();
    return last === sessionId;
  } catch {
    return false;
  }
}

export function markRanForSession(hookName: string, sessionId: string | null): void {
  if (!sessionId) return;
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(join(STATE_DIR, `.once-${hookName}`), sessionId);
  } catch { /* non-fatal */ }
}
