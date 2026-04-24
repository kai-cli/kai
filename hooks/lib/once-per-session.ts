// once-per-session.ts — Prevent hooks from re-firing on compaction/resume
//
// Hooks call runOncePerSession() at the top. If this session already ran
// this hook, it exits. Otherwise it writes a sentinel and continues.

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getPaiDir } from './paths';

function stateDir(): string {
  return join(getPaiDir(), 'MEMORY', 'STATE');
}

export function alreadyRanForSession(hookName: string, sessionId: string | null): boolean {
  if (!sessionId) return false;
  try {
    const last = readFileSync(join(stateDir(), `.once-${hookName}`), 'utf-8').trim();
    return last === sessionId;
  } catch {
    return false;
  }
}

export function markRanForSession(hookName: string, sessionId: string | null): void {
  if (!sessionId) return;
  try {
    const dir = stateDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `.once-${hookName}`), sessionId);
  } catch { /* non-fatal */ }
}
