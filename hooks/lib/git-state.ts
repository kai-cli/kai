/**
 * git-state.ts — pure parser for `git status --porcelain=v2 --branch` output.
 *
 * Extracted from statusline.ts so the count logic is unit-testable WITHOUT executing the statusline
 * (statusline.ts runs its render at top-level on import — not import.meta.main guarded). The spawnSync
 * I/O stays in statusline; this is just the parse.
 */

export interface GitState {
  ahead: number; // commits ahead of upstream (0 if no upstream)
  dirty: number; // count of changed/renamed/unmerged/untracked entries
}

/**
 * Parse porcelain=v2 --branch output.
 * - ahead: from `# branch.ab +A -B` (0 if the header is absent, e.g. no upstream)
 * - dirty: entries whose first char is '1' (changed), '2' (renamed/copied), 'u' (unmerged),
 *   or '?' (untracked). Header lines start with '#' and never count.
 */
export function parseGitState(stdout: string): GitState {
  let ahead = 0;
  let dirty = 0;
  for (const line of stdout.split('\n')) {
    if (line.startsWith('# branch.ab ')) {
      const m = line.match(/\+(\d+)\s+-(\d+)/);
      if (m) ahead = parseInt(m[1], 10) || 0;
    } else if (line && (line[0] === '1' || line[0] === '2' || line[0] === 'u' || line[0] === '?')) {
      dirty++;
    }
  }
  return { ahead, dirty };
}
