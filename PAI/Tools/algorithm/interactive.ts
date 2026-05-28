/**
 * algorithm/interactive.ts - Interactive mode execution
 */

import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { spawn } from "child_process";
import { readPRD, countCriteria, extractPRDTitle, voiceNotify } from "./state";
import { buildInteractivePrompt } from "./prompts";

// ─── Interactive Mode ────────────────────────────────────────────────────────

export function runInteractive(prdPath: string): void {
  const absPath = resolve(prdPath);
  if (!existsSync(absPath)) {
    console.error(`\x1b[31mError:\x1b[0m PRD not found: ${absPath}`);
    process.exit(1);
  }

  const { content } = readPRD(absPath);
  const prdTitle = extractPRDTitle(content);
  const criteria = countCriteria(content);
  const prompt = buildInteractivePrompt(absPath);

  voiceNotify(`Starting interactive session on ${prdTitle}.`);

  console.log(`\x1b[36m○\x1b[0m THE ALGORITHM (interactive mode) — ${prdTitle}`);
  console.log(`  PRD: ${absPath}`);
  console.log(`  Progress: ${criteria.passing}/${criteria.total}`);
  console.log(`  Launching claude...\n`);

  // Launch interactive claude session with PRD context
  const child = spawn("claude", [
    prompt,
    "--allowedTools", "Edit,Write,Bash,Read,Glob,Grep,WebFetch,WebSearch,Task,TaskCreate,TaskUpdate,TaskList,NotebookEdit",
  ], {
    stdio: "inherit",
    cwd: dirname(absPath),
    env: { ...process.env, CLAUDECODE: undefined },
  });

  child.on("exit", (code) => {
    if (code === 0) {
      // Re-read PRD to show final state
      try {
        const post = readPRD(absPath);
        const postCriteria = countCriteria(post.content);
        console.log(`\n\x1b[36m○\x1b[0m Session ended — ${postCriteria.passing}/${postCriteria.total} criteria passing`);
      } catch {}
    }
    process.exit(code ?? 0);
  });
}
