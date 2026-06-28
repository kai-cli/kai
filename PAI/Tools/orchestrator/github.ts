import { type CheckState } from './policy';
import { parseOrchestratorComment, type OrchestratorCommentState } from './comments';
import { type WorkInput, type WorkItem } from './schema';

export interface PullRequestRef {
  repo: string;
  number: number;
  url: string;
  head: string;
  base: string;
  labels: string[];
}

export interface PullRequestContext {
  pullRequest: PullRequestRef;
  diff: string;
  changedPaths: string[];
  checkState: CheckState;
  comments: string[];
  paiComment?: OrchestratorCommentState;
}

export interface GitHubClient {
  getPullRequest(workItem: WorkItem): Promise<PullRequestContext>;
  upsertComment(markdown: string, options?: GitHubWriteOptions): Promise<void>;
  pushFixes(options?: GitHubWriteOptions): Promise<void>;
  mergePullRequest(options?: GitHubWriteOptions): Promise<void>;
}

export interface GitHubFixtureOptions {
  diff?: string;
  checkState?: CheckState;
  labels?: string[];
  comments?: string[];
  allowLiveWrites?: boolean;
  liveWriteToken?: string;
}

export interface GitHubWriteOptions {
  allowLiveWrites?: boolean;
  liveWriteToken?: string;
}

export const REQUIRED_LIVE_WRITE_TOKEN = 'PAI_ORCHESTRATOR_LIVE_WRITE';

function githubInput(workItem: WorkItem): WorkInput | undefined {
  return workItem.inputs.find((input) => input.type === 'github-pr');
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string, fallback: string): string {
  const value = metadata?.[key];
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function metadataNumber(metadata: Record<string, unknown> | undefined, key: string, fallback: number): number {
  const value = metadata?.[key];
  return typeof value === 'number' && Number.isInteger(value) ? value : fallback;
}

function parsePaiComment(comments: string[]): OrchestratorCommentState | undefined {
  for (const comment of comments) {
    const parsed = parseOrchestratorComment(comment);
    if (parsed.state) return parsed.state;
  }
  return undefined;
}

function requireLiveWrite(action: string, options: GitHubWriteOptions | undefined): void {
  if (options?.allowLiveWrites !== true || options.liveWriteToken !== REQUIRED_LIVE_WRITE_TOKEN) {
    throw new Error(`${action} requires explicit live GitHub write approval.`);
  }
}

export function changedPathsFromDiff(diff: string): string[] {
  const paths = new Set<string>();
  for (const line of diff.split('\n')) {
    const diffMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (diffMatch) {
      const [, oldPath, newPath] = diffMatch;
      paths.add(newPath === '/dev/null' ? oldPath : newPath);
      continue;
    }
    const fileMatch = line.match(/^(\+\+\+|---) (?:[ab]\/)?(.+)$/);
    if (fileMatch && fileMatch[2] !== '/dev/null') paths.add(fileMatch[2]);
  }
  return [...paths].sort();
}

export class FixtureGitHubClient implements GitHubClient {
  readonly writes: string[] = [];
  private readonly options: GitHubFixtureOptions;

  constructor(options: GitHubFixtureOptions = {}) {
    this.options = options;
  }

  async getPullRequest(workItem: WorkItem): Promise<PullRequestContext> {
    const input = githubInput(workItem);
    if (!input) throw new Error('Work item requires a github-pr input.');
    const metadata = input.metadata;
    const comments = this.options.comments ?? [];
    const repo = metadataString(metadata, 'repo', 'example/project');
    const number = metadataNumber(metadata, 'number', 0);
    const diff = this.options.diff ?? [
      'diff --git a/src/example.ts b/src/example.ts',
      'index 1111111..2222222 100644',
      '--- a/src/example.ts',
      '+++ b/src/example.ts',
      '@@ -1,3 +1,4 @@',
      ' export function example() {',
      '+  return true;',
      ' }',
    ].join('\n');
    return {
      pullRequest: {
        repo,
        number,
        url: input.source,
        head: metadataString(metadata, 'head', 'feature/example'),
        base: metadataString(metadata, 'base', 'main'),
        labels: this.options.labels ?? [],
      },
      diff,
      changedPaths: changedPathsFromDiff(diff),
      checkState: this.options.checkState ?? 'green',
      comments,
      paiComment: parsePaiComment(comments),
    };
  }

  async upsertComment(markdown: string, options?: GitHubWriteOptions): Promise<void> {
    requireLiveWrite('upsertComment', options);
    this.writes.push(markdown);
  }

  async pushFixes(options?: GitHubWriteOptions): Promise<void> {
    requireLiveWrite('pushFixes', options);
    this.writes.push('pushFixes');
  }

  async mergePullRequest(options?: GitHubWriteOptions): Promise<void> {
    requireLiveWrite('mergePullRequest', options);
    this.writes.push('mergePullRequest');
  }
}

export function fixtureGitHubClient(options: GitHubFixtureOptions = {}): FixtureGitHubClient {
  return new FixtureGitHubClient(options);
}
