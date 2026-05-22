/**
 * iTerm2 terminal adapter — PAI default.
 * Extracts session detection + launch logic from board.ts.
 */

import { readdir, readFile, stat } from "fs/promises";
import { join } from "path";
import { spawn } from "bun";
import type { TerminalAdapter } from "./terminal";

const HOME = process.env.HOME!;
const STATE_DIR = join(HOME, ".claude", "MEMORY", "STATE");

export class ITermAdapter implements TerminalAdapter {
  name = "iterm";

  async isAvailable(): Promise<boolean> {
    try {
      const p = spawn({ cmd: ["osascript", "-e", 'tell application "iTerm" to version'], stdout: "pipe", stderr: "pipe" });
      await p.exited;
      return p.exitCode === 0;
    } catch { return false; }
  }

  async getActiveSessions(): Promise<Set<string>> {
    const active = new Set<string>();
    const itermDir = join(STATE_DIR, "iterm-sessions");

    try {
      const files = await readdir(itermDir);
      // Group by TTY, keep only most recent session per TTY
      const ttyToSession = new Map<string, { uuid: string; mtime: number }>();
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        try {
          const filePath = join(itermDir, f);
          const content = await readFile(filePath, "utf-8");
          const data = JSON.parse(content);
          if (!data.tty) continue;
          const fileStat = await stat(filePath);
          const existing = ttyToSession.get(data.tty);
          if (!existing || fileStat.mtimeMs > existing.mtime) {
            ttyToSession.set(data.tty, { uuid: f.replace(".json", ""), mtime: fileStat.mtimeMs });
          }
        } catch {}
      }

      // Check if claude is running on each TTY
      for (const [tty, { uuid }] of ttyToSession) {
        try {
          const result = spawn({ cmd: ["ps", "-t", tty.replace("/dev/", ""), "-o", "comm="], stdout: "pipe", stderr: "pipe" });
          const output = await new Response(result.stdout).text();
          await result.exited;
          const procs = output.trim().split("\n").map(l => l.trim());
          if (procs.some(p => p === "claude" || p.includes("claude"))) {
            active.add(uuid);
          }
        } catch {}
      }
    } catch {}

    // Also check algorithms dir (headless/non-iTerm sessions)
    try {
      const algDir = join(STATE_DIR, "algorithms");
      const algFiles = await readdir(algDir);
      for (const f of algFiles) {
        active.add(f.replace(".json", ""));
      }
    } catch {}

    return active;
  }

  async launchSession(opts: { workDir: string; command: string; title?: string }): Promise<{ success: boolean; error?: string }> {
    try {
      const escOsa = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const shellCmd = `cd ${opts.workDir} && ${opts.command}`;
      const osaScript = `
        tell application "iTerm"
          tell current window
            create tab with default profile
            tell current session
              write text "${escOsa(shellCmd)}"
            end tell
          end tell
        end tell
      `;
      const proc = spawn({ cmd: ["osascript", "-e", osaScript], stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      if (proc.exitCode !== 0) {
        const err = await new Response(proc.stderr).text();
        console.error(`[board] iTerm launch failed: ${err}`);
        return { success: false, error: err };
      }
      return { success: true };
    } catch (e: any) {
      console.error(`[board] iTerm launch error: ${e}`);
      return { success: false, error: String(e) };
    }
  }
}
