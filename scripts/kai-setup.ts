#!/usr/bin/env bun
/**
 * kai-setup — Re-runnable interactive configurator.
 * Provides a menu to reconfigure any aspect of KAI.
 *
 * Usage:
 *   bun scripts/kai-setup.ts              # Interactive menu
 *   bun scripts/kai-setup.ts identity     # Jump to identity section
 *   bun scripts/kai-setup.ts keys         # Jump to API keys
 *   bun scripts/kai-setup.ts mcp          # Jump to MCP servers
 *   bun scripts/kai-setup.ts notifications # Jump to notifications
 *   bun scripts/kai-setup.ts archetype    # Jump to archetype
 *   bun scripts/kai-setup.ts bedrock      # Jump to Bedrock config
 */

import * as readline from "readline";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { API_KEYS, detectSetKeys, writeKeyToProfile, isBedrockConfigured, maskKey, getShellProfile } from "../PAI-Install/lib/api-keys";
import { AVAILABLE_SERVERS, readLocalMcpServers, writeMcpServers, buildServerConfig } from "../PAI-Install/lib/mcp-setup";
import { NOTIFICATION_CHANNELS, enableNotificationChannel } from "../PAI-Install/lib/notifications-setup";
import { writeIdentityConfig, guessTimezone, applyArchetype, enableBedrockInPreferences } from "../PAI-Install/main";

const PAI_DIR = process.env.PAI_DIR ?? join(process.env.HOME!, ".claude");

const BLUE = "\x1b[38;2;59;130;246m";
const GREEN = "\x1b[38;2;34;197;94m";
const YELLOW = "\x1b[38;2;234;179;8m";
const GRAY = "\x1b[38;2;100;116;139m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

async function prompt(question: string, defaultVal?: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    const hint = defaultVal ? ` ${DIM}[${defaultVal}]${RESET}` : "";
    rl.question(`  ${BOLD}?${RESET} ${question}${hint}  `, answer => {
      rl.close();
      resolve(answer.trim() || defaultVal || "");
    });
  });
}

async function confirm(question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? "Y/n" : "y/N";
  const answer = await prompt(`${question} ${DIM}(${hint})${RESET}`);
  if (!answer) return defaultYes;
  return answer.toLowerCase().startsWith("y");
}

const ok = (m: string) => console.log(`  ${GREEN}✓${RESET} ${m}`);
const info = (m: string) => console.log(`  ${BLUE}ℹ${RESET} ${m}`);
const warn = (m: string) => console.log(`  ${YELLOW}⚠${RESET} ${m}`);

async function setupIdentity() {
  console.log(`\n  ${BOLD}Identity Configuration${RESET}\n`);
  const identityPath = join(PAI_DIR, "config", "identity.jsonc");

  let currentName = "KAI", currentPrincipal = "", currentTz = guessTimezone(), currentColor = "#3B82F6";
  if (existsSync(identityPath)) {
    try {
      const raw = readFileSync(identityPath, "utf-8")
        .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/[^\n]*/g, "");
      const parsed = JSON.parse(raw);
      currentName = parsed.daidentity?.name ?? currentName;
      currentPrincipal = parsed.principal?.name ?? "";
      currentTz = parsed.principal?.timezone ?? currentTz;
      currentColor = parsed.daidentity?.color ?? currentColor;
    } catch { /* use defaults */ }
  }

  const daName = await prompt("Assistant name", currentName);
  const principalName = await prompt("Your name", currentPrincipal || undefined);
  const timezone = await prompt("Timezone", currentTz);

  writeIdentityConfig(PAI_DIR, {
    daName, daFullName: daName, daDisplayName: daName,
    daColor: currentColor, daCatchphrase: `${daName.split(" ")[0]} go`,
    principalName, principalTimezone: timezone,
  });
  ok(`Identity saved (${daName} / ${principalName})`);
  rebuild();
}

async function setupKeys() {
  console.log(`\n  ${BOLD}API Key Configuration${RESET}\n`);
  const setKeys = detectSetKeys();

  for (const def of API_KEYS) {
    if (process.env[def.key]) {
      console.log(`  ${GREEN}✓${RESET} ${def.name.padEnd(24)} ${DIM}(set: ${maskKey(process.env[def.key]!)})${RESET}`);
    } else {
      const want = await confirm(`Configure ${def.name}?`, def.required);
      if (want) {
        if (def.hint) info(`${DIM}${def.hint}${RESET}`);
        const value = await prompt(`${def.name} key`);
        if (value) {
          writeKeyToProfile(def.key, value);
          ok(`${def.name} saved to ~/${getShellProfile().file}`);
        }
      }
    }
  }
  console.log(`\n  ${DIM}Run: source ~/${getShellProfile().file}${RESET}\n`);
}

async function setupMcp() {
  console.log(`\n  ${BOLD}MCP Server Configuration${RESET}\n`);
  const existing = readLocalMcpServers(PAI_DIR);

  if (Object.keys(existing).length > 0) {
    info("Currently configured:");
    for (const name of Object.keys(existing)) {
      console.log(`    ${GREEN}✓${RESET} ${name}`);
    }
    console.log();
  }

  const selected: Record<string, ReturnType<typeof buildServerConfig>> = {};
  for (const server of AVAILABLE_SERVERS) {
    if (existing[server.name.toLowerCase()]) continue;
    const want = await confirm(`Enable ${server.name}? ${DIM}(${server.description})${RESET}`, false);
    if (want) {
      selected[server.name.toLowerCase()] = buildServerConfig(server);
      ok(`${server.name} enabled`);
      if (server.postNote) info(`${DIM}${server.postNote}${RESET}`);
    }
  }

  const wantCustom = await confirm("Add a custom MCP server?", false);
  if (wantCustom) {
    const name = await prompt("Server name");
    if (name) {
      const type = await prompt("Type: [r]emote or [s]tdio", "r");
      if (type.toLowerCase() === "r") {
        const url = await prompt("Server URL");
        if (url) selected[name] = { url };
      } else {
        const cmd = await prompt("Command (e.g. npx @some/server)");
        if (cmd) {
          const [command, ...args] = cmd.split(" ");
          selected[name] = { command, args };
        }
      }
    }
  }

  if (Object.keys(selected).length > 0) {
    writeMcpServers(PAI_DIR, selected);
    ok(`${Object.keys(selected).length} server(s) saved`);
    rebuild();
  }
}

async function setupNotifications() {
  console.log(`\n  ${BOLD}Notification Configuration${RESET}\n`);

  for (const channel of NOTIFICATION_CHANNELS) {
    const want = await confirm(`Set up ${channel.name}? ${DIM}(${channel.description})${RESET}`, false);
    if (!want) continue;

    let allSet = true;
    for (const envKey of channel.envKeys) {
      if (envKey.hint) info(`${DIM}${envKey.hint}${RESET}`);
      const value = await prompt(envKey.prompt);
      if (value) {
        writeKeyToProfile(envKey.key, value);
        ok(`${envKey.key} saved`);
      } else {
        allSet = false;
      }
    }

    if (allSet) {
      enableNotificationChannel(PAI_DIR, channel.name, channel.defaultEvents);
      ok(`${channel.name} enabled for: ${channel.defaultEvents.join(", ")}`);
    }
  }
}

async function setupArchetype() {
  console.log(`\n  ${BOLD}Knowledge Archetype${RESET}\n`);
  const archetypes: Record<string, { label: string; file: string }> = {
    "1": { label: "Generic (3 domains)", file: "generic-domains.jsonc" },
    "2": { label: "Full-Stack (5 domains)", file: "fullstack-domains.jsonc" },
    "3": { label: "Data Science (6 domains)", file: "datascience-domains.jsonc" },
    "4": { label: "DevOps (6 domains)", file: "devops-domains.jsonc" },
  };

  for (const [k, v] of Object.entries(archetypes)) {
    console.log(`  ${BOLD}${k}${RESET}  ${v.label}`);
  }

  const choice = await prompt("\nArchetype", "1");
  const arch = archetypes[choice] ?? archetypes["1"];
  if (applyArchetype(PAI_DIR, arch.file)) {
    ok(`Applied ${arch.label}`);
    rebuild();
  } else {
    warn("Starter file not found");
  }
}

async function setupBedrock() {
  console.log(`\n  ${BOLD}AWS Bedrock Configuration${RESET}\n`);

  if (isBedrockConfigured(PAI_DIR)) {
    ok("Bedrock already configured");
    const reconfigure = await confirm("Reconfigure?", false);
    if (!reconfigure) return;
  }

  const region = await prompt("AWS region", "us-west-2");
  const profile = await prompt("AWS profile name");
  if (!profile) { warn("No profile — aborting"); return; }
  const model = await prompt("Model ID", "us.anthropic.claude-opus-4-6-v1");
  const smallModel = await prompt("Small/fast model ID", "us.anthropic.claude-haiku-4-5-20251001-v1:0");

  try {
    enableBedrockInPreferences(PAI_DIR, region, profile, model, smallModel);
    ok("Bedrock configured");
    rebuild();
  } catch (e) {
    warn(`Failed: ${e instanceof Error ? e.message : e}`);
  }
}

function rebuild() {
  info("Rebuilding settings...");
  try {
    execSync(`bun ${join(PAI_DIR, "hooks", "handlers", "BuildSettings.ts")}`, { stdio: "pipe" });
    ok("settings.json rebuilt");
  } catch {
    warn("BuildSettings failed — run manually");
  }
}

async function mainMenu() {
  console.log(`\n  ${BOLD}KAI Setup${RESET}\n`);
  console.log("  " + "─".repeat(40));
  console.log(`  ${BOLD}1${RESET}  Identity (name, timezone)`);
  console.log(`  ${BOLD}2${RESET}  API Keys`);
  console.log(`  ${BOLD}3${RESET}  MCP Servers`);
  console.log(`  ${BOLD}4${RESET}  Notifications`);
  console.log(`  ${BOLD}5${RESET}  Knowledge Archetype`);
  console.log(`  ${BOLD}6${RESET}  AWS Bedrock`);
  console.log(`  ${BOLD}q${RESET}  Quit`);
  console.log();

  const choice = await prompt("Section", "q");
  switch (choice) {
    case "1": await setupIdentity(); break;
    case "2": await setupKeys(); break;
    case "3": await setupMcp(); break;
    case "4": await setupNotifications(); break;
    case "5": await setupArchetype(); break;
    case "6": await setupBedrock(); break;
    case "q": case "Q": return;
    default: warn(`Unknown option: ${choice}`);
  }

  await mainMenu();
}

const section = process.argv[2];
if (section) {
  switch (section) {
    case "identity": await setupIdentity(); break;
    case "keys": await setupKeys(); break;
    case "mcp": await setupMcp(); break;
    case "notifications": await setupNotifications(); break;
    case "archetype": await setupArchetype(); break;
    case "bedrock": await setupBedrock(); break;
    default: await mainMenu();
  }
} else {
  await mainMenu();
}
