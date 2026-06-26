#!/usr/bin/env bun
import { join } from "path";
import { checkEnvironment, formatStatus } from "./lib/env-check";

const PAI_DIR = process.env.PAI_DIR ?? join(process.env.HOME!, ".claude");

// SessionStart provides cwd on stdin; fall back to CLAUDE_PROJECT_DIR / process.cwd().
let cwd = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
try {
  const raw = await Promise.race([
    Bun.stdin.text(),
    new Promise<string>((resolve) => setTimeout(() => resolve(""), 500)),
  ]);
  if (raw && raw.trim()) {
    const input = JSON.parse(raw);
    if (input.cwd) cwd = input.cwd;
  }
} catch { /* no stdin — use fallback cwd */ }

const status = checkEnvironment(PAI_DIR, cwd);

// CWD mismatch is its own line; critical env issues take precedence but both can show.
const lines: string[] = [];
if (status.critical) lines.push(`⚠️ ${status.critical}`, formatStatus(status));
if (status.cwdWarning) lines.push(status.cwdWarning);
if (status.liveCheckoutWarning) lines.push(status.liveCheckoutWarning);

if (lines.length > 0) {
  console.log(JSON.stringify({ additionalContext: lines.join("\n") }));
} else {
  // Healthy + in a real project — silent pass.
  process.exit(0);
}
