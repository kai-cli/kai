#!/usr/bin/env bun

/**
 * PAI Banner — Compact startup banner
 * Displays a 4-line status summary at session start.
 */

import { readFileSync } from "fs";
import { join } from "path";

const HOME = process.env.HOME!;
const CLAUDE_DIR = join(HOME, ".claude");

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const rgb = (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`;

const C = {
  navy: rgb(30, 58, 138),
  blue: rgb(59, 130, 246),
  light: rgb(147, 197, 253),
  steel: rgb(51, 65, 85),
  slate: rgb(100, 116, 139),
  silver: rgb(203, 213, 225),
};

interface Stats {
  name: string;
  paiVersion: string;
  algorithmVersion: string;
  model: string;
  connection: string;
  skills: number;
  workflows: number;
  hooks: number;
  learnings: number;
  userFiles: number;
}

function getStats(): Stats {
  let name = "PAI";
  let paiVersion = "7.2.0";
  let algorithmVersion = "3.14.0";
  let skills = 0, workflows = 0, hooks = 0, learnings = 0, userFiles = 0;
  let connection = "API";
  let model = "Opus 4.6";

  try {
    const settings = JSON.parse(readFileSync(join(CLAUDE_DIR, "settings.json"), "utf-8"));
    name = settings.daidentity?.displayName || settings.daidentity?.name || name;
    paiVersion = settings.pai?.version || paiVersion;
    algorithmVersion = (settings.pai?.algorithmVersion || algorithmVersion).replace(/^v/i, "");

    if (settings.counts) {
      skills = settings.counts.skills || 0;
      workflows = settings.counts.workflows || 0;
      hooks = settings.counts.hooks || 0;
      learnings = settings.counts.signals || 0;
      userFiles = settings.counts.files || 0;
    }

    const env = settings.env || {};
    if (env.CLAUDE_CODE_USE_BEDROCK === "1") {
      connection = "Bedrock";
      const m = (env.ANTHROPIC_MODEL || "").match(/claude-(\w+)-(\d+)-(\d+)/);
      if (m) model = `${m[1].charAt(0).toUpperCase() + m[1].slice(1)} ${m[2]}.${m[3]}`;
    } else if (env.CLAUDE_CODE_USE_TEAMS === "1" || process.env.CLAUDE_CODE_USE_TEAMS === "1") {
      connection = "Team";
    }
  } catch {}

  return { name, paiVersion, algorithmVersion, model, connection, skills, workflows, hooks, learnings, userFiles };
}

function render(s: Stats): string {
  const sep = `${C.steel}│${RESET}`;
  const hr = `${C.steel}${"─".repeat(52)}${RESET}`;

  const line1 = `${C.steel}───${RESET} ${BOLD}${C.navy}P${C.blue}A${C.light}I${RESET} ${C.steel}───────────────────────────────────────────────${RESET}`;
  const line2 = `  ${BOLD}${C.light}${s.name}${RESET}  ${sep}  PAI ${C.silver}${s.paiVersion}${RESET}  Algo ${C.silver}${s.algorithmVersion}${RESET}  ${sep}  ${C.light}${s.model}${RESET} ${DIM}${s.connection}${RESET}`;
  const line3 = `  ${C.slate}SK${RESET} ${C.silver}${s.skills}${RESET}  ${C.slate}WF${RESET} ${C.silver}${s.workflows}${RESET}  ${C.slate}Hooks${RESET} ${C.silver}${s.hooks}${RESET}  ${C.slate}Signals${RESET} ${C.silver}${s.learnings}${RESET}  ${C.slate}Files${RESET} ${C.silver}${s.userFiles}${RESET}`;
  const line4 = hr;

  return `${line1}\n${line2}\n${line3}\n${line4}`;
}

try {
  console.log(render(getStats()));
} catch (e) {
  console.error("Banner error:", e);
}
