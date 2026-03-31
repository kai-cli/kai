#!/usr/bin/env bun
/**
 * BoardAutoStart.hook.ts - Auto-start PAI Board if not running
 *
 * TRIGGER: SessionStart
 *
 * Checks if board.ts is running on localhost:3333.
 * If not, starts it in a detached background process.
 * Non-blocking — doesn't delay session startup.
 */

const PORT = 3333;
const BOARD_SCRIPT = `${process.env.HOME}/.claude/scripts/board.ts`;

async function main(): Promise<void> {
  // Check if board is already running
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 500);
    const res = await fetch(`http://localhost:${PORT}/api/work`, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      // Board is running
      console.log(JSON.stringify({ continue: true }));
      return;
    }
  } catch {
    // Board not running — start it
  }

  try {
    const proc = Bun.spawn(["bun", "run", BOARD_SCRIPT], {
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
    });
    proc.unref(); // Detach from parent process
  } catch {
    // Failed to start — non-fatal
  }

  console.log(JSON.stringify({ continue: true }));
}

main().catch(() => {
  console.log(JSON.stringify({ continue: true }));
});
