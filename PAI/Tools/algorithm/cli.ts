/**
 * algorithm/cli.ts - CLI argument parsing and help text
 */

import type { ParsedArgs } from "./types";

// ─── CLI Argument Parsing ────────────────────────────────────────────────────

export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const result: ParsedArgs = { subcommand: null, mode: null, prdPath: null, maxIterations: null, agentCount: 1, title: null, effortLevel: null };

  // Check for subcommand (first arg that isn't a flag)
  const subcommands = ["status", "pause", "resume", "stop", "new"];
  if (args.length > 0 && subcommands.includes(args[0])) {
    result.subcommand = args[0];
  }

  // Parse flags
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === "-m" || arg === "--mode") && i + 1 < args.length) {
      result.mode = args[++i];
    } else if ((arg === "-p" || arg === "--prd") && i + 1 < args.length) {
      result.prdPath = args[++i];
    } else if ((arg === "-n" || arg === "--max") && i + 1 < args.length) {
      result.maxIterations = parseInt(args[++i], 10);
    } else if ((arg === "-a" || arg === "--agents") && i + 1 < args.length) {
      result.agentCount = parseInt(args[++i], 10);
    } else if ((arg === "-t" || arg === "--title") && i + 1 < args.length) {
      result.title = args[++i];
    } else if ((arg === "-e" || arg === "--effort") && i + 1 < args.length) {
      result.effortLevel = args[++i];
    } else if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    }
  }

  // Validate agent count
  if (result.agentCount < 1 || result.agentCount > 16 || isNaN(result.agentCount)) {
    console.error(`\x1b[31mError:\x1b[0m Invalid agent count: ${result.agentCount}. Must be between 1 and 16.`);
    process.exit(1);
  }

  return result;
}

export function printHelp(): void {
  console.log(`
\x1b[36mTHE ALGORITHM\x1b[0m — PAI Algorithm Runner (v1.0.0)

Usage:
  algorithm -m <mode> -p <PRD> [-n N] [-a N]   Run the Algorithm against a PRD
  algorithm new -t <title> [-e <effort>] [-p <dir>]  Create a new PRD
  algorithm status [-p <PRD>]                   Show PRD status
  algorithm pause -p <PRD>                      Pause a running loop
  algorithm resume -p <PRD>                     Resume a paused loop
  algorithm stop -p <PRD>                       Stop a loop

Modes:
  loop          Autonomous iteration — no human interaction
  interactive   Full claude session with PRD context loaded

Flags:
  -m, --mode <mode>     Execution mode: loop or interactive
  -p, --prd <path>      PRD file path or PRD ID (or output dir for 'new')
  -n, --max <N>         Max iterations (loop mode only, default: 128)
  -a, --agents <N>      Parallel agents per iteration (1-16, default: 1)
  -t, --title <title>   PRD title (required for 'new')
  -e, --effort <level>  Effort level: Standard, Extended, etc. (default: Standard)
  -h, --help            Show this help

PRD Resolution:
  Full path     ~/.claude/MEMORY/WORK/auth/PRD-20260207-auth.md
  PRD ID        PRD-20260207-auth (searches MEMORY/WORK/ and ~/Projects/*/.prd/)
  Project path  /path/to/project/.prd/PRD-20260213-feature.md

Examples:
  algorithm new -t "Build authentication system" -e Extended
  algorithm new -t "Fix login bug" -p ./project/.prd/
  algorithm -m loop -p PRD-20260213-surface -n 20
  algorithm -m loop -p PRD-20260213-surface -n 20 -a 4     # 4 parallel agents
  algorithm -m interactive -p PRD-20260213-surface
  algorithm status
  algorithm status -p PRD-20260213-surface
`);
}
