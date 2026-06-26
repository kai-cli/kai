#!/usr/bin/env bun
/**
 * SkillTracker.hook.ts — Tier-2 skill-invocation telemetry.
 *
 * PURPOSE: persona scoping (specs/memcarry/PERSONA.md) needs EVIDENCE of which skills are actually
 * used before cutting/merging any. There was NO usage telemetry (15k transcripts but skill calls
 * aren't cleanly logged). This appends one line per Skill invocation so cuts become data-driven.
 *
 * SEPARATE from SkillGuard (enforcement) by design: telemetry must never be able to block a skill.
 * Append-only, swallow-all-errors, exit 0 always — a tracking failure is invisible, never disruptive.
 * (Per feedback-swallow-catch-is-observability-hole: this IS pure best-effort logging = the 🟢 fine
 * class; nothing downstream depends on the write succeeding.)
 *
 * TRIGGERS:
 * - PreToolUse matcher: Skill — model-invoked skill/tool calls.
 * - UserPromptExpansion — directly typed slash commands, which bypass PreToolUse:Skill.
 *
 * OUTPUT: appends to MEMORY/STATE/skill-usage.jsonl — { ts, skill, project, session, source } per line.
 * Tier-2 refinement reads this: `jq -r .skill skill-usage.jsonl | sort | uniq -c | sort -rn`.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, basename } from 'node:path';

const PAI = process.env.PAI_DIR ?? `${process.env.HOME}/.claude`;
const LOG = `${PAI}/MEMORY/STATE/skill-usage.jsonl`;

async function readStdin(timeout = 1000): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    const timer = setTimeout(() => resolve(data), timeout);
    process.stdin.on('data', (c) => (data += c.toString()));
    process.stdin.on('end', () => { clearTimeout(timer); resolve(data); });
    process.stdin.on('error', () => { clearTimeout(timer); resolve(''); });
  });
}

function normalizeSkillName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/^\/+/, '').trim();
}

export function extractSkillTelemetry(data: any): { skill: string; source: string } | null {
  const event = data?.hook_event_name;

  if (data?.tool_name === 'Skill') {
    const skill = normalizeSkillName(data?.tool_input?.skill);
    return skill ? { skill, source: 'PreToolUse:Skill' } : null;
  }

  if (event === 'UserPromptExpansion') {
    const skill = normalizeSkillName(data?.command_name);
    return skill ? { skill, source: 'UserPromptExpansion' } : null;
  }

  return null;
}

async function main() {
  try {
    const raw = await readStdin();
    if (!raw) return; // nothing to record
    const data = JSON.parse(raw);
    const telemetry = extractSkillTelemetry(data);
    if (!telemetry) return; // not a named skill/slash invocation

    const projectDir = process.env.CLAUDE_PROJECT_DIR ?? data?.cwd ?? '';
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      skill: telemetry.skill,
      project: projectDir ? basename(projectDir) : null,
      session: data?.session_id ?? null,
      source: telemetry.source,
    });
    try {
      mkdirSync(dirname(LOG), { recursive: true });
      appendFileSync(LOG, line + '\n');
    } catch {
      /* best-effort telemetry — a failed write is invisible, never blocks the skill */
    }
  } catch {
    /* malformed input → record nothing, never throw */
  }
  // Always exit 0: this hook NEVER influences whether the skill runs.
  process.exit(0);
}

if (import.meta.main) main();
