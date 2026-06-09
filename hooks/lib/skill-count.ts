/**
 * skill-count.ts — Single source for "how many skills are there".
 *
 * Skills nest under meta-routers (e.g. Documents/Pdf, Thinking/RedTeam), so the count is a RECURSIVE
 * walk for any directory containing a SKILL.md, EXCLUDING `.archive/` (retired skills). This matches
 * BuildManifest.ts's skillInventory exactly — the authoritative source that produces manifest.json.
 *
 * Consolidated 2026-06-08 after the count drifted across 8 copies: the gate counters (pre-push,
 * verify-release, sync-ci-gate, CI yaml) were recursive=70, but GetCounts.ts + UpdateCounts.ts used a
 * stale top-level-only count=46 — and UpdateCounts feeds settings.json, so the statusline/banner showed
 * 46 while everything else said 70. One helper, no drift.
 */

import { readdirSync, existsSync, statSync } from "fs";
import { join } from "path";

/**
 * Recursively collect skill identifiers (path relative to skills/) for every dir containing a SKILL.md,
 * skipping `.archive/`. Returns sorted relative paths — `.length` is the canonical skill count.
 */
export function listSkills(paiDir: string): string[] {
  const skillsDir = join(paiDir, "skills");
  const out: string[] = [];
  if (!existsSync(skillsDir)) return out;

  function walk(dir: string, rel: string): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      // Follow symlinked dirs too (some skills are symlinked); skip non-dirs + retired skills.
      const full = join(dir, entry.name);
      const isDir =
        entry.isDirectory() ||
        (entry.isSymbolicLink() && (() => { try { return statSync(full).isDirectory(); } catch { return false; } })());
      if (!isDir) continue;
      if (entry.name === ".archive") continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (existsSync(join(full, "SKILL.md"))) out.push(relPath);
      walk(full, relPath);
    }
  }

  walk(skillsDir, "");
  return out.sort();
}

/** The canonical skill count (recursive, excludes `.archive`). */
export function countSkills(paiDir: string): number {
  return listSkills(paiDir).length;
}
