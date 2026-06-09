/**
 * Transcript parser — extracts a mechanical cursor from a Claude Code session .jsonl.
 *
 * Phase −1 findings this encodes:
 *  - F1: NOT every .jsonl is a real session. Lines include `queue-operation`, `ai-title`,
 *    `last-prompt`, and KnowledgeHarvester runs. `isSubstantive()` gates capture.
 *  - F2: the schema is irregular — `message.content` is sometimes a typed-block array, sometimes
 *    absent; tool calls live only on some lines. Every access is defensive; nothing throws.
 *  - F3: work spans multiple repos — we collect the full set of touched paths, not just one.
 *
 * Mechanical capture is RELIABLE for the cursor (branch/PR/files). The next/why is prose and needs
 * an LLM draft + /end confirm — NOT done here (this module only does the reliable mechanical half).
 */
import { readFileSync } from "node:fs";

export interface MechanicalCapture {
  bashCommands: string[];
  gitGhBuild: string[]; // subset of bashCommands matching dev-cursor patterns
  filesTouched: string[]; // Edit/Write targets, de-duped, in order
  prRefs: string[]; // e.g. "81" from `gh pr ... 81`
  issueRefs: string[]; // e.g. "358" from "#358" / "RepoName#358"
  realTurns: number; // count of genuine user+assistant message lines
}

const CURSOR_PATTERNS = ["git ", "gh ", "jenkins", "curl", "buildWith", "branchFilter", "build"];

function asLines(path: string): unknown[] {
  const raw = readFileSync(path, "utf8");
  const out: unknown[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* defensive: skip malformed lines (F2) */
    }
  }
  return out;
}

/** Pull the message.content block array off a line, or [] if absent/wrong-shape. */
function contentBlocks(line: any): any[] {
  const c = line?.message?.content ?? line?.content;
  return Array.isArray(c) ? c : [];
}

function isRealTurn(line: any): boolean {
  const t = line?.type;
  // F1: exclude housekeeping line types. Only genuine conversation turns count.
  if (t === "user" || t === "assistant") {
    // a harvester "user" prompt is a fact-dump; a real turn has content
    return contentBlocks(line).length > 0 || typeof line?.message?.content === "string";
  }
  return false;
}

export function parseTranscript(path: string): MechanicalCapture {
  const lines = asLines(path);
  const bashCommands: string[] = [];
  const filesTouched: string[] = [];
  const prRefs = new Set<string>();
  const issueRefs = new Set<string>();
  let realTurns = 0;

  for (const line of lines) {
    if (isRealTurn(line)) realTurns++;
    for (const b of contentBlocks(line)) {
      if (b?.type !== "tool_use") continue;
      const name = b?.name;
      const input = b?.input ?? {};
      if (name === "Bash" && typeof input.command === "string") {
        bashCommands.push(input.command);
        for (const m of input.command.matchAll(/\bpr\s+\w+\s+(\d+)|\bpr\b.*?\s(\d+)\b/g)) {
          const n = m[1] ?? m[2];
          if (n) prRefs.add(n);
        }
        for (const m of input.command.matchAll(/#(\d+)/g)) issueRefs.add(m[1]);
      } else if ((name === "Edit" || name === "Write") && typeof input.file_path === "string") {
        if (!filesTouched.includes(input.file_path)) filesTouched.push(input.file_path);
      }
    }
  }

  const gitGhBuild = bashCommands.filter((c) => CURSOR_PATTERNS.some((p) => c.includes(p)));
  return {
    bashCommands,
    gitGhBuild,
    filesTouched,
    prRefs: [...prRefs],
    issueRefs: [...issueRefs],
    realTurns,
  };
}

/**
 * F1 session gate: a transcript is substantive enough to overwrite a resume-state only if it has
 * real conversation AND real dev activity. Tuneable thresholds.
 */
export function isSubstantive(
  cap: MechanicalCapture,
  opts: { minRealTurns?: number; minDevCommands?: number } = {}
): boolean {
  const minRealTurns = opts.minRealTurns ?? 4;
  const minDevCommands = opts.minDevCommands ?? 1;
  return (
    cap.realTurns >= minRealTurns &&
    cap.gitGhBuild.length + cap.filesTouched.length >= minDevCommands
  );
}

/** Distinct repo roots / top dirs touched, for resume-state.also_touched (F3). */
export function touchedRepos(cap: MechanicalCapture): string[] {
  const repos = new Set<string>();
  for (const f of cap.filesTouched) {
    const m = f.match(/^(.*?\/Projects\/[^/]+)/) ?? f.match(/^(.*?\/\.claude)/);
    if (m) repos.add(m[1]);
  }
  return [...repos];
}
