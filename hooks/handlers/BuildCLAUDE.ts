#!/usr/bin/env bun

/**
 * BuildCLAUDE.ts — SessionStart hook
 *
 * Checks if CLAUDE.md needs rebuilding (algorithm version changed,
 * DA name changed, unresolved variables). If so, regenerates from template.
 *
 * Current session uses the existing CLAUDE.md (already loaded).
 * Rebuild ensures the NEXT session gets the fresh version.
 *
 * SF-26 GUARD: in kai (dev repo) CLAUDE.md is HAND-MAINTAINED and the template is intentionally a
 * KAI-only artifact (regenerated from CLAUDE.md at sync time). The template here is older than CLAUDE.md and
 * lacks live content (e.g. INVESTIGATE mode). Rebuilding would REVERT hand edits. So: skip the rebuild
 * whenever CLAUDE.md.template is OLDER than CLAUDE.md (stale template = do not trust it). Fresh KAI installs,
 * where the template is the real source, are unaffected (template ≥ generated file there).
 */

import { existsSync, statSync } from "fs";
import { needsRebuild, build } from "../../PAI/Tools/BuildCLAUDE.ts";
import { paiPath } from "../lib/paths.ts";

function templateIsStale(): boolean {
  const template = paiPath("CLAUDE.md.template");
  const output = paiPath("CLAUDE.md");
  if (!existsSync(template) || !existsSync(output)) return false;
  // Stale = template last modified before the hand-edited CLAUDE.md → rebuilding would revert edits.
  return statSync(template).mtimeMs < statSync(output).mtimeMs;
}

if (templateIsStale()) {
  console.error("⏭️  CLAUDE.md rebuild skipped — template is older than CLAUDE.md (SF-26 guard: hand-edited, do not revert)");
} else if (needsRebuild()) {
  const result = build();
  if (result.rebuilt) {
    console.error("🔄 CLAUDE.md rebuilt from template (will take effect next session)");
  }
}
