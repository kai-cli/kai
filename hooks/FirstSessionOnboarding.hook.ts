import { existsSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";

const PAI_DIR = process.env.PAI_DIR ?? join(process.env.HOME!, ".claude");
const FLAG_FILE = join(PAI_DIR, "MEMORY", "STATE", ".onboarding-complete");

if (existsSync(FLAG_FILE)) {
  process.exit(0);
}

const flagDir = dirname(FLAG_FILE);
if (!existsSync(flagDir)) mkdirSync(flagDir, { recursive: true });
writeFileSync(FLAG_FILE, new Date().toISOString(), "utf-8");

const orientation = `
Welcome to KAI — your first session.

Quick orientation:
• Type normally — KAI handles simple and complex tasks automatically
• /help — see all available skills and commands
• /research <topic> — multi-agent parallel research
• /end — session wrap-up with memory save

Customize anytime:
• Edit ~/.claude/PAI/USER/ABOUTME.md to tell KAI about yourself
• Reconfigure: bun ~/.claude/scripts/kai-setup.ts (or kai-setup if alias installed)
• Verify install: bun ~/.claude/scripts/kai-doctor.ts (or kai-doctor if alias installed)

This message appears once. KAI is ready.
`.trim();

console.log(JSON.stringify({ additionalContext: orientation }));
