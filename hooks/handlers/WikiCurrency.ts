/**
 * WikiCurrency.ts — Stop handler: detect substantive code changes in a wiki-bearing
 * project that did NOT touch the project's wiki, and write a pending-nudge flag.
 *
 * The flag is surfaced on the NEXT user prompt by WikiNudge.hook.ts (UserPromptSubmit) —
 * a Stop hook fires AFTER the response, so it can't inject into the turn that just ended.
 * Same two-part pattern as LastResponseCache (Stop) → FormatReminder (UserPromptSubmit).
 *
 * COST: a single `git -C <repo> diff --numstat HEAD` per wiki-bearing project with uncommitted
 * changes (~30ms). If no code changed, or the wiki was also touched → no flag, silent.
 *
 * DESIGN: nudge, never a gate. It writes a flag; the assistant decides to update inline or
 * note why deferred. Meaningful-change threshold avoids false positives on tiny edits.
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
interface WikiProject {
  /** absolute repo path whose code changes we watch */
  repo: string;
  /** human label for the nudge */
  name: string;
  /** path fragments that count as "the wiki was updated" (checked against changed files in BOTH repo + wiki) */
  wikiRepo?: string; // sibling wiki repo (absolute path) — changes there count as wiki-touched
  wikiSubdir?: string; // in-repo wiki subdir fragment (e.g. "wiki/")
}

const HOME = process.env.HOME || '';
const WIKI_PROJECTS: WikiProject[] = [
  { repo: join(HOME, 'Projects/pai-config'), name: 'PAI', wikiRepo: join(HOME, 'Projects/PAI-Wiki') },
  { repo: join(HOME, 'Projects/Du_tracking'), name: 'Du-tracking', wikiSubdir: 'wiki/' },
  // Linksys firmware code lives in many repos; its wiki is ~/Projects/Linksys-Wiki — wire per-repo if needed.
];

/** Code-file extensions whose substantive change implies the wiki may need updating. */
const CODE_RE = /\.(ts|tsx|js|jsx|py|go|rs|sh|c|h|cpp|hpp)$/;
/** Minimum net changed lines (added+removed) across code files to count as "substantive". */
const MEANINGFUL_LINES = 20;

interface ChangedStats {
  codeLines: number;
  codeFiles: string[];
  wikiTouched: boolean;
}

/** Sum numstat for uncommitted changes (working tree + staged) in a repo. Returns null if not a git repo. */
function analyzeRepo(p: WikiProject): ChangedStats | null {
  if (!existsSync(p.repo)) return null;
  let numstat: string;
  try {
    // HEAD diff covers staged + unstaged tracked changes; --numstat gives "added removed path".
    numstat = execFileSync('git', ['-C', p.repo, 'diff', '--numstat', 'HEAD'], {
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
    });
  } catch {
    return null; // not a git repo / git unavailable — skip silently
  }

  let codeLines = 0;
  const codeFiles: string[] = [];
  let wikiTouchedInRepo = false;
  for (const line of numstat.trim().split('\n')) {
    if (!line) continue;
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!m) continue;
    const added = m[1] === '-' ? 0 : parseInt(m[1], 10);
    const removed = m[2] === '-' ? 0 : parseInt(m[2], 10);
    const file = m[3];
    if (p.wikiSubdir && file.includes(p.wikiSubdir)) { wikiTouchedInRepo = true; continue; }
    if (CODE_RE.test(file)) { codeLines += added + removed; codeFiles.push(file); }
  }

  // Also count NEW (untracked) code files — `git diff --numstat HEAD` misses them entirely, yet a
  // brand-new file is the MOST likely change to need a wiki update. Count their line counts as added.
  try {
    const untracked = execFileSync('git', ['-C', p.repo, 'ls-files', '--others', '--exclude-standard'], {
      timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf-8',
    });
    for (const file of untracked.trim().split('\n')) {
      if (!file) continue;
      if (p.wikiSubdir && file.includes(p.wikiSubdir)) { wikiTouchedInRepo = true; continue; }
      if (!CODE_RE.test(file)) continue;
      try {
        const full = join(p.repo, file);
        if (statSync(full).size > 200_000) { codeLines += 50; codeFiles.push(file); continue; } // skip reading huge files
        codeLines += readFileSync(full, 'utf-8').split('\n').length;
        codeFiles.push(file);
      } catch { /* unreadable — skip */ }
    }
  } catch { /* ls-files failed — tracked-only count still applies */ }

  // Sibling wiki repo: any uncommitted change there counts as "wiki touched this session".
  let wikiTouchedInSibling = false;
  if (p.wikiRepo && existsSync(p.wikiRepo)) {
    try {
      const w = execFileSync('git', ['-C', p.wikiRepo, 'status', '--porcelain'], {
        timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf-8',
      });
      wikiTouchedInSibling = w.trim().length > 0;
    } catch { /* ignore */ }
  }

  return { codeLines, codeFiles, wikiTouched: wikiTouchedInRepo || wikiTouchedInSibling };
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
