/**
 * risk-classifier.ts — Deterministic command risk classification
 *
 * Classifies shell commands into risk categories for SecurityValidator.
 * All classifications are heuristic boolean flags — no probabilistic scoring.
 */

export interface CommandRisk {
  command: string;
  is_read_only: boolean;   // Safe to auto-approve: ls, cat, grep, git status/log/diff
  is_risky: boolean;       // Requires attention: rm (no -rf), kill, git push, curl POST
  is_destructive: boolean; // Must confirm: rm -rf, git push --force, DROP TABLE, redirect to real file
  uses_pager: boolean;     // Would open interactive pager: less, more, man, git log (no --no-pager)
  modifies_git: boolean;   // Changes git state: commit, push, reset, rebase, merge, cherry-pick, tag
}

// ── Token extraction ──────────────────────────────────────────

function tokens(cmd: string): string[] {
  return cmd.trim().split(/\s+/).filter(Boolean);
}

function hasFlag(cmd: string, ...flags: string[]): boolean {
  const toks = tokens(cmd);
  return flags.some(f => toks.includes(f));
}

function getSubcommand(cmd: string, baseCmd: string): string | null {
  const toks = tokens(cmd);
  const idx = toks.findIndex(t => t === baseCmd || t.endsWith(`/${baseCmd}`));
  if (idx === -1) return null;
  // Find first non-flag token after the base command
  for (let i = idx + 1; i < toks.length; i++) {
    if (!toks[i].startsWith('-')) return toks[i];
  }
  return null;
}

// ── Classification helpers ────────────────────────────────────

const READ_ONLY_CMDS = new Set([
  'ls', 'la', 'll', 'cat', 'less', 'more', 'head', 'tail',
  'grep', 'egrep', 'fgrep', 'rg', 'ag',
  'find', 'locate', 'which', 'whereis', 'type',
  'echo', 'printf', 'wc', 'sort', 'uniq', 'cut', 'awk', 'sed',
  'diff', 'cmp',
  'file', 'stat', 'du', 'df', 'pwd',
  'env', 'printenv', 'export',
  'ps', 'top', 'htop', 'pgrep',
  'date', 'uname', 'whoami', 'id', 'hostname',
  'curl', 'wget',
]);

const READ_ONLY_GIT_SUBCMDS = new Set([
  'status', 'log', 'diff', 'show', 'branch', 'remote',
  'describe', 'shortlog', 'blame', 'stash',
  'ls-files', 'ls-tree', 'rev-parse', 'cat-file',
]);

const MODIFY_GIT_SUBCMDS = new Set([
  'commit', 'push', 'reset', 'rebase', 'merge',
  'cherry-pick', 'tag', 'am', 'apply', 'fetch',
  'pull', 'clone', 'init', 'submodule',
]);

const RISKY_CMDS = new Set([
  'rm', 'rmdir',
  'kill', 'pkill', 'killall',
  'chmod', 'chown', 'chgrp',
  'mv', 'cp',
  'truncate', 'shred',
]);

const PAGER_CMDS = new Set(['less', 'more', 'man', 'info']);

// ── Redirect analysis ─────────────────────────────────────────

// Returns true if the command redirects output to a real file (not /dev/null or /dev/stdout)
function redirectsToRealFile(cmd: string): boolean {
  // Match > or >> followed by a path
  const redirectMatch = cmd.match(/>>?\s*(\S+)/);
  if (!redirectMatch) return false;
  const target = redirectMatch[1];
  // /dev/null and /dev/stdout are safe
  if (target === '/dev/null' || target === '/dev/stdout' || target === '/dev/stderr') return false;
  return true;
}

// ── Main classifier ───────────────────────────────────────────

export function classifyCommand(command: string): CommandRisk {
  const cmd = command.trim();
  const toks = tokens(cmd);
  const baseCmd = toks[0]?.split('/').pop() ?? '';

  let is_read_only = false;
  let is_risky = false;
  let is_destructive = false;
  let uses_pager = false;
  let modifies_git = false;

  // Git commands
  if (baseCmd === 'git') {
    const sub = getSubcommand(cmd, 'git');

    if (sub && READ_ONLY_GIT_SUBCMDS.has(sub)) {
      is_read_only = true;
      // git log opens a pager unless --no-pager or --oneline or piped
      if (sub === 'log' && !hasFlag(cmd, '--no-pager') && !cmd.includes('|')) {
        uses_pager = true;
        is_read_only = false; // pager makes it interactive, not cleanly read-only
      }
    }

    if (sub && MODIFY_GIT_SUBCMDS.has(sub)) {
      modifies_git = true;
      is_risky = true;
    }

    // git push without --force is risky; with --force is destructive
    if (sub === 'push') {
      if (hasFlag(cmd, '--force', '-f', '--force-with-lease')) {
        is_destructive = true;
      }
    }

    // git reset --hard is destructive
    if (sub === 'reset' && hasFlag(cmd, '--hard')) {
      is_destructive = true;
    }

    // git checkout -- <file> / git restore are risky (discards working changes)
    if (sub === 'checkout' || sub === 'restore') {
      is_risky = true;
    }

    // git clean -f/-fd is destructive
    if (sub === 'clean' && hasFlag(cmd, '-f', '-fd', '-fx')) {
      is_destructive = true;
    }
  }

  // rm variants
  else if (baseCmd === 'rm') {
    is_risky = true;
    // rm -rf or rm -r -f is destructive
    if (hasFlag(cmd, '-rf', '-fr') || (hasFlag(cmd, '-r', '-R') && hasFlag(cmd, '-f'))) {
      is_destructive = true;
    }
  }

  // Pager commands
  else if (PAGER_CMDS.has(baseCmd)) {
    uses_pager = true;
  }

  // curl/wget — GET is read-only; POST/PUT/DELETE is risky
  else if (baseCmd === 'curl' || baseCmd === 'wget') {
    const method = (() => {
      const xIdx = toks.indexOf('-X');
      if (xIdx !== -1 && toks[xIdx + 1]) return toks[xIdx + 1].toUpperCase();
      const methodIdx = toks.findIndex(t => t.startsWith('--request='));
      if (methodIdx !== -1) return toks[methodIdx].split('=')[1]?.toUpperCase() ?? 'GET';
      return 'GET';
    })();
    if (method === 'GET' || method === 'HEAD') {
      is_read_only = true;
    } else {
      is_risky = true;
    }
  }

  // Other read-only commands
  else if (READ_ONLY_CMDS.has(baseCmd) && !is_risky && !is_destructive) {
    is_read_only = true;
  }

  // Other risky commands
  else if (RISKY_CMDS.has(baseCmd)) {
    is_risky = true;
  }

  // SQL destructive patterns (database commands)
  if (/\b(DROP\s+TABLE|DROP\s+DATABASE|TRUNCATE|DELETE\s+FROM)\b/i.test(cmd)) {
    is_destructive = true;
    is_read_only = false;
  }

  // Redirect to real file makes any command non-read-only and potentially destructive
  if (redirectsToRealFile(cmd)) {
    is_read_only = false;
    is_destructive = true;
  }

  // Sanity: destructive implies risky; destructive and risky are mutually exclusive with read_only
  if (is_destructive) {
    is_risky = true;
    is_read_only = false;
  }

  return { command: cmd, is_read_only, is_risky, is_destructive, uses_pager, modifies_git };
}
