#!/usr/bin/env bun
/**
 * reconcile-wiring.ts — SF-10 drift guard for hook wiring.
 *
 * WHY: "Which hooks run" is encoded in multiple hand-maintained places (config/hooks.jsonc,
 * the SessionEndComposite fan-out list, wiki count tables). When they drift, the bug is
 * invisible until something is activated — exactly how the W4 MemCapture omission slipped past
 * a full audit. This check cross-references those representations so drift fails CI on commit
 * instead of surfacing months later.
 *
 * INVARIANTS CHECKED (read-only — never mutates any file):
 *  1. Every hook command registered in hooks.jsonc resolves to an existing .hook.ts file.
 *  2. SessionEnd registers exactly ONE entry: SessionEndComposite (post-W4 contract).
 *  3. Every hook in the composite's fan-out (selectSessionEndHooks(false)) resolves to a file.
 *  4. [wiki, best-effort] overview.md per-event hook counts match reality:
 *       - SessionEnd → composite fan-out size (10), NOT the registration count (1).
 *       - other events → registration count.
 *     Skipped gracefully when the wiki repo is absent.
 *
 * USAGE:  bun scripts/reconcile-wiring.ts            (exit 0 = ok, 1 = drift)
 * ENV:    PAI_DIR (default ~/.claude), PAI_WIKI_DIR (default ~/Projects/PAI-Wiki)
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { parseJSONC } from '../hooks/handlers/BuildSettings';
import { selectSessionEndHooks } from '../hooks/SessionEndComposite.hook';

const PAI_DIR = process.env.PAI_DIR || join(homedir(), '.claude');
const WIKI_DIR = process.env.PAI_WIKI_DIR || join(homedir(), 'Projects', 'PAI-Wiki');

export interface ReconcileResult {
  errors: string[];
  warnings: string[];
  registeredCounts: Record<string, number>;
}

/** Extract the hook script filename from a run-hook.sh or bare-bun command string. */
export function hookFileFromCommand(command: string): string | null {
  // Matches "...run-hook.sh SomeHook.hook.ts" or "...bun .../SomeHook.hook.ts"
  const m = command.match(/([A-Za-z0-9_-]+\.hook\.ts)\b/);
  return m ? m[1] : null;
}

/** Collect every hook command string under an event's entry array (handles matcher + bare shapes). */
function commandsForEvent(eventEntries: any[]): string[] {
  const cmds: string[] = [];
  for (const entry of eventEntries ?? []) {
    for (const h of entry.hooks ?? []) {
      if (typeof h.command === 'string') cmds.push(h.command);
    }
  }
  return cmds;
}

export function reconcile(paiDir = PAI_DIR, wikiDir = WIKI_DIR): ReconcileResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const registeredCounts: Record<string, number> = {};

  // ---- Parse hooks.jsonc ----
  const hooksJsoncPath = join(paiDir, 'config', 'hooks.jsonc');
  if (!existsSync(hooksJsoncPath)) {
    errors.push(`hooks.jsonc not found at ${hooksJsoncPath}`);
    return { errors, warnings, registeredCounts };
  }
  const parsed = parseJSONC(readFileSync(hooksJsoncPath, 'utf-8')) as any;
  const events: Record<string, any[]> = parsed.hooks ?? {};

  // ---- Invariant 1: every registered hook command resolves to a file ----
  for (const [event, entries] of Object.entries(events)) {
    const cmds = commandsForEvent(entries);
    registeredCounts[event] = cmds.length;
    for (const cmd of cmds) {
      const file = hookFileFromCommand(cmd);
      if (!file) continue; // non-hook command (e.g. a raw script) — skip
      if (!existsSync(join(paiDir, 'hooks', file))) {
        errors.push(`[${event}] registered hook "${file}" has no file at hooks/${file}`);
      }
    }
  }

  // ---- Invariant 2: SessionEnd topology is one of two VALID shapes ----
  // Topology is DETECTED from the config, not assumed — so this guard is correct in both
  // pai-config (post-W4: composite mode) and the KAI fork (pre-W4: individual mode), with no
  // repo-name branching. The only hard error is the double-run hazard: composite + leftovers.
  const seCmds = commandsForEvent(events.SessionEnd ?? []);
  const seFiles = seCmds.map(hookFileFromCommand).filter(Boolean) as string[];
  const compositeWired = seFiles.includes('SessionEndComposite.hook.ts');

  if (compositeWired) {
    // Composite mode: it must be the SOLE SessionEnd entry (else hooks double-run).
    if (seFiles.length !== 1) {
      errors.push(
        `SessionEnd wires SessionEndComposite alongside other entries — double-run hazard. Found: [${seFiles.join(', ')}]`
      );
    }
    // Invariant 3 (composite mode only): every fan-out hook must resolve to a file.
    for (const name of selectSessionEndHooks(false)) {
      if (!existsSync(join(paiDir, 'hooks', `${name}.hook.ts`))) {
        errors.push(`SessionEndComposite fans out to "${name}" but hooks/${name}.hook.ts does not exist`);
      }
    }
  } else if (seFiles.length === 0) {
    // No SessionEnd wiring at all is suspicious in either repo.
    warnings.push('SessionEnd registers no hooks — expected the composite or individual entries');
  }
  // Individual mode (no composite wired): each entry's file-resolution is covered by Invariant 1.

  // ---- Invariant 4 (best-effort): wiki overview.md counts match reality ----
  const overviewPath = join(wikiDir, 'overview.md');
  if (!existsSync(overviewPath)) {
    warnings.push(`wiki not found at ${overviewPath} — skipped wiki count reconciliation`);
  } else {
    const overview = readFileSync(overviewPath, 'utf-8');
    // Rows like: | SessionEnd | 10 | ... |   or   | SessionEnd | 1→10 | ... |
    // SessionEnd's "real" count is topology-dependent: composite mode → fan-out size (the wiki
    // documents what actually runs); individual mode → registration count. Other events → registration count.
    const sessionEndExpected = compositeWired ? selectSessionEndHooks(false).length : registeredCounts.SessionEnd;
    for (const [event, regCount] of Object.entries(registeredCounts)) {
      const row = new RegExp(`^\\|\\s*${event}\\s*\\|\\s*([0-9]+)(?:→([0-9]+))?\\s*\\|`, 'm');
      const m = overview.match(row);
      if (!m) continue; // event not tabulated in overview — not an error
      const expected = event === 'SessionEnd' ? sessionEndExpected : regCount;
      const documented = m[2] ? parseInt(m[2]) : parseInt(m[1]); // use the fan-out number if "a→b" form
      if (documented !== expected) {
        warnings.push(
          `wiki overview.md says ${event}=${documented} but reality=${expected} (${event === 'SessionEnd' && compositeWired ? 'composite fan-out' : 'registrations'})`
        );
      }
    }
  }

  return { errors, warnings, registeredCounts };
}

if (import.meta.main) {
  const { errors, warnings } = reconcile();
  console.log('=== Hook Wiring Reconciliation (SF-10) ===');
  for (const w of warnings) console.log(`⚠️  ${w}`);
  if (errors.length === 0) {
    console.log(`✅ No wiring drift. ${warnings.length} warning(s).`);
    process.exit(0);
  }
  for (const e of errors) console.log(`❌ ${e}`);
  console.log(`\n${errors.length} drift error(s) — fix before commit.`);
  process.exit(1);
}
