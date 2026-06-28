#!/usr/bin/env bun
/**
 * GitHubWriteGuard.hook.ts - Require explicit confirmation for GitHub write operations
 *
 * TRIGGER: PreToolUse (Bash only)
 *
 * PURPOSE:
 * The owner has write access on repos. This hook intercepts all GitHub-mutating
 * commands and blocks them until the owner explicitly approves via the token mechanism.
 *
 * BLOCKED OPERATIONS:
 *   - git push (all variants, including --force)
 *   - gh pr create / merge / close / edit / review / comment
 *   - gh issue create / close / edit / delete / comment
 *   - gh release create / edit / delete / upload
 *   - gh api mutations using POST / PUT / PATCH / DELETE
 *   - gh repo delete / archive / rename / transfer
 *   - gh branch delete
 *   - git push --delete (remote branch deletion)
 *
 * ALLOWED: All read-only operations (gh pr list/view/checks/diff, gh api GET, git status, etc.)
 *
 * APPROVAL FLOW (when blocked):
 *   1. Hook blocks command, explains what was blocked
 *   2. Claude uses AskUserQuestion listing EVERY planned GitHub command explicitly
 *   3. After approval, Claude generates tokens:
 *      Single:  bun github-approve.ts "command" "user's response"
 *      Batch:   bun github-approve.ts --batch "user's response" "cmd1" "cmd2" ...
 *      — User's response from AskUserQuestion is REQUIRED
 *      — Only commands listed in AskUserQuestion may be approved
 *   4. Claude runs each approved command
 *   5. Hook sees approval token, allows command, deletes token (one-shot)
 *
 * Token location: MEMORY/STATE/github-approvals/{hash}.json (TTL: 60s)
 */

import { appendFileSync, existsSync, readFileSync, unlinkSync, readdirSync, mkdirSync } from 'fs';
import { basename, join } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';

const BASE_DIR = process.env.PAI_DIR || join(homedir(), '.claude');
const APPROVALS_DIR = join(BASE_DIR, 'MEMORY', 'STATE', 'github-approvals');
const APPROVE_SCRIPT = join(BASE_DIR, 'hooks', 'lib', 'github-approve.ts');
const ADA_PROCEDURES_DIR = join(BASE_DIR, 'ada', 'procedures');
const ADA_OVERRIDE_LOG = join(BASE_DIR, 'MEMORY', 'STATE', 'ada-branch-guard-overrides.jsonl');

interface HookInput {
  tool_name?: string;
  cwd?: string;
  tool_input?: {
    command?: string;
  };
}

interface AdaProcedureConfig {
  branch?: string;
  steps?: string[];
  guard?: {
    hardBlock?: string[];
    warnOnly?: string[];
    overrideEnv?: string;
  };
}

interface AdaBranchCheck {
  config: AdaProcedureConfig;
  repoKey: string;
  expectedBranch: string;
  actualBranch?: string;
  targetBranch?: string;
  mismatch: boolean;
  hardBlock: boolean;
  overrideEnv: string;
}

// GitHub write patterns — regex-tested against each command segment
// Git patterns use GIT_CMD to match global flags between `git` and the subcommand
// (e.g., `git -C /path push` or `git --no-pager push`)
const GIT_CMD = /\bgit\s+(?:(?:-[A-Za-z]\s+\S+|--\S+)\s+)*/;
const WRITE_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  // git push (all variants, including with -C <path> or other global flags)
  { pattern: new RegExp(GIT_CMD.source + 'push\\b'), description: 'git push (remote write)' },

  // gh pr mutations
  { pattern: /\bgh\s+pr\s+(create|merge|close|edit|review|comment|reopen)\b/, description: 'gh pr mutation' },

  // gh issue mutations
  { pattern: /\bgh\s+issue\s+(create|close|edit|delete|comment|reopen|transfer|lock|unlock)\b/, description: 'gh issue mutation' },

  // gh release mutations
  { pattern: /\bgh\s+release\s+(create|edit|delete|upload)\b/, description: 'gh release mutation' },

  // gh api defaults to GET, but mutating methods and field/input flags are writes.
  // `gh api -f/-F/--field/--raw-field/--input` changes the request to POST unless a
  // method is explicitly set, so treat those as writes too.
  { pattern: /\bgh\s+api\b.*(?:--method(?:=|\s+)|-X\s*)(POST|PUT|PATCH|DELETE)\b/i, description: 'gh api mutation' },
  { pattern: /\bgh\s+api\b.*(?:\s|^)(-f|-F|--field|--raw-field|--input)(?:=|\s|$)/, description: 'gh api mutation' },

  // gh repo mutations
  { pattern: /\bgh\s+repo\s+(delete|archive|rename|transfer|edit)\b/, description: 'gh repo mutation' },

  // gh branch/label/workflow mutations
  { pattern: /\bgh\s+(label|workflow)\s+(create|edit|delete|run)\b/, description: 'gh label/workflow mutation' },

  // git remote branch deletion (with global flags)
  { pattern: new RegExp(GIT_CMD.source + 'push\\s+.*--delete\\b'), description: 'remote branch deletion' },
];

function extractCommandInvocations(command: string): string[] {
  // Strip heredoc bodies, quoted strings, and inline script args before splitting.
  // This prevents "git push" inside commit messages, bun -e scripts, or
  // heredoc content from triggering false positives.
  let stripped = command
    // Remove heredoc bodies: << 'EOF' ... EOF (or <<EOF, <<-EOF, <<"EOF")
    .replace(/<<-?\s*['"]?(\w+)['"]?\s*\n[\s\S]*?\n\1\b/g, '')
    // Remove double-quoted strings (may span lines)
    .replace(/"[^"]*"/g, '""')
    // Remove single-quoted strings
    .replace(/'[^']*'/g, "''")
    // Remove bun -e / node -e inline scripts (everything after -e "..." or -e '...')
    .replace(/\b(bun|node|deno)\s+-e\s+\S.*/g, '');

  // Split on shell operators to isolate individual command invocations,
  // then take only the first 6 tokens of each segment (enough to match
  // "git -C /some/path push --force origin" or "gh pr create" etc.).
  return stripped
    .split(/&&|\|\||;|\|/)
    .map(seg => seg.trim().split(/\s+/).slice(0, 6).join(' '))
    .filter(seg => seg.length > 0);
}

function isGitHubWriteCommand(command: string): { write: boolean; description: string } {
  const segments = extractCommandInvocations(command);
  for (const segment of segments) {
    for (const { pattern, description } of WRITE_PATTERNS) {
      if (pattern.test(segment)) {
        return { write: true, description };
      }
    }
  }
  return { write: false, description: '' };
}

function githubWriteSegments(command: string): Array<{ segment: string; description: string }> {
  const writes: Array<{ segment: string; description: string }> = [];
  for (const segment of extractCommandInvocations(command)) {
    for (const { pattern, description } of WRITE_PATTERNS) {
      if (pattern.test(segment)) {
        writes.push({ segment, description });
        break;
      }
    }
  }
  return writes;
}

function shellTokens(command: string): string[] {
  return command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map(t =>
    t.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
  ) ?? [];
}

function gitCurrentBranch(cwd: string): string | undefined {
  try {
    return execFileSync('git', ['-C', cwd, 'branch', '--show-current'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 500,
    }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function commandSegments(command: string): string[] {
  return extractCommandInvocations(command);
}

function parseGitPushTarget(command: string, cwd: string): string | undefined {
  for (const segment of commandSegments(command)) {
    const tokens = shellTokens(segment);
    const gitIndex = tokens.indexOf('git');
    if (gitIndex < 0) continue;

    let i = gitIndex + 1;
    while (i < tokens.length && tokens[i].startsWith('-')) {
      if (tokens[i] === '-C' && tokens[i + 1]) i += 2;
      else i++;
    }
    if (tokens[i] !== 'push') continue;
    i++;

    const args = tokens.slice(i).filter(t => !t.startsWith('-'));
    if (args.length >= 2) {
      const refspec = args[1];
      return refspec.includes(':') ? refspec.split(':').pop() || undefined : refspec;
    }
    return gitCurrentBranch(cwd);
  }
  return undefined;
}

function parseGhPrBase(command: string): string | undefined {
  for (const segment of commandSegments(command)) {
    const tokens = shellTokens(segment);
    const ghIndex = tokens.indexOf('gh');
    if (ghIndex < 0 || tokens[ghIndex + 1] !== 'pr') continue;
    const action = tokens[ghIndex + 2];
    if (!['create', 'edit', 'merge'].includes(action)) continue;

    const baseLong = tokens.indexOf('--base');
    if (baseLong >= 0 && tokens[baseLong + 1]) return tokens[baseLong + 1];
    const baseShort = tokens.indexOf('-B');
    if (baseShort >= 0 && tokens[baseShort + 1]) return tokens[baseShort + 1];
    if (action === 'create') return undefined;
  }
  return undefined;
}

function isAdaBranchSensitiveCommand(command: string): boolean {
  for (const segment of commandSegments(command)) {
    if (new RegExp(GIT_CMD.source + 'push\\b').test(segment)) return true;
    if (/\bgh\s+pr\s+(create|edit)\b/.test(segment)) return true;
  }
  return false;
}

function isGitPushCommand(command: string): boolean {
  return commandSegments(command).some(segment => new RegExp(GIT_CMD.source + 'push\\b').test(segment));
}

function isGhPrBaseCommand(command: string): boolean {
  return commandSegments(command).some(segment => /\bgh\s+pr\s+(create|edit)\b/.test(segment));
}

function protectedAdaPushTargets(expectedBranch: string, hardBlock: string[]): Set<string> {
  return new Set(['main', 'master', expectedBranch, ...hardBlock].filter(Boolean));
}

function loadAdaProcedure(cwd: string): { repoKey: string; config: AdaProcedureConfig } | null {
  const repoKey = basename(cwd);
  const procedurePath = join(ADA_PROCEDURES_DIR, `${repoKey}.json`);
  if (!existsSync(procedurePath)) return null;
  try {
    const config = JSON.parse(readFileSync(procedurePath, 'utf-8')) as AdaProcedureConfig;
    return { repoKey, config };
  } catch {
    return null;
  }
}

function checkAdaBranch(command: string, cwd: string): AdaBranchCheck | null {
  if (!isAdaBranchSensitiveCommand(command)) return null;

  const procedure = loadAdaProcedure(cwd);
  if (!procedure) return null;

  const expectedBranch = procedure.config.branch?.trim();
  if (!expectedBranch) return null;

  const targetBranch = parseGhPrBase(command) ?? parseGitPushTarget(command, cwd);
  const actualBranch = targetBranch ?? gitCurrentBranch(cwd);
  const mismatch = actualBranch !== undefined && actualBranch !== expectedBranch;
  const missingTargetForPrCreate = /\bgh\s+pr\s+create\b/.test(command) && !parseGhPrBase(command);
  const hardBlock = (procedure.config.guard?.hardBlock ?? []).includes(expectedBranch);
  const hardBlockTargets = procedure.config.guard?.hardBlock ?? [];
  const pushCommand = isGitPushCommand(command);
  const prBaseCommand = isGhPrBaseCommand(command);
  const protectedPushTarget = actualBranch !== undefined && protectedAdaPushTargets(expectedBranch, hardBlockTargets).has(actualBranch);
  const shouldBlockMismatch = prBaseCommand
    ? (mismatch || missingTargetForPrCreate)
    : pushCommand && mismatch && protectedPushTarget;
  const overrideEnv = procedure.config.guard?.overrideEnv || 'ADA_BRANCH_GUARD_OVERRIDE';

  return {
    config: procedure.config,
    repoKey: procedure.repoKey,
    expectedBranch,
    actualBranch,
    targetBranch,
    mismatch: shouldBlockMismatch,
    hardBlock,
    overrideEnv,
  };
}

function formatProcedureCard(config: AdaProcedureConfig): string[] {
  const steps = config.steps ?? [];
  if (steps.length === 0) return [];
  return [
    ``,
    `ADA procedure checklist:`,
    ...steps.map((step, idx) => `${idx + 1}. ${step}`),
  ];
}

function logAdaOverride(check: AdaBranchCheck, command: string, cwd: string): void {
  try {
    mkdirSync(join(BASE_DIR, 'MEMORY', 'STATE'), { recursive: true });
    appendFileSync(ADA_OVERRIDE_LOG, JSON.stringify({
      timestamp: new Date().toISOString(),
      repo: check.repoKey,
      cwd,
      branch: check.actualBranch ?? null,
      expected: check.expectedBranch,
      target: check.targetBranch ?? null,
      action: command.slice(0, 240),
      overrideEnv: check.overrideEnv,
    }) + '\n');
  } catch {
    // Override logging must not block the command path.
  }
}

function normalizeForHash(command: string): string {
  // Strip quoted content so body/message changes don't invalidate the approval.
  // The guard protects WHICH operation runs (create vs merge, which repo/branch),
  // not the cosmetic content (PR body, commit message).
  return command
    .replace(/<<-?\s*['"]?(\w+)['"]?\s*\n[\s\S]*?\n\1\b/g, '') // heredocs
    .replace(/"[^"]*"/g, '""')   // double-quoted strings
    .replace(/'[^']*'/g, "''")   // single-quoted strings
    .trim();
}

function optionValue(tokens: string[], longName: string, shortName?: string): string | undefined {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === longName && tokens[i + 1]) return tokens[i + 1];
    if (token.startsWith(`${longName}=`)) return token.slice(longName.length + 1);
    if (shortName && token === shortName && tokens[i + 1]) return tokens[i + 1];
  }
  return undefined;
}

function ghTarget(tokens: string[], start: number): string | undefined {
  for (let i = start; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token || token === '--') continue;
    if (token.startsWith('-')) {
      // Skip the value for common gh flags that take one argument. Unknown flags
      // are treated as flags only; if they have a value, the strict hash path is
      // safer than accidentally treating that value as a PR/issue target.
      if ([
        '--repo', '-R', '--body', '-b', '--body-file', '-F', '--template',
        '--jq', '-q', '--json', '--hostname',
      ].includes(token) && tokens[i + 1]) i++;
      continue;
    }
    return token;
  }
  return undefined;
}

function normalizeRepoScope(repo: string): string {
  return repo
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/^git@github\.com:/, '')
    .replace(/\.git$/, '')
    .trim();
}

function repoScopeForCommand(tokens: string[], cwd: string): string {
  const explicit = optionValue(tokens, '--repo', '-R');
  if (explicit) return normalizeRepoScope(explicit);

  try {
    const remote = execFileSync('git', ['-C', cwd, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 500,
    }).trim();
    if (remote) return normalizeRepoScope(remote);
  } catch {
    // Non-git directories still need isolation. cwd is stable enough to prevent
    // cross-repo approval bleed when no GitHub remote is available.
  }

  return `cwd:${cwd}`;
}

function stableCommentApprovalKey(command: string, cwd: string): string | null {
  const writes = githubWriteSegments(command);
  if (writes.length === 0) return null;

  const keys: string[] = [];
  for (const { segment } of writes) {
    const tokens = shellTokens(segment);
    const ghIndex = tokens.indexOf('gh');
    if (ghIndex < 0) return null;

    const area = tokens[ghIndex + 1];
    const action = tokens[ghIndex + 2];
    const target = ghTarget(tokens, ghIndex + 3);
    if (!target) return null;
    const repo = repoScopeForCommand(tokens, cwd);

    if (area === 'pr' && action === 'comment') {
      keys.push(`${repo}:gh pr comment ${target}`);
      continue;
    }

    if (area === 'issue' && action === 'comment') {
      keys.push(`${repo}:gh issue comment ${target}`);
      continue;
    }

    if (area === 'pr' && action === 'review' && tokens.includes('--comment')) {
      keys.push(`${repo}:gh pr review ${target} --comment`);
      continue;
    }

    // Keep PR approvals, request-changes, merges, pushes, deletes, etc. on the
    // strict full-command hash path.
    return null;
  }

  return `stable-comment-approval:v1:${keys.sort().join('|')}`;
}

function commandHash(command: string, cwd: string): string {
  return createHash('sha256')
    .update(stableCommentApprovalKey(command, cwd) ?? normalizeForHash(command))
    .digest('hex')
    .slice(0, 12);
}

function checkApprovalToken(command: string, cwd: string): boolean {
  if (!existsSync(APPROVALS_DIR)) return false;

  const hash = commandHash(command, cwd);
  const tokenPath = join(APPROVALS_DIR, `${hash}.json`);

  if (!existsSync(tokenPath)) return false;

  try {
    const token = JSON.parse(readFileSync(tokenPath, 'utf-8'));

    // Check TTL
    if (Date.now() > token.expires_at) {
      unlinkSync(tokenPath);
      console.error(`[GitHubWriteGuard] Token expired for: ${command.slice(0, 60)}`);
      return false;
    }

    // Valid — consume the token (one-shot)
    unlinkSync(tokenPath);
    console.error(`[GitHubWriteGuard] Token consumed. Allowing: ${command.slice(0, 60)}`);
    return true;
  } catch {
    return false;
  }
}

// Clean up expired tokens (opportunistic — runs occasionally)
function cleanExpiredTokens(): void {
  if (!existsSync(APPROVALS_DIR)) return;
  try {
    const now = Date.now();
    for (const file of readdirSync(APPROVALS_DIR)) {
      if (!file.endsWith('.json')) continue;
      const filePath = join(APPROVALS_DIR, file);
      try {
        const token = JSON.parse(readFileSync(filePath, 'utf-8'));
        if (now > token.expires_at) unlinkSync(filePath);
      } catch {
        // Corrupt token — delete it
        try { unlinkSync(filePath); } catch {}
      }
    }
  } catch {}
}

async function main() {
  let command = '';
  let cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  try {
    const raw = await Promise.race([
      Bun.stdin.text(),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
    ]).catch(() => '{}');

    const input: HookInput = JSON.parse(raw || '{}');
    command = input.tool_input?.command || '';
    cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();

    if (!command) {
      console.log(JSON.stringify({ continue: true }));
      process.exit(0);
    }

    // Clean expired tokens opportunistically (1-in-10 chance to avoid overhead)
    if (Math.random() < 0.1) cleanExpiredTokens();

    // Allow the approval script itself — it contains "git push" in its args but is not a write op
    if (command.includes('github-approve.ts')) {
      console.log(JSON.stringify({ continue: true }));
      process.exit(0);
    }

    const { write, description } = isGitHubWriteCommand(command);

    if (!write) {
      // Not a GitHub write operation — allow immediately
      console.log(JSON.stringify({ continue: true }));
      process.exit(0);
    }

    if (process.env.PAI_GITHUB_WRITE_GUARD_TEST_THROW_AFTER_DETECT === '1') {
      throw new Error('forced guard error after write detection');
    }

    const adaBranch = checkAdaBranch(command, cwd);
    const adaProcedureCard = adaBranch ? formatProcedureCard(adaBranch.config) : [];
    if (adaBranch?.mismatch && adaBranch.hardBlock) {
      if (process.env[adaBranch.overrideEnv] === '1') {
        logAdaOverride(adaBranch, command, cwd);
      } else {
        const reason = [
          `🚧 ADA BRANCH GUARD BLOCKED: ${adaBranch.repoKey}`,
          `Expected branch/base: ${adaBranch.expectedBranch}`,
          `Actual branch/base: ${adaBranch.actualBranch ?? 'unknown'}`,
          ``,
          `This repo has a hard-block branch rule. Use the expected branch/base, or set ` +
            `${adaBranch.overrideEnv}=1 only when intentionally bypassing the ADA guard.`,
          ...adaProcedureCard,
        ].join('\n');
        console.log(JSON.stringify({ decision: 'block', reason }));
        console.error(`[GitHubWriteGuard] ADA blocked ${adaBranch.repoKey}: expected ${adaBranch.expectedBranch}, got ${adaBranch.actualBranch ?? 'unknown'}`);
        process.exit(0);
      }
    }

    // GitHub write detected — check for approval token
    if (checkApprovalToken(command, cwd)) {
      // Approved — allow
      console.log(JSON.stringify({ continue: true }));
      process.exit(0);
    }

    // No approval — block and explain
    const shortCmd = command.slice(0, 120);
    const hash = commandHash(command, cwd);
    const reason = [
      `🔒 GITHUB WRITE BLOCKED: ${description}`,
      `Command: ${shortCmd}`,
      ...adaProcedureCard,
      ``,
      `This operation requires your explicit confirmation (owner access protection).`,
      ``,
      `TO PROCEED (all steps required):`,
      ``,
      `1. Use AskUserQuestion listing EVERY GitHub command you plan to run.`,
      `   Each command must be explicitly named — no vague "push and clean up".`,
      `   Example: "I need to run these GitHub operations:`,
      `   (a) git push origin main`,
      `   (b) git push -u origin v4.5.0-dev`,
      `   (c) git push origin --delete v4.4.0-dev"`,
      ``,
      `2. After you approve, generate a token using the hash shown below:`,
      `   bun ${APPROVE_SCRIPT} --hash "${hash}" "<your response>"`,
      ``,
      `   (Alternative for multiple commands: --batch "<your response>" "cmd1" "cmd2")`,
      ``,
      `3. Run the command immediately. Token is valid for 60s.`,
      ``,
      `⚠️  ONLY commands explicitly listed in AskUserQuestion may be approved.`,
      `    Do NOT add commands after approval. Do NOT skip AskUserQuestion.`,
      `    Any unlisted command will be blocked.`,
      ``,
      `Token hash: ${hash}`,
    ].join('\n');

    console.log(JSON.stringify({ decision: 'block', reason }));
    console.error(`[GitHubWriteGuard] Blocked (${description}): ${shortCmd}`);
    process.exit(0);
  } catch (err) {
    console.error(`[GitHubWriteGuard] Error: ${err}`);
    // Fail closed for detected GitHub writes: owner-access mutations must not pass just because
    // a later guard check failed. Unknown/read-only commands still fail open to avoid wedging tooling.
    const writeInfo = command ? isGitHubWriteCommand(command) : { write: false, description: '' };
    if (writeInfo.write) {
      console.log(JSON.stringify({
        decision: 'block',
        reason: `🔒 GITHUB WRITE BLOCKED: guard error while validating ${writeInfo.description}. Fail-closed; rerun after fixing the hook error.`,
      }));
      process.exit(0);
    }
    console.log(JSON.stringify({ continue: true }));
    process.exit(0);
  }
}

main().catch((err) => { console.error(`[GitHubWriteGuard] Error:`, err); process.exit(0); });
