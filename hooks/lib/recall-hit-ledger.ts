/**
 * recall-hit-ledger.ts — closes the recall HIT-RATE loop (MEMORY-ARCHITECTURE-PLAN.md Phase 1 metric).
 *
 * THE GAP THIS FILLS: recall hooks emit `recall.surfaced` (what we showed), but nothing emitted
 * `recall.hit` (whether it was useful) — so hit-rate was always 0/N. The plan's definition of a hit:
 * a surfaced memory whose SOURCE FILE is subsequently Read in the same session (the useful-recall
 * proxy). This ledger is the correlation substrate:
 *   - recall hooks call recordSurfaced(session, sources) when they surface memories
 *   - ReadActivity calls creditRead(session, readPath) on every memory Read; if it matches a surfaced
 *     source not yet credited, it emits recall.hit once.
 *
 * Session-scoped + bounded + non-blocking. The ledger is derived/ephemeral state (rebuildable, never
 * truth). Matching is by BASENAME because recall.surfaced may log a title or a path while Read logs an
 * absolute path — basename is the robust common key.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { emitMemoryTelemetry } from './memory-telemetry';

const MAX_SOURCES = 200; // hard cap per session — bounded growth

interface Ledger {
  session: string;
  /** basename -> original source string (path or title) */
  surfaced: Record<string, string>;
  /** basenames already credited as a hit this session (dedup) */
  credited: string[];
}

function paiDir(): string {
  return process.env.PAI_DIR ?? `${process.env.HOME}/.claude`;
}

function ledgerPath(session: string): string {
  const safe = (session || 'unknown').replace(/[^A-Za-z0-9._-]/g, '_');
  return join(paiDir(), 'MEMORY', 'STATE', `recall-surfaced-${safe}.json`);
}

function load(session: string): Ledger {
  try {
    const raw = JSON.parse(readFileSync(ledgerPath(session), 'utf-8')) as Ledger;
    if (raw && typeof raw === 'object' && raw.surfaced) {
      return { session, surfaced: raw.surfaced, credited: Array.isArray(raw.credited) ? raw.credited : [] };
    }
  } catch { /* fresh */ }
  return { session, surfaced: {}, credited: [] };
}

function save(led: Ledger): void {
  try {
    const p = ledgerPath(led.session);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(led));
  } catch { /* non-fatal */ }
}

/** Normalize a surfaced source (path or title) to a matchable basename key. */
function keyOf(source: string): string {
  if (!source) return '';
  // A path → basename; a bare title → lowercased, spaces collapsed (best-effort, still dedups).
  if (source.includes('/') || source.endsWith('.md')) return basename(source);
  return source.trim().toLowerCase();
}

/**
 * Record the sources a recall hook just surfaced. Merges into the session ledger (bounded).
 * Never throws.
 */
export function recordSurfaced(session: string | undefined, sources: string[]): void {
  try {
    if (!session || !Array.isArray(sources) || sources.length === 0) return;
    const led = load(session);
    for (const s of sources) {
      const k = keyOf(String(s));
      if (!k) continue;
      if (!(k in led.surfaced) && Object.keys(led.surfaced).length < MAX_SOURCES) {
        led.surfaced[k] = String(s);
      }
    }
    save(led);
  } catch { /* non-fatal */ }
}

/**
 * On a memory Read, credit a hit if the read path matches a surfaced source not yet credited.
 * Emits recall.hit exactly once per (session, source). Returns true if a hit was credited (for tests).
 * Never throws.
 */
export function creditRead(session: string | undefined, readPath: string): boolean {
  try {
    if (!session || !readPath) return false;
    const k = keyOf(readPath);
    if (!k) return false;
    const led = load(session);
    if (!(k in led.surfaced)) return false;       // wasn't surfaced → not a recall hit
    if (led.credited.includes(k)) return false;    // already credited → dedup
    led.credited.push(k);
    save(led);
    emitMemoryTelemetry('recall.hit', { session_id: session, source: led.surfaced[k], basename: k });
    return true;
  } catch {
    return false;
  }
}
