/**
 * API Key detection, shell profile writing, and .env loading.
 * Shared by: installer (v5.9.1), kai-setup (v5.9.2), kai-keys (v5.9.2)
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

export interface ApiKeyDef {
  key: string;
  name: string;
  required: boolean;
  hint?: string;
}

export const API_KEYS: ApiKeyDef[] = [
  { key: "ANTHROPIC_API_KEY", name: "Anthropic (Claude)", required: true,
    hint: "https://console.anthropic.com/settings/keys" },
  { key: "GITHUB_TOKEN", name: "GitHub", required: false,
    hint: "https://github.com/settings/tokens" },
  { key: "OPENAI_API_KEY", name: "OpenAI (Codex researcher)", required: false,
    hint: "https://platform.openai.com/api-keys" },
  { key: "GEMINI_API_KEY", name: "Google Gemini", required: false,
    hint: "https://aistudio.google.com/apikey" },
  { key: "XAI_API_KEY", name: "xAI Grok", required: false,
    hint: "https://console.x.ai" },
  { key: "PERPLEXITY_API_KEY", name: "Perplexity", required: false,
    hint: "https://www.perplexity.ai/settings/api" },
  { key: "DEEPSEEK_API_KEY", name: "DeepSeek", required: false,
    hint: "https://platform.deepseek.com/api_keys" },
  { key: "MISTRAL_API_KEY", name: "Mistral", required: false,
    hint: "https://console.mistral.ai/api-keys" },
];

export function getShellProfile(): { file: string; path: string } {
  const home = process.env.HOME!;
  const shell = process.env.SHELL ?? "/bin/zsh";
  const file = shell.includes("zsh") ? ".zshrc" : ".bashrc";
  return { file, path: join(home, file) };
}

export function detectSetKeys(): Map<string, "env" | "profile" | "dotenv"> {
  const result = new Map<string, "env" | "profile" | "dotenv">();
  const { path: profilePath } = getShellProfile();
  const profileContent = existsSync(profilePath) ? readFileSync(profilePath, "utf-8") : "";

  for (const def of API_KEYS) {
    if (process.env[def.key]) {
      if (profileContent.includes(`export ${def.key}=`)) {
        result.set(def.key, "profile");
      } else {
        result.set(def.key, "env");
      }
    }
  }

  return result;
}

/**
 * Write a key=value to the shell profile with dedup.
 * If the key already exists, replaces the value. Otherwise appends.
 */
export function writeKeyToProfile(key: string, value: string): void {
  const { path: profilePath } = getShellProfile();
  let content = existsSync(profilePath) ? readFileSync(profilePath, "utf-8") : "";

  const exportLine = `export ${key}="${value}"`;
  const pattern = new RegExp(`^export ${key}=.*$`, "m");

  if (pattern.test(content)) {
    content = content.replace(pattern, exportLine);
  } else {
    content = content.trimEnd() + "\n" + exportLine + "\n";
  }

  writeFileSync(profilePath, content, "utf-8");
}

/**
 * Write a key=value to the .env file with dedup.
 */
export function writeKeyToEnv(paiDir: string, key: string, value: string): void {
  const envPath = join(paiDir, ".env");
  let content = existsSync(envPath) ? readFileSync(envPath, "utf-8") : "";

  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");

  if (pattern.test(content)) {
    content = content.replace(pattern, line);
  } else {
    content = content.trimEnd() + "\n" + line + "\n";
  }

  writeFileSync(envPath, content, "utf-8");
}

/**
 * Check if Bedrock is configured (user doesn't need ANTHROPIC_API_KEY).
 */
export function isBedrockConfigured(paiDir: string): boolean {
  const prefsPath = join(paiDir, "config", "preferences.jsonc");
  if (!existsSync(prefsPath)) return false;
  const content = readFileSync(prefsPath, "utf-8");
  return content.includes('"CLAUDE_CODE_USE_BEDROCK": "1"');
}

/**
 * Mask a key value for display (show last 4 chars).
 */
export function maskKey(value: string): string {
  if (value.length <= 8) return "****";
  return "..." + value.slice(-4);
}
