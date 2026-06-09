#!/usr/bin/env bun
/**
 * SecurityAuditLoop.ts — close the security-events audit loop (W7).
 *
 * MEMORY/SECURITY/security-events.jsonl had 3 WRITERS (SecurityValidator, WebFetchGuard,
 * SecretOutputDetector) and ZERO readers — a write-only dead end. This reader turns recurring
 * security DENIALS into behavioral instincts: when the same block/alert reason fires ≥ THRESHOLD
 * times, mint a `repetition`-source instinct via the existing instinct-store, so /evolve + /curate
 * surface it ("you keep getting blocked doing X — stop"). Purely additive — no writer changes, no
 * existing reader to break.
 *
 * Usage:
 *   bun PAI/Tools/SecurityAuditLoop.ts            # DRY-RUN by default — report recurring denials, mint nothing
 *   bun PAI/Tools/SecurityAuditLoop.ts --apply    # actually mint/reinforce instincts
 *   bun PAI/Tools/SecurityAuditLoop.ts --apply --days 30 --min 25 --include-tests
 *
 * SAFETY: dry-run is the DEFAULT (minting mutates the instinct store; opt in with --apply).
 * NOISE FILTER: events from test sessions (session_id starting "test-") are excluded by default —
 * the security log is dominated by `bun test` fixtures (~90% on a dev machine), which are NOT real
 * user behavior. Pass --include-tests to count them (rarely what you want).
 *
 * Wired into weekly maintenance in dry-run mode (reports; a human runs --apply after reviewing).
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { createInstinctWithDedup } from '../../hooks/lib/instinct-store';

const PAI_DIR = process.env.PAI_DIR || join(process.env.HOME || '', '.claude');
const SECURITY_LOG = join(PAI_DIR, 'MEMORY', 'SECURITY', 'security-events.jsonl');

const APPLY = process.argv.includes('--apply');
const DRY_RUN = !APPLY; // dry-run unless --apply is explicit
const INCLUDE_TESTS = process.argv.includes('--include-tests');
const DAYS = numArg('--days', 30);
const MIN_OCCURRENCES = numArg('--min', 25); // high floor — real recurring denials, not one-offs

function numArg(flag: string, dflt: number): number {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1]) { const n = parseInt(process.argv[i + 1]); if (!isNaN(n)) return n; }
  return dflt;
}

/** The 3 writers use different shapes; normalize to {ts, kind, reason, session}. Denials only. */
interface NormalizedEvent { ts: number; kind: string; reason: string; session: string; }

function normalize(raw: any): NormalizedEvent | null {
  const ts = new Date(raw.timestamp || 0).getTime();
  if (!ts) return null;
  const session = String(raw.session_id || '');
  // SecurityValidator: { event_type: block|confirm|alert|allow, reason?, command? }
  // WebFetchGuard:     { level, reason, url }
  // SecretOutputDetector: { level: 'alert', pattern, hook }
  const kind = String(raw.event_type || raw.level || 'unknown').toLowerCase();
  // Only DENIALS are instinct-worthy (block/confirm/alert) — `allow` is noise.
  if (!['block', 'confirm', 'alert'].includes(kind)) return null;
  // A stable "reason" key to group on: prefer reason, then pattern, then a truncated command/url.
  const reason = String(
    raw.reason || raw.pattern ||
    (raw.command ? `command: ${String(raw.command).slice(0, 60)}` : '') ||
    (raw.url ? `url: ${String(raw.url).slice(0, 60)}` : '') ||
    'unspecified'
  ).trim();
  return { ts, kind, reason, session };
}

function loadEvents(): NormalizedEvent[] {
  if (!existsSync(SECURITY_LOG)) return [];
  const cutoff = Date.now() - DAYS * 86_400_000;
  try {
    return readFileSync(SECURITY_LOG, 'utf-8')
      .trim().split('\n').filter(l => l.trim())
      .map(l => { try { return normalize(JSON.parse(l)); } catch { return null; } })
      .filter((e): e is NormalizedEvent => e !== null && e.ts >= cutoff)
      // Exclude test-suite noise (session_id "test-…") unless explicitly included.
      .filter(e => INCLUDE_TESTS || !e.session.startsWith('test-'));
  } catch {
    return [];
  }
}

async function main() {
  const events = loadEvents();
  if (events.length === 0) {
    console.log(`[SecurityAuditLoop] No denial events in the last ${DAYS}d (or no log yet). Nothing to do.`);
    return;
  }

  // Group denials by (kind + reason); recurring ones become instinct candidates.
  const groups = new Map<string, { kind: string; reason: string; count: number }>();
  for (const e of events) {
    const key = `${e.kind}::${e.reason}`;
    const g = groups.get(key) ?? { kind: e.kind, reason: e.reason, count: 0 };
    g.count++;
    groups.set(key, g);
  }

  const recurring = [...groups.values()].filter(g => g.count >= MIN_OCCURRENCES).sort((a, b) => b.count - a.count);
  console.log(`[SecurityAuditLoop] ${events.length} denial event(s) in ${DAYS}d → ${recurring.length} recurring pattern(s) (≥${MIN_OCCURRENCES}×).`);

  let minted = 0;
  for (const g of recurring) {
    const text = `Security guard repeatedly ${g.kind === 'block' ? 'blocked' : g.kind === 'confirm' ? 'required confirmation for' : 'alerted on'} the same action (${g.count}× in ${DAYS}d): ${g.reason}. Avoid triggering it.`;
    if (DRY_RUN) {
      console.log(`  [dry-run] would mint instinct: ${text}`);
      continue;
    }
    try {
      const inst = await createInstinctWithDedup(PAI_DIR, text, 'repetition', `security-events: ${g.kind} ×${g.count}`);
      console.log(`  ✓ instinct ${inst.id} (conf ${inst.confidence.toFixed(2)}, triggers ${inst.trigger_count}): ${g.reason.slice(0, 60)}`);
      minted++;
    } catch (err) {
      console.error(`  ✗ failed to mint instinct for "${g.reason.slice(0, 40)}": ${err}`);
    }
  }
  if (!DRY_RUN) console.log(`[SecurityAuditLoop] Minted/reinforced ${minted} instinct(s). Review via /evolve.`);
}

if (import.meta.main) {
  main().catch(err => { console.error('[SecurityAuditLoop] Fatal:', err); process.exit(0); });
}

export { normalize, loadEvents, type NormalizedEvent };
