#!/usr/bin/env bun
/**
 * weekly-maintenance.ts — Non-interactive weekly maintenance runner
 *
 * Runs all weekly tasks, produces a summary report, and updates
 * the maintenance state sentinel so the hook knows when it last ran.
 *
 * Usage:
 *   bun scripts/weekly-maintenance.ts           # Run all tasks
 *   bun scripts/weekly-maintenance.ts --dry-run # Show what would run
 *
 * Called by: WeeklyMaintenance.hook.ts nudge, or manually
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const PAI_DIR = process.env.PAI_DIR ?? join(process.env.HOME!, '.claude');
const STATE_FILE = join(PAI_DIR, 'MEMORY', 'STATE', '.weekly-maintenance.json');
const WORK_JSON = join(PAI_DIR, 'MEMORY', 'STATE', 'work.json');
const DRY_RUN = process.argv.includes('--dry-run');

/**
 * Self-heal orphaned work.json sessions: an active session whose WORK/<slug> dir is gone is marked
 * complete. Moved here from statusline.ts (W: render path must stay read-only — it must never mutate
 * shared state). Returns how many were healed. Best-effort; never throws.
 */
function healOrphanedSessions(): number {
  try {
    if (!existsSync(WORK_JSON)) return 0;
    const work = JSON.parse(readFileSync(WORK_JSON, 'utf-8'));
    const sessions: Record<string, any> = work.sessions ?? {};
    const workDir = join(PAI_DIR, 'MEMORY', 'WORK');
    let healed = 0;
    for (const [slug, s] of Object.entries(sessions) as [string, any][]) {
      if (!s.phase || s.phase === 'complete' || s.phase === 'native' || s.phase === 'done') continue;
      if (!existsSync(join(workDir, slug))) { s.phase = 'complete'; healed++; }
    }
    if (healed > 0) writeFileSync(WORK_JSON, JSON.stringify(work, null, 2));
    return healed;
  } catch {
    return 0;
  }
}

interface TaskResult {
  name: string;
  status: 'pass' | 'warn' | 'fail' | 'skip';
  message: string;
  durationMs: number;
}

async function runTask(name: string, command: string[], cwd?: string): Promise<TaskResult> {
  const start = Date.now();
  try {
    const proc = Bun.spawn(command, {
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: cwd ?? PAI_DIR,
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    const duration = Date.now() - start;
    const output = (stdout + stderr).trim();

    if (exitCode === 0) {
      const summary = output.split('\n').slice(-2).join(' ').substring(0, 120);
      return { name, status: 'pass', message: summary || 'OK', durationMs: duration };
    } else {
      const summary = output.split('\n').slice(-3).join(' ').substring(0, 120);
      return { name, status: 'warn', message: summary || `Exit code ${exitCode}`, durationMs: duration };
    }
  } catch (err: any) {
    return { name, status: 'fail', message: err.message?.substring(0, 100) ?? 'Unknown error', durationMs: Date.now() - start };
  }
}

async function checkGitHub(repo: string): Promise<TaskResult> {
  const start = Date.now();
  try {
    const proc = Bun.spawn(['gh', 'issue', 'list', '-R', repo, '--json', 'number,title', '-L', '5'], {
      stdout: 'pipe', stderr: 'pipe',
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    const issues = JSON.parse(stdout || '[]');
    const prProc = Bun.spawn(['gh', 'pr', 'list', '-R', repo, '--json', 'number,title', '-L', '5'], {
      stdout: 'pipe', stderr: 'pipe',
    });
    const prStdout = await new Response(prProc.stdout).text();
    await prProc.exited;
    const prs = JSON.parse(prStdout || '[]');

    const msg = `${issues.length} open issues, ${prs.length} open PRs`;
    return { name: `GitHub (${repo})`, status: issues.length + prs.length > 0 ? 'warn' : 'pass', message: msg, durationMs: Date.now() - start };
  } catch (err: any) {
    return { name: `GitHub (${repo})`, status: 'fail', message: err.message?.substring(0, 80) ?? 'gh error', durationMs: Date.now() - start };
  }
}

async function main() {
  console.log('═══ Weekly Maintenance ═══════════════════════');
  console.log(`  Date: ${new Date().toISOString().split('T')[0]}`);
  console.log(`  Mode: ${DRY_RUN ? 'DRY RUN' : 'EXECUTE'}`);
  console.log('');

  const tasks: { name: string; cmd: string[]; cwd?: string }[] = [
    { name: 'CrossProjectIndex', cmd: ['bun', 'PAI/Tools/CrossProjectIndex.ts'] },
    { name: 'KnowledgeSync (full)', cmd: ['bun', 'hooks/KnowledgeSync.hook.ts'] },
    { name: 'tools-sync', cmd: ['bun', 'scripts/tools-sync.ts'] },
    { name: 'LearningPatternSynthesis', cmd: ['bun', 'PAI/Tools/LearningPatternSynthesis.ts'] },
    { name: 'BehavioralTrends', cmd: ['bun', 'PAI/Tools/LearningPatternSynthesis.ts', '--trends'] },
    { name: 'memory-audit', cmd: ['bun', 'scripts/audit-memory.ts'] },
    { name: 'embedding-index', cmd: ['bun', 'scripts/EmbeddingIndex.ts', '--incremental'] }, // W1/W9: rebuild changed-file embeddings
    { name: 'transcript-cache-prune', cmd: ['bun', 'hooks/lib/transcript-cache.ts', '--prune', '30'] }, // SF-4: drop >30d cache files
    { name: 'wiring-reconcile', cmd: ['bun', 'scripts/reconcile-wiring.ts'] },
    { name: 'security-audit-loop', cmd: ['bun', 'PAI/Tools/SecurityAuditLoop.ts'] }, // W7: dry-run report; human runs --apply
    { name: 'Tests (critical)', cmd: ['bun', 'test', 'tests/SecurityValidator.test.ts', 'tests/PostCompactRecovery.test.ts', 'tests/GitHubWriteGuard.test.ts', 'tests/RiskClassifier.test.ts'] },
  ];

  if (DRY_RUN) {
    console.log('Would run:');
    for (const t of tasks) console.log(`  - ${t.name}: ${t.cmd.join(' ')}`);
    console.log('  - GitHub issues/PRs check (kai-cli/kai)');
    console.log('  - Repo sync status comparison');
    console.log('');
    console.log('Cron: Sundays 9am via Claude Code CronCreate');
    process.exit(0);
  }

  const results: TaskResult[] = [];

  // Run scripted tasks
  for (const t of tasks) {
    process.stdout.write(`  Running ${t.name}...`);
    const result = await runTask(t.name, t.cmd, t.cwd);
    results.push(result);
    const icon = result.status === 'pass' ? '✅' : result.status === 'warn' ? '⚠️' : '❌';
    console.log(` ${icon} (${result.durationMs}ms)`);
  }

  // Self-heal orphaned work.json sessions (moved out of the statusline render path)
  process.stdout.write('  Healing orphaned sessions...');
  const healed = healOrphanedSessions();
  results.push({ name: 'session-self-heal', status: 'pass', message: `${healed} orphaned session(s) marked complete`, durationMs: 0 });
  console.log(` ✅ ${healed} healed`);

  // GitHub check
  process.stdout.write('  Checking GitHub...');
  const ghResult = await checkGitHub('kai-cli/kai');
  results.push(ghResult);
  const ghIcon = ghResult.status === 'pass' ? '✅' : '⚠️';
  console.log(` ${ghIcon} ${ghResult.message}`);

  // Sync status
  process.stdout.write('  Checking sync status...');
  const syncResult = await runTask('Sync status', ['git', '-C', join(process.env.HOME!, 'Projects/kai'), 'log', '--oneline', '-1']);
  results.push(syncResult);
  console.log(` ✅`);

  // Check for pending curations
  const stagingDir = join(PAI_DIR, 'MEMORY', 'STAGING');
  let pendingDrafts = 0;
  try {
    if (existsSync(stagingDir)) {
      const files = readdirSync(stagingDir).filter(f => f.endsWith('.md'));
      pendingDrafts = files.length;
    }
  } catch {}

  // Summary
  console.log('');
  console.log('── Summary ──');
  const passed = results.filter(r => r.status === 'pass').length;
  const warned = results.filter(r => r.status === 'warn').length;
  const failed = results.filter(r => r.status === 'fail').length;
  console.log(`  ${passed} passed, ${warned} warnings, ${failed} failed`);

  if (pendingDrafts > 0) {
    console.log(`\n  ⚠️  ACTION NEEDED: ${pendingDrafts} draft(s) pending curation.`);
    console.log(`     Run: pai curate --quick`);
    console.log(`     Or in Claude: "run pai curate"`);
  }

  for (const r of results) {
    if (r.status !== 'pass') {
      const icon = r.status === 'warn' ? '⚠️' : '❌';
      console.log(`  ${icon} ${r.name}: ${r.message}`);
    }
  }

  // Update state sentinel
  const state = {
    lastRun: Date.now(),
    lastRunDate: new Date().toISOString().split('T')[0],
    results: results.map(r => ({ name: r.name, status: r.status })),
  };
  mkdirSync(join(PAI_DIR, 'MEMORY', 'STATE'), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log('');
  console.log(`  ✅ State updated: ${STATE_FILE}`);
  console.log('     Next reminder in 7 days.');
}

main().catch(err => {
  console.error(`[WeeklyMaintenance] Fatal:`, err);
  process.exit(1);
});
