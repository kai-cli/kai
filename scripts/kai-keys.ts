#!/usr/bin/env bun
/**
 * kai-keys — Manage API keys (list, add, test, remove).
 *
 * Usage:
 *   bun scripts/kai-keys.ts              # List all keys and their status
 *   bun scripts/kai-keys.ts add          # Interactive add
 *   bun scripts/kai-keys.ts test         # Test connectivity for all set keys
 *   bun scripts/kai-keys.ts remove KEY   # Remove a key from shell profile
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { API_KEYS, getShellProfile, writeKeyToProfile, maskKey } from "../PAI-Install/lib/api-keys";
import * as readline from "readline";

const command = process.argv[2] ?? "list";

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`  ? ${question}  `, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function list() {
  console.log("\n  API Key Status");
  console.log("  " + "─".repeat(50));

  for (const def of API_KEYS) {
    const value = process.env[def.key];
    const status = value
      ? `✅ Set (${maskKey(value)})`
      : `❌ Not set`;
    const tag = def.required ? "Required" : "Optional";
    console.log(`  ${def.key.padEnd(22)} ${status.padEnd(24)} ${tag}`);
  }

  console.log();
  console.log("  Run `kai-keys add` to configure missing keys.");
  console.log("  Run `kai-keys test` to verify connectivity.\n");
}

async function add() {
  console.log("\n  Add API Key\n");

  const unset = API_KEYS.filter(k => !process.env[k.key]);
  if (unset.length === 0) {
    console.log("  ✓ All keys are already configured.\n");
    return;
  }

  for (const def of unset) {
    const label = def.required ? `${def.name} (required)` : def.name;
    if (def.hint) console.log(`    ${def.hint}`);
    const value = await prompt(`${label} key (enter to skip)`);
    if (value) {
      writeKeyToProfile(def.key, value);
      console.log(`  ✓ ${def.key} saved to ~/${getShellProfile().file}\n`);
    }
  }

  console.log("  Run `source ~/" + getShellProfile().file + "` to activate.\n");
}

async function test() {
  console.log("\n  Testing API Keys");
  console.log("  " + "─".repeat(50));

  const tests: { key: string; name: string; test: () => boolean }[] = [
    {
      key: "ANTHROPIC_API_KEY",
      name: "Anthropic",
      test: () => {
        const r = execSync(
          `curl -s -o /dev/null -w "%{http_code}" -H "x-api-key: ${process.env.ANTHROPIC_API_KEY}" -H "anthropic-version: 2023-06-01" https://api.anthropic.com/v1/models`,
          { encoding: "utf-8" }
        );
        return r.trim() === "200";
      },
    },
    {
      key: "GITHUB_TOKEN",
      name: "GitHub",
      test: () => {
        try {
          execSync("gh api user", { stdio: "pipe" });
          return true;
        } catch {
          const r = execSync(
            `curl -s -o /dev/null -w "%{http_code}" -H "Authorization: token ${process.env.GITHUB_TOKEN}" https://api.github.com/user`,
            { encoding: "utf-8" }
          );
          return r.trim() === "200";
        }
      },
    },
    {
      key: "OPENAI_API_KEY",
      name: "OpenAI",
      test: () => {
        const r = execSync(
          `curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer ${process.env.OPENAI_API_KEY}" https://api.openai.com/v1/models`,
          { encoding: "utf-8" }
        );
        return r.trim() === "200";
      },
    },
    {
      key: "GEMINI_API_KEY",
      name: "Google Gemini",
      test: () => {
        const r = execSync(
          `curl -s -o /dev/null -w "%{http_code}" "https://generativelanguage.googleapis.com/v1/models?key=${process.env.GEMINI_API_KEY}"`,
          { encoding: "utf-8" }
        );
        return r.trim() === "200";
      },
    },
  ];

  for (const t of tests) {
    if (!process.env[t.key]) {
      console.log(`  ${t.key.padEnd(22)} ⏭️  Not set (skipped)`);
      continue;
    }
    try {
      const ok = t.test();
      console.log(`  ${t.key.padEnd(22)} ${ok ? "✅ Connected" : "❌ Failed (invalid key?)"}`);
    } catch {
      console.log(`  ${t.key.padEnd(22)} ❌ Error (network issue?)`);
    }
  }
  console.log();
}

function remove() {
  const keyName = process.argv[3];
  if (!keyName) {
    console.error("  Usage: kai-keys remove KEY_NAME\n");
    process.exit(1);
  }

  const { path: profilePath, file: profileFile } = getShellProfile();
  if (!existsSync(profilePath)) {
    console.error(`  ✗ ${profileFile} not found.\n`);
    process.exit(1);
  }

  let content = readFileSync(profilePath, "utf-8");
  const pattern = new RegExp(`^export ${keyName}=.*$`, "m");

  if (!pattern.test(content)) {
    console.log(`  ${keyName} not found in ~/${profileFile}.\n`);
    return;
  }

  content = content.replace(pattern, `# export ${keyName}= # removed by kai-keys`);
  // Clean up any prior commented-out duplicate from a previous remove
  const dupPattern = new RegExp(`^# export ${keyName}=.*# removed by kai-keys\n`, "gm");
  const matches = content.match(dupPattern);
  if (matches && matches.length > 1) {
    // Keep only the last one
    for (let i = 0; i < matches.length - 1; i++) {
      content = content.replace(matches[i], "");
    }
  }

  writeFileSync(profilePath, content, "utf-8");
  console.log(`  ✓ ${keyName} commented out in ~/${profileFile}`);
  console.log(`  Run \`source ~/${profileFile}\` to apply.\n`);
}

switch (command) {
  case "list": list(); break;
  case "add": await add(); break;
  case "test": await test(); break;
  case "remove": remove(); break;
  default:
    console.error(`  Unknown command: ${command}`);
    console.error("  Usage: kai-keys [list|add|test|remove]\n");
    process.exit(1);
}
