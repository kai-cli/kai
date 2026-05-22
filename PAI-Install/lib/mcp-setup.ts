/**
 * MCP server configuration for installer and kai-setup.
 * Writes to preferences.local.jsonc (machine-specific, gitignored).
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

export interface McpServerDef {
  name: string;
  type: "remote" | "stdio";
  description: string;
  url?: string;
  command?: string;
  args?: string[];
  postNote?: string;
}

export const AVAILABLE_SERVERS: McpServerDef[] = [
  {
    name: "Cloudflare",
    type: "remote",
    url: "https://mcp.cloudflare.com/sse",
    description: "Workers, KV, R2, DNS management",
    postNote: "Requires OAuth — on first session, Claude Code will open a browser login.",
  },
  {
    name: "GitHub",
    type: "stdio",
    command: "npx",
    args: ["-y", "@anthropic-ai/mcp-github"],
    description: "PRs, issues, code search (requires GITHUB_TOKEN)",
  },
  {
    name: "Playwright",
    type: "stdio",
    command: "npx",
    args: ["-y", "@anthropic-ai/mcp-playwright"],
    description: "Browser automation, screenshots, form filling",
  },
];

export interface McpServerConfig {
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Read existing MCP servers from preferences.local.jsonc
 */
export function readLocalMcpServers(paiDir: string): Record<string, McpServerConfig> {
  const localPath = join(paiDir, "config", "preferences.local.jsonc");
  if (!existsSync(localPath)) return {};

  try {
    const raw = readFileSync(localPath, "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(?<!:)\/\/[^\n]*/g, "")
      .replace(/,(\s*[}\]])/g, "$1");
    const parsed = JSON.parse(raw);
    return (parsed.mcpServers as Record<string, McpServerConfig>) ?? {};
  } catch {
    return {};
  }
}

/**
 * Write MCP servers to preferences.local.jsonc, merging with existing content.
 */
export function writeMcpServers(paiDir: string, servers: Record<string, McpServerConfig>): void {
  const localPath = join(paiDir, "config", "preferences.local.jsonc");
  let existing: Record<string, unknown> = {};

  if (existsSync(localPath)) {
    try {
      const raw = readFileSync(localPath, "utf-8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(?<!:)\/\/[^\n]*/g, "")
        .replace(/,(\s*[}\]])/g, "$1");
      existing = JSON.parse(raw);
    } catch {
      existing = {};
    }
  }

  const merged = {
    ...existing,
    mcpServers: {
      ...((existing.mcpServers as Record<string, unknown>) ?? {}),
      ...servers,
    },
  };

  const content = `// Machine-Specific Overrides
// This file is gitignored — it stays on this machine only.
// Values here merge ON TOP of config/preferences.jsonc at build time.
//
// After editing, rebuild settings:
//   bun ~/.claude/hooks/handlers/BuildSettings.ts

${JSON.stringify(merged, null, 2)}
`;

  writeFileSync(localPath, content, "utf-8");
}

/**
 * Build a server config object from a McpServerDef.
 */
export function buildServerConfig(def: McpServerDef): McpServerConfig {
  if (def.type === "remote" && def.url) {
    return { url: def.url };
  }
  return {
    command: def.command,
    args: def.args,
  };
}
