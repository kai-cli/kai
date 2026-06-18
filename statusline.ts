#!/usr/bin/env bun
/**
 * statusline.ts — PAI Status Line
 *
 * Responsive status line with 4 display modes based on terminal width:
 *   nano   (<35 cols): Minimal
 *   micro  (35-54):    Compact
 *   mini   (55-79):    Balanced
 *   normal (80+):      Full
 *
 * Context percentage scales to compaction threshold if configured in settings.json.
 * Target runtime: <50ms steady state (vs 150-250ms shell version).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { spawnSync } from 'child_process';
import { parseGitState } from './hooks/lib/git-state';

// ─── Paths ────────────────────────────────────────────────────────────────────

const PAI_DIR = process.env.PAI_DIR ?? join(process.env.HOME!, '.claude');
const SETTINGS_FILE = join(PAI_DIR, 'settings.json');
const USAGE_CACHE = join(PAI_DIR, 'MEMORY', 'STATE', 'usage-cache.json');
const MODEL_CACHE = join(PAI_DIR, 'MEMORY', 'STATE', 'model-cache.txt');
const SESSION_NAMES_FILE = join(PAI_DIR, 'MEMORY', 'STATE', 'session-names.json');
const WORK_JSON = join(PAI_DIR, 'MEMORY', 'STATE', 'work.json');
const WIDTH_CACHE = '/tmp/pai-term-width-default';
const USAGE_CACHE_TTL = 300; // 5 minutes

// ─── ANSI Colors ─────────────────────────────────────────────────────────────

const R = '\x1b[0m';

// Structural
const SLATE_300 = '\x1b[38;2;203;213;225m';
const SLATE_400 = '\x1b[38;2;148;163;184m';
const SLATE_500 = '\x1b[38;2;100;116;139m';
const SLATE_600 = '\x1b[38;2;71;85;105m';
const EMERALD   = '\x1b[38;2;74;222;128m';
const ROSE      = '\x1b[38;2;251;113;133m';

// Context bar
const CTX_PRIMARY   = '\x1b[38;2;129;140;248m';
const CTX_SECONDARY = '\x1b[38;2;165;180;252m';
const CTX_ACCENT    = '\x1b[38;2;139;92;246m';
const CTX_EMPTY     = '\x1b[38;2;75;82;95m';

// Git
const GIT_PRIMARY   = '\x1b[38;2;56;189;248m';
const GIT_VALUE     = '\x1b[38;2;186;230;253m';
const GIT_DIR       = '\x1b[38;2;147;197;253m';
const GIT_CLEAN     = '\x1b[38;2;125;211;252m';
const GIT_STASH     = '\x1b[38;2;165;180;252m';
const GIT_AGE_FRESH  = '\x1b[38;2;125;211;252m';
const GIT_AGE_RECENT = '\x1b[38;2;96;165;250m';
const GIT_AGE_STALE  = '\x1b[38;2;59;130;246m';
const GIT_AGE_OLD    = '\x1b[38;2;99;102;241m';

// Usage
const USAGE_PRIMARY = '\x1b[38;2;251;191;36m';
const USAGE_LABEL   = '\x1b[38;2;217;163;29m';
const USAGE_VALUE   = '\x1b[38;2;253;224;71m';
const USAGE_RESET_C = '\x1b[38;2;148;163;184m';
const USAGE_EXTRA   = '\x1b[38;2;140;90;60m';

// PAI branding
const PAI_P      = '\x1b[38;2;30;58;138m';
const PAI_A      = '\x1b[38;2;59;130;246m';
const PAI_I      = '\x1b[38;2;147;197;253m';
const WIELD_ACCENT = '\x1b[38;2;103;232;249m';

// Task line
const TASK_PRIMARY = '\x1b[38;2;192;132;252m';
const TASK_PHASE   = '\x1b[38;2;167;139;250m';
const TASK_PROG    = '\x1b[38;2;74;222;128m';

const SEP = `${SLATE_600}────────────────────────────────────────────────────────────────────────${R}`;

// ─── Input Parsing ────────────────────────────────────────────────────────────

interface StatusInput {
  session_id?: string;
  workspace?: { current_dir?: string };
  cwd?: string;
  model?: { display_name?: string };
  version?: string;
  cost?: { total_duration_ms?: number };
  context_window?: {
    context_window_size?: number;
    used_percentage?: number;
    remaining_percentage?: number;
    total_input_tokens?: number;
    total_output_tokens?: number;
  };
}

let raw = '';
try {
  raw = readFileSync('/dev/stdin', 'utf-8');
} catch { /* no stdin */ }

let input: StatusInput = {};
try { input = JSON.parse(raw); } catch { /* malformed — use defaults */ }

const sessionId    = input.session_id ?? '';
const currentDir   = input.workspace?.current_dir ?? input.cwd ?? '.';
const modelName    = input.model?.display_name ?? 'unknown';
const ccVersion    = input.version ?? '';
const durationMs   = input.cost?.total_duration_ms ?? 0;
const contextMax   = input.context_window?.context_window_size ?? 200000;
const contextPct   = input.context_window?.used_percentage ?? 0;
const totalInput   = input.context_window?.total_input_tokens ?? 0;
const totalOutput  = input.context_window?.total_output_tokens ?? 0;
const dirName      = basename(currentDir) || '.';

// ─── Settings ─────────────────────────────────────────────────────────────────

interface Settings {
  daidentity?: { name?: string; displayName?: string };
  principal?: { timezone?: string };
  pai?: { version?: string; algorithmVersion?: string };
  contextDisplay?: { compactionThreshold?: number };
  counts?: Record<string, number>;
  preferences?: { temperatureUnit?: string };
}

let settings: Settings = {};
try { settings = JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8')); } catch { /* defaults */ }

const daName       = settings.daidentity?.name ?? settings.daidentity?.displayName ?? 'Assistant';
const userTz       = settings.principal?.timezone ?? 'UTC';
const paiVersion   = settings.pai?.version ?? '—';
const algoVersion  = settings.pai?.algorithmVersion ?? '—';
const compactionThreshold = settings.contextDisplay?.compactionThreshold ?? 100;
const counts       = settings.counts ?? {};

// Cache model name for other tools
try {
  mkdirSync(join(PAI_DIR, 'MEMORY', 'STATE'), { recursive: true });
  writeFileSync(MODEL_CACHE, modelName);
} catch { /* non-fatal */ }

// ─── Terminal Width ───────────────────────────────────────────────────────────

function detectTerminalWidth(): number {
  // Tier 1: process.stdout.columns (works when TTY is inherited)
  if (process.stdout.columns && process.stdout.columns > 0) {
    try { writeFileSync(WIDTH_CACHE, String(process.stdout.columns)); } catch { /* ok */ }
    return process.stdout.columns;
  }

  // Tier 2: stty size
  try {
    const r = spawnSync('stty', ['size'], { stdio: ['inherit', 'pipe', 'pipe'] });
    const cols = parseInt(r.stdout?.toString().trim().split(' ')[1] ?? '0');
    if (cols > 0) {
      try { writeFileSync(WIDTH_CACHE, String(cols)); } catch { /* ok */ }
      return cols;
    }
  } catch { /* ok */ }

  // Tier 3: cached width
  try {
    const cached = parseInt(readFileSync(WIDTH_CACHE, 'utf-8').trim());
    if (cached > 0) return cached;
  } catch { /* ok */ }

  // Tier 4: COLUMNS env or default
  return parseInt(process.env.COLUMNS ?? '80') || 80;
}

const termWidth = detectTerminalWidth();
type Mode = 'nano' | 'micro' | 'mini' | 'normal';
const mode: Mode = termWidth < 35 ? 'nano' : termWidth < 55 ? 'micro' : termWidth < 80 ? 'mini' : 'normal';

// ─── Session Name ──────────────────────────────────────────────────────────────

function getSessionLabel(): string {
  if (!sessionId) return '';

  // Check Claude Code's sessions-index for customTitle (/rename)
  try {
    const slug = currentDir.replace(/[/.]/g, '-');
    const sessionsIndex = join(PAI_DIR, 'projects', slug, 'sessions-index.json');
    if (existsSync(sessionsIndex)) {
      const idx = readFileSync(sessionsIndex, 'utf-8');
      const match = idx.match(new RegExp(`"sessionId"\\s*:\\s*"${sessionId}"[^}]*?"customTitle"\\s*:\\s*"([^"]+)"`));
      if (match) return match[1];
    }
  } catch { /* ok */ }

  // Fallback: session-names.json (auto-generated by SessionAutoName)
  try {
    const names = JSON.parse(readFileSync(SESSION_NAMES_FILE, 'utf-8'));
    return names[sessionId] ?? '';
  } catch { /* ok */ }

  return '';
}

const sessionLabel = getSessionLabel().toUpperCase();

// ─── Cost Calculation ─────────────────────────────────────────────────────────

function formatCost(): string {
  if (totalInput === 0 && totalOutput === 0) return '';
  let inRate = 3.00, outRate = 15.00;
  if (/opus.?4|opus-4/i.test(modelName))        { inRate = 15.00; outRate = 75.00; }
  else if (/sonnet.?4/i.test(modelName))         { inRate = 3.00;  outRate = 15.00; }
  else if (/haiku.?4|haiku-4/i.test(modelName))  { inRate = 0.80;  outRate = 4.00;  }
  const cost = (totalInput * inRate + totalOutput * outRate) / 1_000_000;
  if (cost < 0.01)  return `~$${cost.toFixed(4)}`;
  if (cost < 1.00)  return `~$${cost.toFixed(3)}`;
  return `~$${cost.toFixed(2)}`;
}

const sessionCostStr = formatCost();

// ─── Duration ─────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s >= 3600) return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
  if (s >= 60)   return `${Math.floor(s / 60)}m${s % 60}s`;
  return `${s}s`;
}

const timeDisplay = formatDuration(durationMs);

// ─── Context Bar ──────────────────────────────────────────────────────────────

function bucketColor(pos: number, max: number): string {
  const pct = (pos * 100) / max;
  let r: number, g: number, b: number;
  if (pct <= 33) {
    r = Math.round(74  + (250 - 74)  * pct / 33);
    g = Math.round(222 + (204 - 222) * pct / 33);
    b = Math.round(128 + (21  - 128) * pct / 33);
  } else if (pct <= 66) {
    const t = pct - 33;
    r = Math.round(250 + (251 - 250) * t / 33);
    g = Math.round(204 + (146 - 204) * t / 33);
    b = Math.round(21  + (60  - 21)  * t / 33);
  } else {
    const t = pct - 66;
    r = Math.round(251 + (239 - 251) * t / 34);
    g = Math.round(146 + (68  - 146) * t / 34);
    b = Math.round(60  + (68  - 60)  * t / 34);
  }
  return `\x1b[38;2;${r};${g};${b}m`;
}

function renderBar(width: number, pct: number): string {
  const filled = Math.max(0, Math.floor(pct * width / 100));
  let out = '';
  for (let i = 1; i <= width; i++) {
    out += i <= filled ? `${bucketColor(i, width)}⛁${R}` : `${CTX_EMPTY}⛁${R}`;
  }
  return out;
}

function calcBarWidth(m: Mode): number {
  const configs: Record<Mode, { prefix: number; suffix: number; bucket: number; min: number }> = {
    nano:   { prefix: 2,  suffix: 5,  bucket: 2, min: 5  },
    micro:  { prefix: 2,  suffix: 5,  bucket: 2, min: 6  },
    mini:   { prefix: 12, suffix: 5,  bucket: 2, min: 8  },
    normal: { prefix: 12, suffix: 30, bucket: 1, min: 16 },
  };
  const { prefix, suffix, bucket, min } = configs[m];
  return Math.max(min, Math.floor((72 - prefix - suffix) / bucket));
}

const rawPct = Math.floor(contextPct);
const displayPct = compactionThreshold < 100 && compactionThreshold > 0
  ? Math.min(100, Math.floor(rawPct * 100 / compactionThreshold))
  : rawPct;

const pctColor = displayPct >= 80 ? ROSE
  : displayPct >= 60 ? '\x1b[38;2;251;146;60m'
  : displayPct >= 40 ? '\x1b[38;2;251;191;36m'
  : EMERALD;

const maxK = Math.floor(contextMax / 1000);
const usedK = Math.floor(rawPct * contextMax / 100 / 1000);
const ctxTokenDisplay = `${usedK}k/${maxK}k`;
const barWidth = calcBarWidth(mode);
const bar = renderBar(barWidth, displayPct);

// ─── Usage Cache ──────────────────────────────────────────────────────────────

interface UsageCache {
  five_hour?:      { utilization?: number; resets_at?: string };
  seven_day?:      { utilization?: number; resets_at?: string };
  extra_usage?:    { is_enabled?: boolean; monthly_limit?: number; used_credits?: number };
  workspace_cost?: { month_used_cents?: number };
}

let usageData: UsageCache = {};
let hasUsageCache = false;
try {
  usageData = JSON.parse(readFileSync(USAGE_CACHE, 'utf-8'));
  hasUsageCache = true;
} catch { /* no cache yet */ }

const usage5h    = usageData.five_hour?.utilization ?? 0;
const usage7d    = usageData.seven_day?.utilization ?? 0;
const reset5hTs  = usageData.five_hour?.resets_at ?? '';
const reset7dTs  = usageData.seven_day?.resets_at ?? '';
const extraEnabled = usageData.extra_usage?.is_enabled ?? false;
const extraLimit = usageData.extra_usage?.monthly_limit ?? 0;
const extraUsed  = usageData.extra_usage?.used_credits ?? 0;
const wsCostCents = usageData.workspace_cost?.month_used_cents ?? 0;

function usageColor(pct: number): string {
  if (pct >= 80) return ROSE;
  if (pct >= 60) return '\x1b[38;2;251;146;60m';
  if (pct >= 40) return '\x1b[38;2;251;191;36m';
  return EMERALD;
}

function isoToEpoch(ts: string): number {
  if (!ts) return 0;
  try { return Math.floor(new Date(ts).getTime() / 1000); } catch { return 0; }
}

function epochToCountdown(epoch: number): string {
  if (epoch === 0) return '—';
  const diff = epoch - Math.floor(Date.now() / 1000);
  if (diff <= 0) return 'now';
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (h >= 24) {
    const d = Math.floor(h / 24), rh = h % 24;
    return rh > 0 ? `${d}d${rh}h` : `${d}d`;
  }
  return h > 0 ? `${h}h${m}m` : `${m}m`;
}

function epochToClock(epoch: number, fmt: 'hourly' | 'weekly'): string {
  if (epoch === 0) return '';
  try {
    const d = new Date(epoch * 1000);
    const opts: Intl.DateTimeFormatOptions = fmt === 'weekly'
      ? { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: userTz }
      : { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: userTz };
    return new Intl.DateTimeFormat('en-US', opts).format(d).replace(',', '');
  } catch { return ''; }
}

const epoch5h   = isoToEpoch(reset5hTs);
const epoch7d   = isoToEpoch(reset7dTs);
const clock5h   = epochToClock(epoch5h, 'hourly')  || epochToCountdown(epoch5h);
const clock7d   = epochToClock(epoch7d, 'weekly')  || epochToCountdown(epoch7d);
const wsDisplay = `Org:$${Math.floor(wsCostCents / 100)}`;

let extraDisplay = '';
if (extraEnabled) {
  const limitDollars = Math.floor(extraLimit / 100);
  const usedDollars  = Math.floor(extraUsed  / 100);
  const limitFmt     = limitDollars >= 1000 ? `$${Math.floor(limitDollars / 1000)}K` : `$${limitDollars}`;
  extraDisplay = `E:$${usedDollars}/${limitFmt}`;
}

// ─── Background Usage Refresh ────────────────────────────────────────────────

function refreshUsageInBackground(): void {
  try {
    const now = Math.floor(Date.now() / 1000);
    let cacheAge = 999999;
    try {
      const stat = Bun.file(USAGE_CACHE).size; // just to check exists
      if (stat >= 0) {
        const mtime = Math.floor((Bun.file(USAGE_CACHE) as any).lastModified / 1000 || 0);
        cacheAge = now - mtime;
      }
    } catch { /* cache doesn't exist */ }

    if (cacheAge <= USAGE_CACHE_TTL) return;

    // Fire-and-forget subprocess — does not block main render
    Bun.spawn(['bun', '-e', `
      const { join } = require('path');
      const PAI_DIR = '${PAI_DIR}';
      const USAGE_CACHE = '${USAGE_CACHE}';
      async function run() {
        try {
          let token = '';
          const { execSync } = require('child_process');
          const cred = execSync('security find-generic-password -s "Claude Code-credentials" -w', { stdio: ['pipe','pipe','pipe'] }).toString().trim();
          const parsed = JSON.parse(cred);
          token = parsed?.claudeAiOauth?.accessToken ?? '';
          if (!token) return;
          const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'anthropic-beta': 'oauth-2025-04-20' }
          });
          const data = await res.json();
          if (data?.five_hour) {
            const { writeFileSync, existsSync, readFileSync } = require('fs');
            let merged = data;
            if (existsSync(USAGE_CACHE)) {
              try { const prev = JSON.parse(readFileSync(USAGE_CACHE,'utf-8')); if (prev.workspace_cost) merged.workspace_cost = prev.workspace_cost; } catch {}
            }
            writeFileSync(USAGE_CACHE, JSON.stringify(merged, null, 2));
          }
        } catch {}
      }
      run();
    `], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
  } catch { /* non-fatal */ }
}

refreshUsageInBackground();

// ─── Git ──────────────────────────────────────────────────────────────────────

interface GitInfo {
  isRepo: boolean;
  branch: string;
  ahead: number;
  behind: number;
  stashCount: number;
  lastCommitEpoch: number;
}

function getGitInfo(): GitInfo {
  const defaults: GitInfo = { isRepo: false, branch: '', ahead: 0, behind: 0, stashCount: 0, lastCommitEpoch: 0 };
  try {
    const checkRepo = spawnSync('git', ['rev-parse', '--git-dir'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (checkRepo.status !== 0) return defaults;

    const status = spawnSync('git', ['status', '--porcelain=v2', '--branch'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    const stash  = spawnSync('git', ['stash', 'list'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    const log    = spawnSync('git', ['log', '-1', '--format=%ct'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });

    const lines = (status.stdout ?? '').split('\n');
    let branch = 'detached';
    let ahead = 0, behind = 0;

    for (const line of lines) {
      if (line.startsWith('# branch.head ')) branch = line.slice(14).trim();
      if (line.startsWith('# branch.ab ')) {
        const m = line.match(/\+(\d+) -(\d+)/);
        if (m) { ahead = parseInt(m[1]); behind = parseInt(m[2]); }
      }
    }

    const stashCount = (stash.stdout ?? '').trim().split('\n').filter(Boolean).length;
    const lastCommitEpoch = parseInt((log.stdout ?? '').trim()) || 0;

    return { isRepo: true, branch, ahead, behind, stashCount, lastCommitEpoch };
  } catch { return defaults; }
}

const git = getGitInfo();

function ageDisplay(epoch: number): { text: string; color: string } {
  if (!epoch) return { text: '', color: '' };
  const ageSeconds = Math.floor(Date.now() / 1000) - epoch;
  const mins  = Math.floor(ageSeconds / 60);
  const hours = Math.floor(ageSeconds / 3600);
  const days  = Math.floor(ageSeconds / 86400);
  if (mins < 1)   return { text: 'now', color: GIT_AGE_FRESH };
  if (hours < 1)  return { text: `${mins}m`, color: GIT_AGE_FRESH };
  if (hours < 24) return { text: `${hours}h`, color: GIT_AGE_RECENT };
  if (days < 7)   return { text: `${days}d`, color: GIT_AGE_STALE };
  return { text: `${days}d`, color: GIT_AGE_OLD };
}

const age = ageDisplay(git.lastCommitEpoch);

// ─── Active Algorithm Task ────────────────────────────────────────────────────

interface ActiveTask { task: string; phase: string; progress: string }

function getActiveTask(): ActiveTask | null {
  if (!sessionId || !existsSync(WORK_JSON)) return null;
  try {
    const work = JSON.parse(readFileSync(WORK_JSON, 'utf-8'));
    const sessions: Record<string, any> = work.sessions ?? {};
    const entry = Object.values(sessions).find((s: any) =>
      s.sessionUUID === sessionId &&
      s.phase != null &&
      s.phase !== 'native' &&
      s.phase !== 'complete'
    ) as any;
    if (!entry) return null;
    return { task: entry.task ?? '', phase: entry.phase ?? '', progress: entry.progress ?? '' };
  } catch { return null; }
}

const activeTask = getActiveTask();

// ─── Output ───────────────────────────────────────────────────────────────────

const out: string[] = [];
const p = (s: string) => out.push(s);

// Line 0: PAI branding
if (mode === 'nano') {
  p(`${SLATE_600}── │${R} ${PAI_P}P${PAI_A}A${PAI_I}I${R} ${SLATE_600}│ ────────────${R}`);
  p(`${SLATE_400}ENV:${R} ${SLATE_500}${PAI_A}${paiVersion}${R} ${WIELD_ACCENT}${modelName}${R}`);
} else {
  p(`${SLATE_600}─────────────────────────────────${R} ${PAI_P}P${PAI_A}A${PAI_I}I${R} ${SLATE_600}──────────────────────────────────${R}`);
  if (mode === 'micro') {
    p(`${SLATE_400}ENV:${R} ${SLATE_400}claude${R} ${PAI_A}${ccVersion}${R} ${SLATE_600}│${R} ${SLATE_500}PAI:${PAI_A}${paiVersion}${R} ${SLATE_600}│${R} ${WIELD_ACCENT}${modelName}${R}`);
  } else if (mode === 'mini') {
    p(`${SLATE_400}ENV:${R} ${SLATE_400}claude${R} ${PAI_A}${ccVersion}${R} ${SLATE_600}│${R} ${SLATE_500}PAI:${PAI_A}${paiVersion}${R} ${SLATE_400}ALG:${PAI_A}${algoVersion}${R} ${SLATE_600}│${R} ${WIELD_ACCENT}${modelName}${R}`);
  } else {
    p(`${SLATE_400}ENV:${R} ${SLATE_400}claude${R} ${PAI_A}${ccVersion}${R} ${SLATE_600}│${R} ${SLATE_500}PAI:${PAI_A}${paiVersion}${R} ${SLATE_400}ALG:${PAI_A}${algoVersion}${R} ${SLATE_600}│${R} ${WIELD_ACCENT}Model:${R} ${SLATE_300}${modelName}${R}`);
  }
}
p(SEP);

// Line 1: Context bar
if (mode === 'normal') {
  let ctxLine = `${CTX_PRIMARY}◉${R} ${CTX_SECONDARY}CONTEXT:${R} ${bar} ${pctColor}${ctxTokenDisplay}${R} ${SLATE_600}│${R} ${CTX_ACCENT}⏱${R} ${SLATE_300}${timeDisplay}${R}`;
  if (sessionCostStr) ctxLine += ` ${SLATE_600}│${R} ${USAGE_VALUE}${sessionCostStr}${R}`;
  p(ctxLine);
} else if (mode === 'mini') {
  p(`${CTX_PRIMARY}◉${R} ${CTX_SECONDARY}CONTEXT:${R} ${bar} ${pctColor}${ctxTokenDisplay}${R} ${CTX_ACCENT}⏱${R} ${SLATE_300}${timeDisplay}${R}`);
} else {
  p(`${CTX_PRIMARY}◉${R} ${bar} ${pctColor}${ctxTokenDisplay}${R} ${CTX_ACCENT}⏱${R} ${SLATE_300}${timeDisplay}${R}`);
}
p(SEP);

// Line 2: Usage (only if cache exists)
if (hasUsageCache || usage5h > 0 || usage7d > 0) {
  const c5 = usageColor(usage5h);
  const c7 = usageColor(usage7d);

  if (mode === 'nano') {
    let l = `${USAGE_PRIMARY}▰${R} ${c5}${usage5h}%${R}${USAGE_RESET_C}↻${clock5h}${R} ${c7}${usage7d}%${R}${USAGE_RESET_C}/wk${R}`;
    if (sessionCostStr) l += ` ${USAGE_VALUE}${sessionCostStr}${R}`;
    p(l);
  } else if (mode === 'micro') {
    let l = `${USAGE_PRIMARY}▰${R} ${USAGE_RESET_C}5H:${R} ${c5}${usage5h}%${R} ${USAGE_RESET_C}↻${clock5h}${R} ${SLATE_600}│${R} ${USAGE_RESET_C}WK:${R} ${c7}${usage7d}%${R} ${USAGE_RESET_C}↻${clock7d}${R}`;
    if (sessionCostStr) l += ` ${SLATE_600}│${R} ${USAGE_EXTRA}Sess:${sessionCostStr}${R}`;
    p(l);
  } else {
    let l = `${USAGE_PRIMARY}▰${R} ${USAGE_LABEL}USE:${R} ${USAGE_RESET_C}5H:${R} ${c5}${usage5h}%${R} ${USAGE_RESET_C}↻${SLATE_500}${clock5h}${R} ${SLATE_600}│${R} ${USAGE_RESET_C}WK:${R} ${c7}${usage7d}%${R} ${USAGE_RESET_C}↻${SLATE_500}${clock7d}${R}`;
    if (extraDisplay) l += ` ${SLATE_600}│${R} ${USAGE_EXTRA}${extraDisplay}${R}`;
    l += ` ${SLATE_600}│${R} ${USAGE_EXTRA}${wsDisplay}${R}`;
    if (sessionCostStr) l += ` ${SLATE_600}│${R} ${USAGE_EXTRA}Sess:${sessionCostStr}${R}`;
    p(l);
  }
  p(SEP);
}

// Line 3: PWD + Git
if (mode === 'nano') {
  let l = `${GIT_PRIMARY}◈${R} ${GIT_DIR}${dirName}${R}`;
  if (git.isRepo) l += ` ${GIT_VALUE}${git.branch}${R}`;
  p(l);
} else if (mode === 'micro') {
  let l = `${GIT_PRIMARY}◈${R} ${GIT_DIR}${dirName}${R}`;
  if (git.isRepo) {
    l += ` ${GIT_VALUE}${git.branch}${R}`;
    if (age.text) l += ` ${age.color}${age.text}${R}`;
  }
  p(l);
} else if (mode === 'mini') {
  let l = `${GIT_PRIMARY}◈${R} ${GIT_DIR}${dirName}${R}`;
  if (git.isRepo) {
    l += ` ${SLATE_600}│${R} ${GIT_VALUE}${git.branch}${R}`;
    if (age.text) l += ` ${SLATE_600}│${R} ${age.color}${age.text}${R}`;
  }
  p(l);
} else {
  let l = `${GIT_PRIMARY}◈${R} ${GIT_PRIMARY}PWD:${R} ${GIT_DIR}${dirName}${R}`;
  if (git.isRepo) {
    l += ` ${SLATE_600}│${R} ${GIT_PRIMARY}Branch:${R} ${GIT_VALUE}${git.branch}${R}`;
    if (age.text) l += ` ${SLATE_600}│${R} ${GIT_PRIMARY}Age:${R} ${age.color}${age.text}${R}`;
    if (git.stashCount > 0) l += ` ${SLATE_600}│${R} ${GIT_PRIMARY}Stash:${R} ${GIT_STASH}${git.stashCount}${R}`;
    if (git.ahead > 0 || git.behind > 0) {
      l += ` ${SLATE_600}│${R} ${GIT_PRIMARY}Sync:${R} `;
      if (git.ahead  > 0) l += `${GIT_CLEAN}↑${git.ahead}${R}`;
      if (git.behind > 0) l += `${GIT_STASH}↓${git.behind}${R}`;
    }
  }
  p(l);
}
p(SEP);

// Line 4: Pending actions (curations, stale memories)
const ALERT_COLOR = '\x1b[38;2;251;191;36m';
const ALERT_DIM   = '\x1b[38;2;180;140;30m';
const ACTIONS_JSON = join(PAI_DIR, 'MEMORY', 'STATE', 'actions.json');

interface ActionItem {
  type: 'draft' | 'stale_prd' | 'maintenance' | 'persona_review' | 'git_unpushed' | 'git_dirty' | 'gh_reviews' | 'wiki_stale';
  summary: string;
  action: string;
  file?: string;
  project?: string;
  age_days?: number;
  phase?: string;
  slug?: string;
}

const GH_REVIEWS_CACHE = join(PAI_DIR, 'MEMORY', 'STATE', '.gh-reviews-cache.json');
const WIKI_STALE_CACHE = join(PAI_DIR, 'MEMORY', 'STATE', '.wiki-stale-cache.json');
const GH_CACHE_TTL = 1800_000; // 30 minutes
const WIKI_CACHE_TTL = 86_400_000; // 24 hours

// Persona-review reminder: fire X days after the review window opened (time-based, per YourName 2026-06-15),
// surfacing accrued skill-usage count as context so it's clear whether enough signal exists.
const PERSONA_REVIEW_DAYS = 21;
const PERSONA_STATE = join(PAI_DIR, 'MEMORY', 'STATE', '.persona-review.json');
const SKILL_USAGE_LOG = join(PAI_DIR, 'MEMORY', 'STATE', 'skill-usage.jsonl');

/** Count lines in skill-usage.jsonl (cheap usage signal). 0 if absent/unreadable. */
function skillUsageCount(): number {
  try {
    return readFileSync(SKILL_USAGE_LOG, 'utf-8').split('\n').filter(l => l.trim()).length;
  } catch { return 0; }
}

/**
 * Returns a persona-review ActionItem when the window is >= PERSONA_REVIEW_DAYS old, else null.
 * Self-initializes the state file (anchored at first run / PERSONA.md ratification). After firing,
 * the user re-runs the review and resets the window via the action.
 */
function checkPersonaReview(): ActionItem | null {
  try {
    let opened: number;
    let dismissedUntil = 0;
    if (existsSync(PERSONA_STATE)) {
      const st = JSON.parse(readFileSync(PERSONA_STATE, 'utf-8'));
      opened = st.windowOpened ?? Date.now();
      dismissedUntil = st.snoozeUntil ?? 0;
    } else {
      // First sighting — anchor the window now (PERSONA.md ratified 2026-06-15).
      opened = Date.parse('2026-06-15T00:00:00Z');
      try { mkdirSync(join(PAI_DIR, 'MEMORY', 'STATE'), { recursive: true }); } catch {}
      try { writeFileSync(PERSONA_STATE, JSON.stringify({ windowOpened: opened, snoozeUntil: 0 }, null, 2)); } catch {}
    }
    const now = Date.now();
    if (now < dismissedUntil) return null; // snoozed
    const ageDays = Math.floor((now - opened) / 86_400_000);
    if (ageDays < PERSONA_REVIEW_DAYS) return null;
    const used = skillUsageCount();
    return {
      type: 'persona_review',
      summary: `${ageDays}d since persona scoping, ${used} skill invocations logged — revisit Tier-2 cuts with usage data`,
      // Self-contained instruction (no slash command exists): read the histogram + the Tier-1 doc.
      action: `Run: jq -r .skill ${SKILL_USAGE_LOG} | sort | uniq -c | sort -rn — then refine specs/memcarry/PERSONA.md cuts/merges against the counts. To snooze, set snoozeUntil in MEMORY/STATE/.persona-review.json.`,
      age_days: ageDays,
    };
  } catch {
    return null;
  }
}

function getPendingActions(): string | null {
  const parts: string[] = [];
  const actions: ActionItem[] = [];

  // Check staging drafts
  const stagingDir = join(PAI_DIR, 'MEMORY', 'STAGING');
  try {
    if (existsSync(stagingDir)) {
      const draftFiles = readdirSync(stagingDir).filter(f => f.endsWith('.md'));
      if (draftFiles.length > 0) {
        parts.push(`${draftFiles.length} draft${draftFiles.length > 1 ? 's' : ''}→/curate`);
        for (const f of draftFiles) {
          actions.push({
            type: 'draft',
            summary: f.replace(/\.md$/, ''),
            action: '/curate',
            file: join(stagingDir, f),
          });
        }
      }
    }
  } catch {}

  // Check stale PRDs (started work, no progress in 7+ days).
  // READ-ONLY: the statusline never writes shared state. Orphaned sessions (WORK/ dir gone) are simply
  // SKIPPED here so they don't show as false stale-PRDs; the actual work.json self-heal write lives in
  // scripts/weekly-maintenance.ts (between-sessions, not the render path).
  const workDir = join(PAI_DIR, 'MEMORY', 'WORK');
  try {
    if (existsSync(WORK_JSON)) {
      const work = JSON.parse(readFileSync(WORK_JSON, 'utf-8'));
      const sessions: Record<string, any> = work.sessions ?? {};
      let stalePrds = 0;
      const now = Date.now();
      for (const [slug, s] of Object.entries(sessions) as [string, any][]) {
        if (!s.phase || s.phase === 'complete' || s.phase === 'native' || s.phase === 'done') continue;
        // Orphaned (dir removed but still active in index) → skip; weekly-maintenance heals the write.
        if (!existsSync(join(workDir, slug))) continue;
        let ageDays = 0;
        if (s.updatedAt) {
          ageDays = Math.floor((now - new Date(s.updatedAt).getTime()) / 86_400_000);
        } else if (s.updated) {
          ageDays = Math.floor((now - new Date(s.updated).getTime()) / 86_400_000);
        } else if (s.started) {
          ageDays = Math.floor((now - new Date(s.started).getTime()) / 86_400_000);
        } else {
          ageDays = 999;
        }
        if (ageDays >= 7) {
          stalePrds++;
          // Derive project dir: stored in session, or from PRD frontmatter
          let project: string | undefined = s.projectDir;
          const prdPath = join(workDir, slug, 'PRD.md');
          if (!project && existsSync(prdPath)) {
            try {
              const head = readFileSync(prdPath, 'utf-8').slice(0, 500);
              const dirMatch = head.match(/project_dir:\s*(.+)/);
              if (dirMatch) project = dirMatch[1].trim();
            } catch {}
          }
          actions.push({
            type: 'stale_prd',
            summary: s.task?.slice(0, 80) || slug,
            action: 'close or resume',
            slug,
            phase: s.phase,
            age_days: ageDays,
            project,
            file: existsSync(prdPath) ? prdPath : undefined,
          });
        }
      }
      if (stalePrds > 0) parts.push(`${stalePrds} stale PRD${stalePrds > 1 ? 's' : ''}`);
    }
  } catch {}

  // Check git state — ONE call (porcelain=v2 --branch gives ahead/behind + dirty together;
  // fails non-zero outside a repo, so no separate rev-parse needed). Was 3 spawns, now 1.
  try {
    const gs = spawnSync('git', ['status', '--porcelain=v2', '--branch'], { cwd: currentDir, timeout: 2000 });
    if (gs.status === 0) {
      const { ahead, dirty } = parseGitState(gs.stdout.toString());
      if (ahead > 0) {
        parts.push(`${ahead} unpushed`);
        actions.push({ type: 'git_unpushed', summary: `${ahead} commit${ahead > 1 ? 's' : ''} ahead of upstream`, action: 'git push' });
      }
      if (dirty > 0) {
        parts.push(`${dirty} dirty`);
        actions.push({ type: 'git_dirty', summary: `${dirty} uncommitted file${dirty > 1 ? 's' : ''}`, action: 'git add + commit' });
      }
    }
  } catch {}

  // Check GitHub reviews awaiting (cached — background refresh via cron).
  // Surfaces gh-auth failure (not silent): the cron records authed:false on `gh` failure so a deauth
  // shows "gh auth?" instead of masking real review requests (observability-hole rule).
  try {
    if (existsSync(GH_REVIEWS_CACHE)) {
      const cache = JSON.parse(readFileSync(GH_REVIEWS_CACHE, 'utf-8'));
      const age = Date.now() - (cache.updated ?? 0);
      if (age < GH_CACHE_TTL) {
        if (cache.authed === false) {
          parts.push('gh auth?');
          actions.push({ type: 'gh_reviews', summary: 'gh not authenticated — PR reviews unknown (run: gh auth login)', action: 'gh auth login' });
        } else if (cache.reviews?.length > 0) {
          parts.push(`${cache.reviews.length} PR review${cache.reviews.length > 1 ? 's' : ''}`);
          for (const pr of cache.reviews) {
            actions.push({ type: 'gh_reviews', summary: `#${pr.number}: ${pr.title}`.slice(0, 80), action: `gh pr view ${pr.number}` });
          }
        }
      }
    }
  } catch {}

  // Check wiki page staleness (cached — background refresh daily)
  try {
    if (existsSync(WIKI_STALE_CACHE)) {
      const cache = JSON.parse(readFileSync(WIKI_STALE_CACHE, 'utf-8'));
      const age = Date.now() - (cache.updated ?? 0);
      if (age < WIKI_CACHE_TTL && cache.staleCount > 0) {
        parts.push(`${cache.staleCount} wiki stale`);
        actions.push({ type: 'wiki_stale', summary: `${cache.staleCount} pages not verified in 90+ days`, action: 'review wiki Last Verified dates' });
      }
    }
  } catch {}

  // Check maintenance overdue
  const maintState = join(PAI_DIR, 'MEMORY', 'STATE', '.weekly-maintenance.json');
  try {
    if (existsSync(maintState)) {
      const state = JSON.parse(readFileSync(maintState, 'utf-8'));
      const daysSince = Math.floor((Date.now() - state.lastRun) / 86_400_000);
      if (daysSince >= 7) {
        parts.push(`maint ${daysSince}d overdue`);
        actions.push({ type: 'maintenance', summary: `${daysSince} days overdue`, action: '/weekly-maintenance' });
      }
    } else {
      parts.push('maint never run');
      actions.push({ type: 'maintenance', summary: 'never run', action: '/weekly-maintenance' });
    }
  } catch {}

  // Persona-review reminder (time-based, surfaces accrued usage as context)
  const personaAction = checkPersonaReview();
  if (personaAction) {
    parts.push(`persona review (${personaAction.age_days}d)`);
    actions.push(personaAction);
  }

  // Write manifest for AI consumption
  if (actions.length > 0) {
    try { writeFileSync(ACTIONS_JSON, JSON.stringify({ updated: new Date().toISOString(), cwd: currentDir, actions }, null, 2)); } catch {}
  } else {
    try { writeFileSync(ACTIONS_JSON, JSON.stringify({ updated: new Date().toISOString(), cwd: currentDir, actions: [] }, null, 2)); } catch {}
  }

  return parts.length > 0 ? parts.join(' │ ') : null;
}

const pendingActions = getPendingActions();
if (pendingActions && mode !== 'nano') {
  p(`${ALERT_COLOR}⚡${R} ${ALERT_DIM}ACTION:${R} ${ALERT_COLOR}${pendingActions}${R}`);
  p(SEP);
}

// Line 5: Active Algorithm task (if any)
if (activeTask) {
  const task = activeTask.task.length > 42
    ? activeTask.task.slice(0, 42) + '…'
    : activeTask.task;
  if (mode === 'nano') {
    p(`${TASK_PRIMARY}◎${R} ${SLATE_300}${task}${R}`);
  } else if (mode === 'micro') {
    p(`${TASK_PRIMARY}◎${R} ${SLATE_300}${task}${R} ${SLATE_600}│${R} ${TASK_PHASE}${activeTask.phase}${R}`);
  } else if (mode === 'mini') {
    p(`${TASK_PRIMARY}◎${R} ${TASK_PRIMARY}TASK:${R} ${SLATE_300}${task}${R} ${SLATE_600}│${R} ${TASK_PHASE}${activeTask.phase}${R} ${SLATE_600}│${R} ${TASK_PROG}${activeTask.progress}${R}`);
  } else {
    p(`${TASK_PRIMARY}◎${R} ${TASK_PRIMARY}TASK:${R} ${SLATE_300}${task}${R} ${SLATE_600}│${R} ${TASK_PHASE}Phase:${R} ${TASK_PHASE}${activeTask.phase}${R} ${SLATE_600}│${R} ${TASK_PROG}${activeTask.progress}${R}`);
  }
  p(SEP);
}

process.stdout.write(out.join('\n') + '\n');
