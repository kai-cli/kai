#!/usr/bin/env bun
/**
 * ============================================================================
 * THE ALGORITHM CLI — Run the PAI Algorithm in Loop or Interactive mode
 * ============================================================================
 *
 * A unified CLI for executing Algorithm sessions against PRDs.
 *
 * MODES:
 *   loop        — Autonomous iteration via `claude -p` (SDK). Runs until all
 *                 ISC criteria pass or maxIterations reached. No human needed.
 *   interactive — Launches a full interactive `claude` session with PRD context
 *                 loaded as the initial prompt. Human-in-the-loop.
 *
 * DASHBOARD INTEGRATION (v0.5.9):
 *   - Creates a persistent algorithm state entry in MEMORY/STATE/algorithms/
 *   - Syncs criteria status from PRD checkboxes after each iteration (loop mode)
 *   - Registers in session-names.json for dashboard display
 *   - Sends voice notifications at key moments
 *   - Same state store a web interface would read — unified mechanism
 *
 * USAGE:
 *   algorithm -m loop -p <PRD> [-n 128]        Autonomous loop execution
 *   algorithm -m interactive -p <PRD>           Interactive claude session
 *   algorithm new -t <title> [-e <effort>]      Create a new PRD
 *   algorithm status [-p <PRD>]                 Show PRD status
 *   algorithm pause -p <PRD>                    Pause a running loop
 *   algorithm resume -p <PRD>                   Resume a paused loop
 *   algorithm stop -p <PRD>                     Stop a loop
 *
 * EXAMPLES:
 *   algorithm -m loop -p ~/.claude/MEMORY/WORK/auth/PRD-20260207-auth.md
 *   algorithm -m loop -p /path/to/project/.prd/PRD-20260213-feature.md -n 20
 *   algorithm -m interactive -p PRD-20260213-surface
 *   algorithm new -t "Build auth system" -e Extended
 *   algorithm status
 *   algorithm pause -p PRD-20260207-auth
 */

import { parseArgs, printHelp } from "./cli";
import { runLoop, pauseLoop, resumeLoop, stopLoop } from "./loop";
import { runInteractive } from "./interactive";
import { createNewPRD, showStatus, resolvePRDPath } from "./prd";

// ─── Main ────────────────────────────────────────────────────────────────────

const parsed = parseArgs(process.argv);

if (parsed.subcommand) {
  // Subcommand mode: status, pause, resume, stop
  const prdRef = parsed.prdPath;

  switch (parsed.subcommand) {
    case "status":
      showStatus(prdRef ? resolvePRDPath(prdRef) : undefined);
      break;
    case "new": {
      if (!parsed.title) {
        console.error("Usage: algorithm new -t <title> [-e <effort>] [-p <output-dir>]");
        process.exit(1);
      }
      const prdPath = createNewPRD(parsed.title, parsed.effortLevel || "Standard", prdRef || undefined);
      console.log(`\x1b[32m✓\x1b[0m Created PRD: ${prdPath}`);
      console.log(`\n  Run with:  algorithm -m interactive -p ${prdPath}`);
      console.log(`  Or loop:   algorithm -m loop -p ${prdPath} -n 20`);
      break;
    }
    case "pause":
      if (!prdRef) { console.error("Usage: algorithm pause -p <PRD>"); process.exit(1); }
      pauseLoop(resolvePRDPath(prdRef));
      break;
    case "resume":
      if (!prdRef) { console.error("Usage: algorithm resume -p <PRD>"); process.exit(1); }
      await resumeLoop(resolvePRDPath(prdRef));
      break;
    case "stop":
      if (!prdRef) { console.error("Usage: algorithm stop -p <PRD>"); process.exit(1); }
      stopLoop(resolvePRDPath(prdRef));
      break;
  }
} else if (parsed.mode) {
  // Run mode: -m loop or -m interactive
  if (!parsed.prdPath) {
    console.error("Error: -p <PRD> is required when using -m <mode>");
    console.error("Usage: algorithm -m <mode> -p <PRD> [-n N]");
    process.exit(1);
  }

  const resolvedPath = resolvePRDPath(parsed.prdPath);

  switch (parsed.mode) {
    case "loop":
      await runLoop(resolvedPath, parsed.maxIterations ?? undefined, parsed.agentCount);
      break;
    case "interactive":
      runInteractive(resolvedPath);
      break;
    default:
      console.error(`Unknown mode: ${parsed.mode}. Use 'loop' or 'interactive'.`);
      process.exit(1);
  }
} else {
  printHelp();
}
