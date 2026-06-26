#!/usr/bin/env bun
/**
 * run-session-end-composite.ts — manual SessionEndComposite launcher.
 *
 * /end is a checklist skill, not the native Claude SessionEnd lifecycle event. This tool gives operators a
 * deterministic way to run the same composite hook against a known transcript when validating cleanup.
 *
 * Read/write behavior is exactly the hook's behavior: this script only builds a valid hook payload and
 * forwards it to hooks/SessionEndComposite.hook.ts.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';

interface Args {
  transcriptPath?: string;
  sessionId?: string;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--transcript-path') args.transcriptPath = argv[++i];
    else if (arg.startsWith('--transcript-path=')) args.transcriptPath = arg.slice('--transcript-path='.length);
    else if (arg === '--session-id') args.sessionId = argv[++i];
    else if (arg.startsWith('--session-id=')) args.sessionId = arg.slice('--session-id='.length);
  }
  return args;
}

export function buildPayload(transcriptPath: string, sessionId?: string): Record<string, unknown> {
  return {
    session_id: sessionId || basename(transcriptPath, '.jsonl'),
    transcript_path: transcriptPath,
    hook_event_name: 'SessionEnd',
    hookProtocolVersion: '1.0',
  };
}

function usage(): never {
  console.error('Usage: bun scripts/run-session-end-composite.ts --transcript-path <transcript.jsonl> [--session-id <id>]');
  process.exit(2);
}

function main(): void {
  const args = parseArgs(Bun.argv.slice(2));
  if (!args.transcriptPath) usage();
  if (!existsSync(args.transcriptPath)) {
    console.error(`Transcript not found: ${args.transcriptPath}`);
    process.exit(2);
  }

  const repo = process.env.PAI_DIR ?? join(import.meta.dir, '..');
  const hook = join(repo, 'hooks', 'SessionEndComposite.hook.ts');
  const payload = JSON.stringify(buildPayload(args.transcriptPath, args.sessionId));
  const result = spawnSync('bun', [hook], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, PAI_DIR: repo },
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

if (import.meta.main) main();
