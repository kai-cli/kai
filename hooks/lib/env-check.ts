/**
 * Fast environment status check for session startup.
 * No network calls — just checks env vars and file existence.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";

export interface EnvStatus {
  keys: { set: number; total: number };
  mcp: { configured: number };
  bedrock: boolean;
  critical?: string;
}

export function checkEnvironment(paiDir: string): EnvStatus {
  const keyNames = [
    "ANTHROPIC_API_KEY", "GITHUB_TOKEN", "OPENAI_API_KEY", "GEMINI_API_KEY",
    "XAI_API_KEY", "PERPLEXITY_API_KEY", "DEEPSEEK_API_KEY", "MISTRAL_API_KEY",
  ];

  const set = keyNames.filter(k => !!process.env[k]).length;

  let mcpCount = 0;
  try {
    const settingsPath = join(paiDir, "settings.json");
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      mcpCount = Object.keys(settings.mcpServers ?? {}).length;
    }
  } catch { /* ignore */ }

  const bedrock = !!process.env.CLAUDE_CODE_USE_BEDROCK;

  let critical: string | undefined;
  if (!process.env.ANTHROPIC_API_KEY && !bedrock) {
    critical = "ANTHROPIC_API_KEY not set — run `bun ~/.claude/scripts/kai-keys.ts add` or check ~/.zshrc";
  }

  return { keys: { set, total: keyNames.length }, mcp: { configured: mcpCount }, bedrock, critical };
}

export function formatStatus(status: EnvStatus): string {
  const keyPart = `🔑 Keys: ${status.keys.set}/${status.keys.total} active`;
  const mcpPart = `🔌 MCP: ${status.mcp.configured} configured`;
  const apiPart = status.bedrock ? "⚡ Bedrock" : "⚡ Direct API";
  return `${keyPart} | ${mcpPart} | ${apiPart}`;
}
