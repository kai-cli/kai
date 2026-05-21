/**
 * Terminal adapter interface + factory.
 * Abstracts iTerm (PAI) and tmux (KAI) session detection and launching.
 */

export interface TerminalAdapter {
  name: string;
  getActiveSessions(): Promise<Set<string>>;
  launchSession(opts: { workDir: string; command: string; title?: string }): Promise<{ success: boolean; error?: string }>;
  isAvailable(): Promise<boolean>;
}

export async function createAdapter(name: string): Promise<TerminalAdapter> {
  switch (name) {
    case "iterm": {
      const { ITermAdapter } = await import("./iterm");
      return new ITermAdapter();
    }
    case "tmux": {
      const { TmuxAdapter } = await import("./tmux");
      return new TmuxAdapter();
    }
    default: {
      const { ITermAdapter } = await import("./iterm");
      return new ITermAdapter();
    }
  }
}
