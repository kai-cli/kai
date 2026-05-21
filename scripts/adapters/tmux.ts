/**
 * tmux terminal adapter — KAI default.
 * Uses tmux list-panes to find active claude processes.
 */

import { spawn } from "bun";
import type { TerminalAdapter } from "./terminal";

export class TmuxAdapter implements TerminalAdapter {
  name = "tmux";

  async isAvailable(): Promise<boolean> {
    try {
      const p = spawn({ cmd: ["which", "tmux"], stdout: "pipe", stderr: "pipe" });
      await p.exited;
      return p.exitCode === 0;
    } catch { return false; }
  }

  async getActiveSessions(): Promise<Set<string>> {
    const active = new Set<string>();
    try {
      // Get all pane PIDs from tmux
      const p = spawn({ cmd: ["tmux", "list-panes", "-a", "-F", "#{pane_pid}"], stdout: "pipe", stderr: "pipe" });
      const out = await new Response(p.stdout).text();
      await p.exited;

      const pids = out.trim().split("\n").map(l => l.trim()).filter(Boolean);
      for (const pid of pids) {
        // Check if any child process is `claude`
        try {
          const ps = spawn({ cmd: ["ps", "--ppid", pid, "-o", "comm="], stdout: "pipe", stderr: "pipe" });
          const psOut = await new Response(ps.stdout).text();
          await ps.exited;
          if (psOut.includes("claude")) active.add(pid);
        } catch {}
      }
    } catch {}
    return active;
  }

  async launchSession(opts: { workDir: string; command: string; title?: string }): Promise<{ success: boolean; error?: string }> {
    try {
      const windowName = (opts.title || "claude").slice(0, 30).replace(/[^a-zA-Z0-9 _-]/g, "");
      const cmd = `cd ${JSON.stringify(opts.workDir)} && ${opts.command}`;
      const p = spawn({ cmd: ["tmux", "new-window", "-n", windowName, cmd], stdout: "pipe", stderr: "pipe" });
      await p.exited;
      return p.exitCode === 0 ? { success: true } : { success: false, error: "tmux new-window failed" };
    } catch (e: any) {
      return { success: false, error: String(e) };
    }
  }
}
