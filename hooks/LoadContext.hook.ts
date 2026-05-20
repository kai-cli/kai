#!/usr/bin/env bun
/**
 * LoadContext.hook.ts - Inject PAI dynamic context into Claude's Context (SessionStart)
 *
 * v5.6.0: Core context (identity, rules, format) is now in CLAUDE.md and loaded
 * natively by Claude Code. This hook injects DYNAMIC context only:
 * - Relationship context (recent opinions + notes)
 * - Learning readback (signals, wisdom, failure patterns)
 * - Active work summary (last 48h sessions + tracked projects)
 * - Index memory (≤50 lines, Feature A)
 * - Instinct surfacing (behavioral nudges, Feature B)
 *
 * TRIGGER: SessionStart
 *
 * INPUT:
 * - Environment: PAI_DIR, CLAUDE_PROJECT_DIR
 * - Files: PAI/USER/OPINIONS.md, MEMORY/RELATIONSHIP/*, MEMORY/LEARNING/*,
 *          MEMORY/WORK/*, MEMORY/STATE/progress/*.json, MEMORY/STATE/memory-meta.jsonl
 *
 * OUTPUT:
 * - stdout: <system-reminder> containing dynamic context (relationship + learning)
 * - stdout: Active work summary if previous sessions have pending work
 * - stderr: Status messages and errors
 * - exit(0): Normal completion
 *
 * DESIGN:
 * CLAUDE.md handles static identity/format (loaded natively by Claude Code).
 * This hook force-loads startup files (settings.json → loadAtStartup) and
 * injects dynamic, session-specific context (relationship, learning, work).
 *
 * PERFORMANCE:
 * - Blocking: Yes (context is essential)
 * - Typical execution: <50ms (no SKILL.md rebuild needed)
 * - Skipped for subagents: Yes
 */

import { readFileSync, existsSync, readdirSync, appendFileSync, mkdirSync } from 'fs';
import { loadIndexMemory, initializeMeta, loadMeta } from './lib/memory-disclosure';
import { decayInstincts, surfaceInstincts, formatInstinctContext } from './lib/instinct-store';

function ttyLog(msg: string): void {
  console.error(msg);
}

function flushTty(): void {
  // no-op — ttyLog now writes to stderr immediately (captured by run-hook.sh)
}
import { join } from 'path';
import { getPaiDir } from './lib/paths';
import { recordSessionStart } from './lib/notifications';
import { loadLearningDigest, loadWisdomFrames, loadFailurePatterns, loadSignalTrends } from './lib/learning-readback';
import { loadKnowledgeContext } from './lib/knowledge-readback';
import { alreadyRanForSession, markRanForSession } from './lib/once-per-session';

export interface DynamicContextConfig {
  relationshipContext?: boolean;
  learningReadback?: boolean;
  knowledgeInjection?: boolean;
  activeWorkSummary?: boolean;
}

interface LoadAtStartupConfig {
  _docs?: string;
  files?: string[];
}

export interface Settings {
  dynamicContext?: DynamicContextConfig;
  loadAtStartup?: LoadAtStartupConfig;
  instincts?: {
    enabled?: boolean;
    surfaceAtStart?: boolean;
    captureCorrections?: boolean;
    maxSurfaced?: number;
  };
  [key: string]: unknown;
}

/**
 * Check if a dynamic context section is enabled.
 * Defaults to true if not configured (backward compatible).
 */
export function isDynamicEnabled(settings: Settings, key: keyof DynamicContextConfig): boolean {
  if (!settings.dynamicContext) return true;
  const val = settings.dynamicContext[key];
  return val !== false;
}

/**
 * Load settings.json and return the settings object.
 */
function loadSettings(paiDir: string): Settings {
  const settingsPath = join(paiDir, 'settings.json');
  if (existsSync(settingsPath)) {
    try {
      return JSON.parse(readFileSync(settingsPath, 'utf-8'));
    } catch (err) {
      console.error(`⚠️ Failed to parse settings.json: ${err}`);
    }
  }
  return {};
}

/**
 * Files that are only loaded for personal/PAI projects, not work projects.
 * Saves ~500 tokens on work sessions where this context isn't needed.
 */
const CONDITIONAL_FILES: Record<string, 'personal-only'> = {
  'PAI/USER/TELOS/DIGEST.md': 'personal-only',
};

/**
 * Determine if the current session is a "personal" project (PAI, research, etc.)
 * vs a work project (employer repos, firmware, etc.)
 */
function isPersonalProject(): boolean {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const personalPatterns = [
    'kai', 'kai', 'Research-Agent', 'GranolaMCP', 'Knowledge',
    'CLI-Hidden-Commands', '/.claude/',
  ];
  return personalPatterns.some(p => projectDir.includes(p)) ||
    !projectDir.includes('/Projects/');
}

/**
 * Load files listed in settings.json → loadAtStartup.files
 * Reads each file and injects as a system-reminder block.
 * Files in CONDITIONAL_FILES are skipped based on project type.
 */
function loadStartupFiles(paiDir: string, settings: Settings): string | null {
  const config = settings.loadAtStartup;
  if (!config?.files || config.files.length === 0) return null;

  const personal = isPersonalProject();
  const parts: string[] = [];
  for (const relPath of config.files) {
    // Check conditional loading rules
    const condition = CONDITIONAL_FILES[relPath];
    if (condition === 'personal-only' && !personal) {
      console.error(`⏭️ Skipped ${relPath} (personal-only, work project detected)`);
      continue;
    }

    const fullPath = join(paiDir, relPath);
    if (!existsSync(fullPath)) {
      console.error(`⚠️ loadAtStartup: file not found: ${relPath}`);
      continue;
    }
    try {
      const content = readFileSync(fullPath, 'utf-8').trim();
      parts.push(content);
      console.error(`📄 Force-loaded: ${relPath} (${content.length} chars)`);
    } catch (err) {
      console.error(`⚠️ loadAtStartup: failed to read ${relPath}: ${err}`);
    }
  }

  if (parts.length === 0) return null;
  return parts.join('\n\n---\n\n');
}

/**
 * Load relationship context for session startup.
 * Returns a lightweight summary of key opinions and recent notes.
 */
function loadRelationshipContext(paiDir: string): string | null {
  const parts: string[] = [];

  // Load high-confidence opinions (>0.85) from OPINIONS.md
  const opinionsPath = join(paiDir, 'PAI/USER/OPINIONS.md');
  if (existsSync(opinionsPath)) {
    try {
      const content = readFileSync(opinionsPath, 'utf-8');
      const highConfidence: string[] = [];

      const opinionBlocks = content.split(/^### /gm).slice(1);
      for (const block of opinionBlocks) {
        const lines = block.split('\n');
        const statement = lines[0]?.trim();
        const confidenceMatch = block.match(/\*\*Confidence:\*\*\s*([\d.]+)/);
        const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0;

        if (confidence >= 0.85 && statement) {
          highConfidence.push(`• ${statement} (${(confidence * 100).toFixed(0)}%)`);
        }
      }

      if (highConfidence.length > 0) {
        parts.push('**Key Opinions (high confidence):**');
        parts.push(highConfidence.slice(0, 6).join('\n'));
      }
    } catch (err) {
      console.error(`⚠️ Failed to load opinions: ${err}`);
    }
  }

  // Load recent relationship notes (today and yesterday)
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const formatDate = (d: Date) => d.toISOString().split('T')[0];
  const formatMonth = (d: Date) => d.toISOString().slice(0, 7);

  const recentNotes: string[] = [];
  for (const date of [today, yesterday]) {
    const notePath = join(
      paiDir,
      'MEMORY/RELATIONSHIP',
      formatMonth(date),
      `${formatDate(date)}.md`
    );
    if (existsSync(notePath)) {
      try {
        const content = readFileSync(notePath, 'utf-8');
        const notes = content
          .split('\n')
          .filter(line => line.trim().startsWith('- '))
          .slice(0, 5);
        if (notes.length > 0) {
          recentNotes.push(`*${formatDate(date)}:*`);
          recentNotes.push(...notes);
        }
      } catch {}
    }
  }

  if (recentNotes.length > 0) {
    if (parts.length > 0) parts.push('');
    parts.push('**Recent Relationship Notes:**');
    parts.push(recentNotes.join('\n'));
  }

  if (parts.length === 0) return null;

  return `
## Relationship Context

${parts.join('\n')}

*Full details: PAI/USER/OPINIONS.md, MEMORY/RELATIONSHIP/*
`;
}

interface WorkSession {
  type: 'recent' | 'project';
  name: string;
  title: string;
  status: string;
  timestamp: string;
  stale: boolean;
  objectives?: string[];
  handoff_notes?: string;
  next_steps?: string[];
  prd?: { id: string; status: string; progress: string } | null;
}

/**
 * Scan recent WORK/ directories (last 48h) for active sessions.
 */
function getRecentWorkSessions(paiDir: string): WorkSession[] {
  const workDir = join(paiDir, 'MEMORY', 'WORK');
  if (!existsSync(workDir)) return [];

  let sessionNames: Record<string, string> = {};
  const namesPath = join(paiDir, 'MEMORY', 'STATE', 'session-names.json');
  try {
    if (existsSync(namesPath)) {
      sessionNames = JSON.parse(readFileSync(namesPath, 'utf-8'));
    }
  } catch { /* ignore parse errors */ }

  const sessions: WorkSession[] = [];
  const now = Date.now();
  const cutoff48h = 48 * 60 * 60 * 1000;
  const seenSessionIds = new Set<string>();

  try {
    const allDirs = readdirSync(workDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && /^\d{8}-\d{6}_/.test(d.name))
      .map(d => d.name)
      .sort()
      .reverse()
      .slice(0, 30);

    for (const dirName of allDirs) {
      const match = dirName.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})_(.+)$/);
      if (!match) continue;

      const [, y, mo, d, h, mi, s, slug] = match;
      const dirTime = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}`).getTime();

      if (now - dirTime > cutoff48h) break;

      const dirPath = join(workDir, dirName);

      // Read metadata from PRD.md frontmatter (consolidated) or META.yaml (legacy)
      let status = 'UNKNOWN';
      let rawTitle = slug.replace(/-/g, ' ');
      let sessionId: string | undefined;
      const prdPath = join(dirPath, 'PRD.md');
      const metaPath = join(dirPath, 'META.yaml');

      if (existsSync(prdPath)) {
        // Read from PRD.md frontmatter
        try {
          const prdHead = readFileSync(prdPath, 'utf-8').substring(0, 800);
          const statusMatch = prdHead.match(/^status:\s*"?(\w+)"?/m);
          const phaseMatch = prdHead.match(/^phase:\s*"?(\w+)"?/m);
          const titleMatch = prdHead.match(/^title:\s*"?(.+?)"?\s*$/m);
          const taskMatch = prdHead.match(/^task:\s*"?(.+?)"?\s*$/m);
          const sessionIdMatch = prdHead.match(/^session_id:\s*"?(.+?)"?\s*$/m);
          if (statusMatch) status = statusMatch[1];
          else if (phaseMatch) status = phaseMatch[1].toUpperCase();
          if (titleMatch) rawTitle = titleMatch[1];
          else if (taskMatch) rawTitle = taskMatch[1];
          if (sessionIdMatch) sessionId = sessionIdMatch[1]?.trim();
        } catch { /* skip */ }
      } else if (existsSync(metaPath)) {
        // Legacy: Read from META.yaml
        try {
          const meta = readFileSync(metaPath, 'utf-8');
          const statusMatch = meta.match(/^status:\s*"?(\w+)"?/m);
          const titleMatch = meta.match(/^title:\s*"?(.+?)"?\s*$/m);
          const sessionIdMatch = meta.match(/^session_id:\s*"?(.+?)"?\s*$/m);
          if (statusMatch) status = statusMatch[1];
          if (titleMatch) rawTitle = titleMatch[1];
          if (sessionIdMatch) sessionId = sessionIdMatch[1]?.trim();
        } catch { /* skip */ }
      } else {
        continue; // No PRD.md or META.yaml — skip
      }

      try {

        if (status === 'COMPLETED' || status === 'COMPLETE') continue;
        if (rawTitle.toLowerCase().startsWith('tasknotification') || rawTitle.length < 10) continue;
        if (sessionId && seenSessionIds.has(sessionId)) continue;
        if (sessionId) seenSessionIds.add(sessionId);

        const title = (sessionId && sessionNames[sessionId]) || rawTitle;

        if (sessions.length >= 8) break;

        let prd: WorkSession['prd'] = null;
        try {
          // PRD.md at root; legacy: PRD-*.md
          let prdFile: string | null = null;
          if (existsSync(join(dirPath, 'PRD.md'))) {
            prdFile = join(dirPath, 'PRD.md');
          } else {
            const files = readdirSync(dirPath).filter(f => f.startsWith('PRD-') && f.endsWith('.md'));
            if (files.length > 0) prdFile = join(dirPath, files[0]);
          }
          if (prdFile) {
            const prdContent = readFileSync(prdFile, 'utf-8').substring(0, 800);
            const prdIdMatch = prdContent.match(/^id:\s*(.+)$/m);
            const prdStatusMatch = prdContent.match(/^status:\s*(.+)$/m);
            const prdPhaseMatch = prdContent.match(/^phase:\s*(.+)$/m);
            const prdVerifyMatch = prdContent.match(/^verification_summary:\s*"?(.+?)"?$/m);
            const prdProgressMatch = prdContent.match(/^progress:\s*(.+)$/m);
            prd = {
              id: prdIdMatch?.[1]?.trim() || 'PRD',
              status: prdStatusMatch?.[1]?.trim() || prdPhaseMatch?.[1]?.trim() || 'UNKNOWN',
              progress: prdVerifyMatch?.[1]?.trim() || prdProgressMatch?.[1]?.trim() || '0/0'
            };
          }
        } catch { /* no PRDs */ }

        sessions.push({
          type: 'recent',
          name: dirName,
          title: title.length > 60 ? title.substring(0, 57) + '...' : title,
          status,
          timestamp: `${y}-${mo}-${d} ${h}:${mi}`,
          stale: false,
          prd
        });
      } catch { /* skip malformed */ }
    }
  } catch (err) {
    console.error(`⚠️ Error scanning WORK dirs: ${err}`);
  }

  return sessions;
}

/**
 * Load persistent project progress files, flagging stale ones (>14 days).
 */
function getProjectProgress(paiDir: string): WorkSession[] {
  const progressDir = join(paiDir, 'MEMORY', 'STATE', 'progress');
  if (!existsSync(progressDir)) return [];

  const sessions: WorkSession[] = [];
  const now = Date.now();
  const staleThreshold = 14 * 24 * 60 * 60 * 1000;

  try {
    const files = readdirSync(progressDir).filter(f => f.endsWith('-progress.json'));

    for (const file of files) {
      try {
        const content = readFileSync(join(progressDir, file), 'utf-8');

        interface ProgressFile {
          project: string;
          status: string;
          updated: string;
          objectives: string[];
          next_steps: string[];
          handoff_notes: string;
        }

        const progress = JSON.parse(content) as ProgressFile;
        if (progress.status !== 'active') continue;

        const updatedTime = new Date(progress.updated).getTime();
        const isStale = (now - updatedTime) > staleThreshold;

        sessions.push({
          type: 'project',
          name: progress.project,
          title: progress.project,
          status: 'active',
          timestamp: new Date(progress.updated).toISOString().split('T')[0],
          stale: isStale,
          objectives: progress.objectives,
          handoff_notes: progress.handoff_notes,
          next_steps: progress.next_steps
        });
      } catch { /* skip malformed */ }
    }
  } catch (err) {
    console.error(`⚠️ Error reading progress files: ${err}`);
  }

  return sessions;
}

/**
 * Unified activity dashboard — merges recent WORK sessions + persistent projects.
 */
async function checkActiveProgress(paiDir: string): Promise<string | null> {
  const recentSessions = getRecentWorkSessions(paiDir);
  const projects = getProjectProgress(paiDir);

  if (recentSessions.length === 0 && projects.length === 0) {
    return null;
  }

  let summary = '\n📋 ACTIVE WORK:\n';

  if (recentSessions.length > 0) {
    summary += '\n  ── Recent Sessions (last 48h) ──\n';
    for (const s of recentSessions) {
      summary += `\n  ⚡ ${s.title}\n`;
      summary += `     ${s.timestamp} | Status: ${s.status}\n`;
      if (s.prd) {
        summary += `     PRD: ${s.prd.id} (${s.prd.status}, ${s.prd.progress})\n`;
      }
    }
  }

  if (projects.length > 0) {
    summary += '\n  ── Tracked Projects ──\n';
    for (const proj of projects) {
      const staleTag = proj.stale ? ' ⚠️ STALE (>14d)' : '';
      summary += `\n  ${proj.stale ? '🟡' : '🔵'} ${proj.name}${staleTag}\n`;

      if (proj.objectives && proj.objectives.length > 0) {
        summary += '     Objectives:\n';
        proj.objectives.forEach(o => summary += `     • ${o}\n`);
      }

      if (proj.handoff_notes) {
        summary += `     Handoff: ${proj.handoff_notes}\n`;
      }

      if (proj.next_steps && proj.next_steps.length > 0) {
        summary += '     Next steps:\n';
        proj.next_steps.forEach(s => summary += `     → ${s}\n`);
      }
    }
  }

  summary += '\n💡 To resume project: `bun run ~/.claude/PAI/Tools/SessionProgress.ts resume <project>`\n';
  summary += '💡 To complete project: `bun run ~/.claude/PAI/Tools/SessionProgress.ts complete <project>`\n';

  return summary;
}

/**
 * Apply token budget cap to dynamic context sources.
 * Priority: knowledge (1, highest) > learning (2) > relationship (3, dropped first).
 * Returns trimmed versions of each source that fit within budgetChars total.
 * Exported for unit testing.
 */
export function applyTokenBudget(
  sources: { knowledge: string; learning: string; relationship: string },
  budgetChars: number
): { knowledge: string; learning: string; relationship: string } {
  const result = { ...sources };
  const order = [
    { name: 'relationship' as const, priority: 3 },
    { name: 'learning' as const, priority: 2 },
    { name: 'knowledge' as const, priority: 1 },
  ];

  const total = () => result.knowledge.length + result.learning.length + result.relationship.length;

  if (total() <= budgetChars) return result;

  let excess = total() - budgetChars;

  // Drop/truncate lowest priority first
  for (const { name } of order) {
    if (excess <= 0) break;
    const len = result[name].length;
    if (len === 0) continue;
    if (len <= excess) {
      result[name] = '';
      excess -= len;
    } else {
      result[name] = result[name].substring(0, len - excess) + '\n\n[... truncated to fit token budget]';
      excess = 0;
    }
  }

  return result;
}

async function main() {
  try {
    // Read hook input for compaction detection and session tracking
    let sessionId: string | null = null;
    try {
      const stdinText = await Bun.stdin.text();
      if (stdinText.trim()) {
        const hookInput = JSON.parse(stdinText);
        sessionId = hookInput.session_id || null;
        if (hookInput.source === 'compact') {
          console.error('[LoadContext] Skipping — compaction (handled by PostCompactRecovery)');
          process.exit(0);
        }
      }
    } catch { /* stdin parse failed — proceed as normal session start */ }

    // Only run once per session (prevents re-fire on compaction/resume)
    if (alreadyRanForSession('LoadContext', sessionId)) {
      console.error('[LoadContext] Skipping — already ran for this session');
      process.exit(0);
    }
    markRanForSession('LoadContext', sessionId);

    // Subagents don't need dynamic context injection
    const claudeProjectDir = process.env.CLAUDE_PROJECT_DIR || '';
    const isSubagent = claudeProjectDir.includes('/.claude/Agents/') ||
                      process.env.CLAUDE_AGENT_TYPE !== undefined;

    if (isSubagent) {
      console.error('🤖 Subagent session - skipping context loading');
      process.exit(0);
    }

    const paiDir = getPaiDir();

    // Record session start time for notification timing
    recordSessionStart();
    console.error('⏱️ Session start time recorded');

    // Load settings for dynamic context controls
    const settings = loadSettings(paiDir);
    console.error('✅ Loaded settings.json');

    // Force-load startup files from settings.json → loadAtStartup
    const startupContent = loadStartupFiles(paiDir, settings);
    if (startupContent) {
      console.log(`<system-reminder>\n${startupContent}\n</system-reminder>`);
    }

    // Load relationship context (lightweight summary)
    let relationshipContext: string | null = null;
    if (isDynamicEnabled(settings, 'relationshipContext')) {
      relationshipContext = loadRelationshipContext(paiDir);
      if (relationshipContext) {
        console.error(`💕 Loaded relationship context (${relationshipContext.length} chars)`);
      }
    } else {
      console.error('⏭️ Skipped relationship context (disabled)');
    }

    // Load learning readback context
    let learningContext = '';
    if (isDynamicEnabled(settings, 'learningReadback')) {
      const learningDigest = loadLearningDigest(paiDir);
      const wisdomFrames = loadWisdomFrames(paiDir);
      const failurePatterns = loadFailurePatterns(paiDir);
      const signalTrends = loadSignalTrends(paiDir);

      const learningParts: string[] = [];
      if (signalTrends) learningParts.push(signalTrends);
      if (wisdomFrames) learningParts.push(wisdomFrames);
      if (learningDigest) learningParts.push(learningDigest);
      if (failurePatterns) learningParts.push(failurePatterns);

      learningContext = learningParts.length > 0
        ? '\n## Learning Context (auto-loaded)\n\n' + learningParts.join('\n\n')
        : '';

      if (learningParts.length > 0) {
        console.error(`📚 Loaded learning context: ${learningParts.length} sections (${learningContext.length} chars)`);
      }
    } else {
      console.error('⏭️ Skipped learning readback (disabled)');
    }

    // Load cross-project knowledge context
    let knowledgeContext = '';
    let injectedDomains: string[] = [];
    if (isDynamicEnabled(settings, 'knowledgeInjection')) {
      const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
      const result = loadKnowledgeContext(paiDir, projectDir);
      if (result.content) {
        knowledgeContext = result.content;
        injectedDomains = result.injectedDomains;
        console.error(`🧠 Loaded knowledge context: ${result.injectedDomains.join(', ')} (${result.totalChars} chars)`);

        // Write read telemetry for compound staleness detection
        try {
          const stateDir = join(paiDir, 'MEMORY', 'STATE');
          mkdirSync(stateDir, { recursive: true });
          const readLog = join(stateDir, 'memory-reads.jsonl');
          const readEntry = {
            timestamp: new Date().toISOString(),
            session_id: sessionId || process.env.CLAUDE_SESSION_ID || 'unknown',
            project: projectDir,
            domains_injected: result.injectedDomains,
            total_chars: result.totalChars,
          };
          appendFileSync(readLog, JSON.stringify(readEntry) + '\n');
        } catch (err) {
          console.error(`⚠️ Failed to write read telemetry: ${err}`);
        }
      }
    } else {
      console.error('⏭️ Skipped knowledge injection (disabled)');
    }

    // Token budget cap — delegate to exported pure function for testability
    const budgeted = applyTokenBudget(
      { knowledge: knowledgeContext, learning: learningContext, relationship: relationshipContext ?? '' },
      16000
    );
    knowledgeContext     = budgeted.knowledge;
    learningContext      = budgeted.learning;
    relationshipContext  = budgeted.relationship || null;

    // Feature A: load index-only memory (≤50 lines) — separate from knowledge context
    let indexMemory = '';
    const instinctsEnabled = settings.instincts?.enabled !== false;
    const surfaceAtStart = settings.instincts?.surfaceAtStart !== false;

    // Feature A: initialize meta if first run (no meta.jsonl yet)
    try {
      const meta = loadMeta(paiDir);
      if (meta.length === 0) {
        // First run — look for MEMORY.md to seed meta
        const projectDir = process.env.CLAUDE_PROJECT_DIR || '';
        const encoded = projectDir ? projectDir.replace(/[/_]/g, '-') : '';
        const projectMemPath = encoded ? join(paiDir, 'projects', encoded, 'memory', 'MEMORY.md') : '';
        const fallbackPath = join(paiDir, 'MEMORY.md');
        const mdPath = (projectMemPath && existsSync(projectMemPath)) ? projectMemPath : existsSync(fallbackPath) ? fallbackPath : null;
        if (mdPath) {
          const content = readFileSync(mdPath, 'utf-8');
          if (content.trim()) {
            initializeMeta(paiDir, content);
            console.error('[LoadContext] Feature A: meta initialized from MEMORY.md');
          }
        }
      }
      indexMemory = loadIndexMemory(paiDir);
      if (indexMemory) {
        console.error(`[LoadContext] Feature A: loaded index memory (${indexMemory.length} chars)`);
      }
    } catch (err) {
      console.error(`[LoadContext] Feature A: index memory error (non-fatal): ${err}`);
    }

    // Feature B: instinct decay + surfacing
    let instinctContext = '';
    if (instinctsEnabled && surfaceAtStart) {
      try {
        const archived = decayInstincts(paiDir);
        if (archived > 0) {
          console.error(`[LoadContext] Feature B: decayed ${archived} instinct(s) to archive`);
        }
        const relevant = surfaceInstincts(paiDir, process.env.CLAUDE_PROJECT_DIR || process.cwd());
        if (relevant.length > 0) {
          instinctContext = formatInstinctContext(relevant);
          console.error(`[LoadContext] Feature B: surfaced ${relevant.length} instinct(s)`);
        }
      } catch (err) {
        console.error(`[LoadContext] Feature B: instinct surfacing error (non-fatal): ${err}`);
      }
    }

    // Inject dynamic context if we have any
    if (relationshipContext || learningContext || knowledgeContext || instinctContext) {
      const instinctSection = instinctContext ? '\n---\n' + instinctContext : '';
      const message = `<system-reminder>
PAI Dynamic Context (Auto-loaded at Session Start)
${relationshipContext ?? ''}${learningContext ? '\n---\n' + learningContext : ''}${knowledgeContext ? '\n---\n' + knowledgeContext : ''}${instinctSection}
---
Dynamic context loaded. Core identity, rules, and format are in CLAUDE.md.
</system-reminder>`;

      console.log(message);
      ttyLog('\n✅ PAI dynamic context loaded...');
    } else {
      ttyLog('\n✅ KAI session ready...');
    }

    // Active work summary
    if (isDynamicEnabled(settings, 'activeWorkSummary')) {
      const activeProgress = await checkActiveProgress(paiDir);
      if (activeProgress) {
        ttyLog(activeProgress);
        console.error(`📋 Active work summary loaded (${activeProgress.length} chars)`);
      }
    } else {
      console.error('⏭️ Skipped active work summary (disabled)');
    }

    // Stale PRD nudge: surface PRDs with 0 progress and >14 days since update
    try {
      const workDir = join(paiDir, 'MEMORY', 'WORK');
      if (existsSync(workDir)) {
        const now = Date.now();
        const staleThreshold = 14 * 24 * 60 * 60 * 1000;
        let staleCount = 0;
        let oldestDays = 0;
        const dirs = readdirSync(workDir, { withFileTypes: true })
          .filter(d => d.isDirectory() && /^\d{8}-\d{6}_/.test(d.name));
        for (const d of dirs) {
          const prdPath = join(workDir, d.name, 'PRD.md');
          if (!existsSync(prdPath)) continue;
          const head = readFileSync(prdPath, 'utf-8').substring(0, 600);
          const progressMatch = head.match(/^progress:\s*(\d+)\/\d+/m);
          const passed = progressMatch ? parseInt(progressMatch[1]) : -1;
          if (passed !== 0) continue;
          const updatedMatch = head.match(/^updated:\s*(.+)$/m) || head.match(/^started:\s*(.+)$/m);
          if (!updatedMatch) continue;
          const age = now - new Date(updatedMatch[1].trim()).getTime();
          if (age > staleThreshold) {
            staleCount++;
            oldestDays = Math.max(oldestDays, Math.floor(age / 86_400_000));
          }
        }
        if (staleCount > 0) {
          const nudge = `<system-reminder>\n⚠️ ${staleCount} stale PRD(s) with no progress (oldest: ${oldestDays}d). Review with /end or on the Board.\n</system-reminder>`;
          console.log(nudge);
          ttyLog(`⚠️ ${staleCount} stale PRD(s) — oldest ${oldestDays}d without progress`);
        }
      }
    } catch { /* non-fatal */ }

    // Staging nudge: if unreviewed drafts exist and curate hasn't run in >3 days,
    // surface in session context (not just stderr) so the model sees it too.
    try {
      const stagingDir = join(paiDir, 'MEMORY', 'STAGING');
      const curationLog = join(paiDir, 'MEMORY', 'STATE', 'curation-log.jsonl');
      if (existsSync(stagingDir)) {
        const drafts = readdirSync(stagingDir).filter(f => f.endsWith('.md'));
        if (drafts.length > 0) {
          let daysSinceCuration = 999;
          if (existsSync(curationLog)) {
            const lines = readFileSync(curationLog, 'utf-8').trim().split('\n').filter(l => l);
            const lastEntry = lines[lines.length - 1];
            if (lastEntry) {
              const ts = JSON.parse(lastEntry).timestamp;
              daysSinceCuration = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
            }
          }
          if (daysSinceCuration >= 3) {
            const nudge = `<system-reminder>\n💡 STAGING has ${drafts.length} unreviewed draft(s) pending curation (${daysSinceCuration}d since last review). Run \`pai curate\` to promote lessons to WISDOM/FRAMES/ and improve future sessions.\n</system-reminder>`;
            console.log(nudge);
            ttyLog(`💡 STAGING: ${drafts.length} draft(s) awaiting curation`);
          }
        }
      }
    } catch { /* non-fatal */ }

    // Check for context routing drift
    try {
      const driftFile = join(paiDir, 'MEMORY', 'STATE', 'routing-drift.json');
      if (existsSync(driftFile)) {
        const drift = JSON.parse(readFileSync(driftFile, 'utf-8'));
        const ageHours = (Date.now() - new Date(drift.lastAudit).getTime()) / 3600000;
        if (ageHours < 168 && (drift.staleCount > 0 || drift.discoveredCount > 0)) {
          const parts: string[] = [];
          if (drift.staleCount > 0) parts.push(`${drift.staleCount} stale path(s)`);
          if (drift.discoveredCount > 0) parts.push(`${drift.discoveredCount} new project(s)`);
          ttyLog(`🗺️ Context routing drift: ${parts.join(', ')} — run \`bun PAI/Tools/RoutingAudit.ts fix\``);
        }
      }
    } catch { /* non-fatal */ }

    flushTty();
    console.error('✅ KAI session initialization complete (v5.6.0)');
    process.exit(0);
  } catch (error) {
    flushTty();
    console.error('❌ Error in LoadContext hook:', error);
    process.exit(0); // Non-fatal — don't block session startup
  }
}

if (import.meta.main) { main(); }
