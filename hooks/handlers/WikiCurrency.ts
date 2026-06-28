/**
 * WikiCurrency.ts — Stop handler: detect substantive code changes in a wiki-bearing
 * project that did NOT touch the project's wiki, and write a pending-nudge flag.
 *
 * The flag is surfaced on the NEXT user prompt by WikiNudge.hook.ts (UserPromptSubmit) —
 * a Stop hook fires AFTER the response, so it can't inject into the turn that just ended.
 * Same two-part pattern as LastResponseCache (Stop) → FormatReminder (UserPromptSubmit).
 *
 * COST: a couple of `git -C <repo> diff --numstat` calls per wiki-bearing project (~30-60ms). If no
 * code changed, or the wiki was also touched → no flag, silent.
 *
 * DESIGN: nudge, never a gate. It writes a flag; the assistant decides to update inline or
 * note why deferred. Meaningful-change threshold avoids false positives on tiny edits.
 *
 * COVERS BOTH UNCOMMITTED AND COMMITTED-UNPUSHED WORK (hardening 2026-06-21): the original only
 * diffed `HEAD` (uncommitted), so incrementally-committed work slipped past every Stop boundary with a
 * clean tree — the blind spot that missed an entire memory-track build. Now it unions uncommitted
 * (HEAD + untracked) with committed-unpushed (`@{u}..HEAD`), and treats a wiki update in EITHER state
 * as "wiki touched". Falls back to uncommitted-only when there is no upstream.
 */
import { existsSync, writeFileSync, mkdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { getPaiDir } from '../lib/paths';

const NUDGE_PATH = join(getPaiDir(), 'MEMORY', 'STATE', 'pending-wiki-nudge.json');

/**
 * Wiki-bearing projects: repo path → its wiki location (relative dir prefix or sibling repo path).
 * A change to code under `repo` should be reflected in `wiki`. Add projects here as they gain wikis.
 * `wikiPaths` are path fragments that, if present in the changed-file list, count as "wiki touched".
 */
export interface WikiProject {
  /** absolute repo path whose code changes we watch */
  repo: string;
  /** human label for the nudge */
  name: string;
  /** path fragments that count as "the wiki was updated" (checked against changed files in BOTH repo + wiki) */
  wikiRepo?: string; // sibling wiki repo (absolute path) — changes there count as wiki-touched
  wikiSubdir?: string; // in-repo wiki subdir fragment (e.g. "wiki/")
}

const HOME = process.env.HOME || '';
const PAI_REPO = process.env.PAI_REPO_DIR || getPaiDir();
const WIKI_PROJECTS: WikiProject[] = [
  { repo: PAI_REPO, name: 'PAI', wikiRepo: join(HOME, 'Projects/PAI-Wiki') },
  { repo: join(HOME, 'Projects/Du_tracking'), name: 'Du-tracking', wikiSubdir: 'wiki/' },
  // YourCompany firmware code lives in many repos; its wiki is ~/Projects/YourCompany-Wiki — wire per-repo if needed.
];

/** Code-file extensions whose substantive change implies the wiki may need updating. */
const CODE_RE = /\.(ts|tsx|js|jsx|py|go|rs|sh|c|h|cpp|hpp)$/;
/** Minimum net changed lines (added+removed) across code files to count as "substantive". */
export const MEANINGFUL_LINES = 20;

interface ChangedStats {
  codeLines: number;
  codeFiles: string[];
  wikiTouched: boolean;
}

/** Run a git command in a repo, returning stdout, or null on any failure (not-a-repo, no-upstream, etc). */
function git(repo: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', repo, ...args], {
      timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf-8',
    });
  } catch {
    return null;
  }
}

/** Does this repo have a configured upstream? (controls whether the committed-unpushed range exists.) */
function hasUpstream(repo: string): boolean {
  return git(repo, ['rev-parse', '--abbrev-ref', '@{u}']) !== null;
}

/**
 * Parse a `git diff --numstat <range>` output into code-line count + code files + wiki-touched flag.
 * Mutates the passed accumulators. `range` is e.g. 'HEAD' (uncommitted) or '@{u}..HEAD' (committed-unpushed).
 */
function accumulateNumstat(
  numstat: string | null,
  p: WikiProject,
  codeFiles: Set<string>,
  acc: { codeLines: number; wikiTouched: boolean },
): void {
  if (!numstat) return;
  for (const line of numstat.trim().split('\n')) {
    if (!line) continue;
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!m) continue;
    const added = m[1] === '-' ? 0 : parseInt(m[1], 10);
    const removed = m[2] === '-' ? 0 : parseInt(m[2], 10);
    const file = m[3];
    if (p.wikiSubdir && file.includes(p.wikiSubdir)) { acc.wikiTouched = true; continue; }
    if (CODE_RE.test(file) && !codeFiles.has(file)) {   // dedup by path across ranges
      acc.codeLines += added + removed;
      codeFiles.add(file);
    }
  }
}

/**
 * Sum code changes in a repo across BOTH uncommitted (HEAD + untracked) AND committed-unpushed
 * (@{u}..HEAD) work — the hardening fix. Returns null if not a git repo.
 */
export function analyzeRepo(p: WikiProject): ChangedStats | null {
  if (!existsSync(p.repo)) return null;
  // Probe: is this even a git repo? (a HEAD diff that returns null AND no upstream AND no untracked
  // means git is unavailable here.)
  const uncommitted = git(p.repo, ['diff', '--numstat', 'HEAD']);
  const untrackedList = git(p.repo, ['ls-files', '--others', '--exclude-standard']);
  if (uncommitted === null && untrackedList === null) return null; // not a git repo / git missing

  const codeFiles = new Set<string>();
  const acc = { codeLines: 0, wikiTouched: false };

  // 1. Uncommitted tracked changes (HEAD).
  accumulateNumstat(uncommitted, p, codeFiles, acc);

  // 2. Committed-but-unpushed changes (@{u}..HEAD) — THE FIX for incrementally-committed work.
  if (hasUpstream(p.repo)) {
    accumulateNumstat(git(p.repo, ['diff', '--numstat', '@{u}..HEAD']), p, codeFiles, acc);
  }

  // 3. New (untracked) code files — diff --numstat misses them; a brand-new file most likely needs a wiki.
  if (untrackedList) {
    for (const file of untrackedList.trim().split('\n')) {
      if (!file) continue;
      if (p.wikiSubdir && file.includes(p.wikiSubdir)) { acc.wikiTouched = true; continue; }
      if (!CODE_RE.test(file) || codeFiles.has(file)) continue;
      try {
        const full = join(p.repo, file);
        if (statSync(full).size > 200_000) { acc.codeLines += 50; codeFiles.add(file); continue; }
        acc.codeLines += readFileSync(full, 'utf-8').split('\n').length;
        codeFiles.add(file);
      } catch { /* unreadable — skip */ }
    }
  }

  // Sibling wiki repo: a wiki update in EITHER uncommitted (porcelain) OR committed-unpushed state
  // counts as "wiki touched this session" (symmetric with the code-side fix).
  if (p.wikiRepo && existsSync(p.wikiRepo)) {
    const porcelain = git(p.wikiRepo, ['status', '--porcelain']);
    if (porcelain && porcelain.trim().length > 0) acc.wikiTouched = true;
    if (!acc.wikiTouched && hasUpstream(p.wikiRepo)) {
      const committedWiki = git(p.wikiRepo, ['diff', '--numstat', '@{u}..HEAD']);
      if (committedWiki && committedWiki.trim().length > 0) acc.wikiTouched = true;
    }
  }

  return { codeLines: acc.codeLines, codeFiles: [...codeFiles], wikiTouched: acc.wikiTouched };
}

export async function handleWikiCurrency(_parsed: unknown, sessionId: string): Promise<void> {
  const pending: Array<{ name: string; codeLines: number; sampleFiles: string[] }> = [];

  for (const p of WIKI_PROJECTS) {
    const stats = analyzeRepo(p);
    if (!stats) continue;
    // Fire only when: substantive code changed AND the wiki was NOT touched.
    if (stats.codeLines >= MEANINGFUL_LINES && !stats.wikiTouched) {
      pending.push({ name: p.name, codeLines: stats.codeLines, sampleFiles: stats.codeFiles.slice(0, 5) });
    }
  }

  if (pending.length === 0) {
    // Nothing to nudge — clear any stale flag so we don't surface an outdated one.
    try { if (existsSync(NUDGE_PATH)) writeFileSync(NUDGE_PATH, JSON.stringify({ pending: [], sessionId }, null, 2)); } catch { /* non-fatal */ }
    return;
  }

  try {
    mkdirSync(join(getPaiDir(), 'MEMORY', 'STATE'), { recursive: true });
    writeFileSync(NUDGE_PATH, JSON.stringify({ pending, sessionId }, null, 2));
    console.error(`[WikiCurrency] Flagged ${pending.length} project(s) with un-wikied code changes: ${pending.map(p => p.name).join(', ')}`);
  } catch (err) {
    console.error(`[WikiCurrency] Failed to write nudge flag (non-fatal): ${err}`);
  }
}
