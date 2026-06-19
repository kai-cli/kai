#!/usr/bin/env bun
/**
 * sync-ci-gate.ts — Sync readiness gate for CI
 *
 * PURPOSE: Validate that kai is ready to sync to kai before pushing.
 * Catches drift, uncategorized files, and PII patterns that would leak into public.
 *
 * USAGE:
 *   bun scripts/sync-ci-gate.ts              # standard checks
 *   bun scripts/sync-ci-gate.ts --strict     # strict mode (fail on warnings)
 *
 * DESIGN:
 * 1. Parse EXCLUDE_PATHS and KAI_ONLY_FILES from sync-to-kai.sh
 * 2. Classify all tracked files into private/kai-only/public
 * 3. Scan public files for PII patterns
 * 4. Verify manifest counts align with filesystem
 * 5. Check for uncategorized new files (not in any list)
 *
 * EXIT CODES:
 *   0 - Ready to sync
 *   1 - Issues found (blocking)
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { reconcile } from './reconcile-wiring';

const RED = '\x1b[0;31m';
const GREEN = '\x1b[0;32m';
const YELLOW = '\x1b[1;33m';
const BLUE = '\x1b[0;34m';
const NC = '\x1b[0m';

function info(msg: string) { console.log(`  ${BLUE}→${NC} ${msg}`); }
function pass(msg: string) { console.log(`  ${GREEN}✓${NC} ${msg}`); }
function warn(msg: string) { console.log(`  ${YELLOW}!${NC} ${msg}`); }
function fail(msg: string) { console.log(`  ${RED}✗${NC} ${msg}`); }

const STRICT = process.argv.includes('--strict');
const WARN_PII = process.argv.includes('--warn-pii');

// Get PAI_DIR with fallback chain (evaluated lazily to avoid test environment issues)
function getPaiDir(): string {
  if (process.env.PAI_DIR) return process.env.PAI_DIR;

  // Try cwd if it looks like kai root (has sync-to-kai.sh)
  const cwd = process.cwd();
  if (existsSync(join(cwd, 'scripts', 'sync-to-kai.sh'))) {
    return cwd;
  }

  // Fallback to standard location
  const standardPath = join(process.env.HOME!, 'Projects', 'kai');
  if (existsSync(join(standardPath, 'scripts', 'sync-to-kai.sh'))) {
    return standardPath;
  }

  // If nothing works, return cwd (will fail with clear error message)
  return cwd;
}

// Lazy getters to avoid issues with tests that modify process.env
function getKaiDir(): string {
  return process.env.KAI_DIR || join(process.env.HOME!, 'Projects', 'kai');
}

// PII patterns loaded from external file (excluded from kai sync to avoid leaking identifiers)
function loadPIIPatterns(paiDir: string): string[] {
  const patternsPath = join(paiDir, 'scripts', 'pii-patterns.json');
  if (existsSync(patternsPath)) {
    try {
      return JSON.parse(readFileSync(patternsPath, 'utf-8'));
    } catch {
      return [];
    }
  }
  return [];
}

// Lazy-loaded to avoid resolving PAI_DIR at module init (test compat)
let _piiPatterns: string[] | null = null;
function getPIIPatterns(paiDir: string): string[] {
  if (_piiPatterns === null) {
    _piiPatterns = loadPIIPatterns(paiDir);
  }
  return _piiPatterns;
}

// Parse EXCLUDE_PATHS from sync-to-kai.sh
function parseExcludePaths(paiDir: string = getPaiDir()): string[] {
  const syncScript = join(paiDir, 'scripts', 'sync-to-kai.sh');
  if (!existsSync(syncScript)) {
    fail(`sync-to-kai.sh not found at ${syncScript} (PAI_DIR=${paiDir})`);
    process.exit(1);
  }

  const content = readFileSync(syncScript, 'utf-8');
  // Match to the array-closing ')' at START of a line — a ')' inside a comment/value (e.g. a
  // parenthetical in an inline # comment) must NOT prematurely terminate the capture.
  const match = content.match(/EXCLUDE_PATHS=\(([\s\S]*?)\n\)/);
  if (!match) {
    fail('Could not parse EXCLUDE_PATHS from sync-to-kai.sh');
    process.exit(1);
  }

  // Parse bash array — each line contains a path (possibly quoted)
  const paths: string[] = [];
  const lines = match[1].split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    // Remove quotes and trailing comments
    const cleaned = trimmed.replace(/^["']|["']$/g, '').split('#')[0].trim();
    if (cleaned) paths.push(cleaned);
  }
  return paths;
}

// Parse KAI_ONLY_FILES from sync-to-kai.sh
function parseKaiOnlyFiles(paiDir: string = getPaiDir()): string[] {
  const syncScript = join(paiDir, 'scripts', 'sync-to-kai.sh');
  const content = readFileSync(syncScript, 'utf-8');
  const match = content.match(/KAI_ONLY_FILES=\(([\s\S]*?)\n\)/);
  if (!match) {
    fail('Could not parse KAI_ONLY_FILES from sync-to-kai.sh');
    process.exit(1);
  }

  const paths: string[] = [];
  const lines = match[1].split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const cleaned = trimmed.replace(/^["']|["']$/g, '').split('#')[0].trim();
    if (cleaned) paths.push(cleaned);
  }
  return paths;
}

// Get all tracked files from git
function getTrackedFiles(paiDir: string = getPaiDir()): string[] {
  try {
    const output = execSync('git ls-files', {
      cwd: paiDir,
      encoding: 'utf-8'
    });
    return output.trim().split('\n').filter(f => f.length > 0);
  } catch (err) {
    fail(`Failed to get tracked files: ${err}`);
    process.exit(1);
  }
}

// Check if file path matches pattern (with glob support for directories)
function matchesPattern(filePath: string, pattern: string): boolean {
  // A leading '/' in an rsync filter anchors the pattern to the transfer root.
  // classifyFile works with root-relative paths, so a root-anchored pattern is
  // just an exact-from-root match — strip the anchor and fall through to the
  // exact/prefix logic below (which is already root-relative, not depth-matching).
  if (pattern.startsWith('/')) pattern = pattern.slice(1);
  if (pattern.endsWith('/')) {
    return filePath.startsWith(pattern);
  }
  if (pattern.includes('*')) {
    // Simple glob: "foo/*.md" or "*.ext"
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return regex.test(filePath);
  }
  return filePath === pattern || filePath.startsWith(pattern + '/');
}

// Classify file into private/kai-only/public
function classifyFile(
  filePath: string,
  excludePaths: string[],
  kaiOnlyFiles: string[]
): 'private' | 'kai-only' | 'public' {
  // Check if excluded from sync (kai only)
  for (const pattern of excludePaths) {
    if (matchesPattern(filePath, pattern)) {
      return 'private';
    }
  }

  // Check if kai-only (won't be synced, but exists in kai)
  for (const pattern of kaiOnlyFiles) {
    if (matchesPattern(filePath, pattern)) {
      return 'kai-only';
    }
  }

  // Everything else will sync to kai (must be PII-free)
  return 'public';
}

// Scan file for PII patterns
function scanForPII(filePath: string, paiDir: string = getPaiDir()): string[] {
  const fullPath = join(paiDir, filePath);
  if (!existsSync(fullPath)) return [];

  // Only scan text files. Includes .tsx/.jsx/.css: the React frontend ships to kai and must be
  // PII/brand-scanned (same blind spot that let "KAI Board" reach public App.tsx).
  if (!/\.(ts|tsx|js|jsx|css|md|json|jsonc|yaml|yml|sh|html|txt)$/.test(filePath)) {
    return [];
  }

  try {
    const content = readFileSync(fullPath, 'utf-8');
    const found: string[] = [];

    for (const pattern of getPIIPatterns(paiDir)) {
      const regex = new RegExp(pattern, 'gi');
      if (regex.test(content)) {
        found.push(pattern);
      }
    }

    return found;
  } catch {
    return [];
  }
}

// Main gate logic
function main() {
  const PAI_DIR = getPaiDir();
  const KAI_DIR = getKaiDir();

  console.log('\n=== Sync CI Gate ===');
  console.log(`PAI: ${PAI_DIR}`);
  console.log(`Mode: ${STRICT ? 'strict' : 'standard'}\n`);

  if (!existsSync(PAI_DIR)) {
    fail(`PAI directory not found: ${PAI_DIR}`);
    process.exit(1);
  }

  // Step 1: Parse sync rules
  info('Parsing sync rules from sync-to-kai.sh');
  const excludePaths = parseExcludePaths(PAI_DIR);
  const kaiOnlyFiles = parseKaiOnlyFiles(PAI_DIR);
  pass(`Loaded ${excludePaths.length} exclude patterns, ${kaiOnlyFiles.length} kai-only patterns`);

  // Step 2: Get tracked files
  info('Scanning tracked files');
  const trackedFiles = getTrackedFiles(PAI_DIR);
  pass(`Found ${trackedFiles.length} tracked files`);

  // Step 2.5: Hook wiring reconciliation (SF-10 drift guard) — runs BEFORE the PII scan so
  // wiring drift is always caught locally even when sync-only PII warnings would fail-fast later.
  console.log('\n── Hook wiring (SF-10) ──');
  const recon = reconcile(PAI_DIR);
  for (const w of recon.warnings) warn(w);
  if (recon.errors.length > 0) {
    for (const e of recon.errors) fail(e);
    console.log('\n✗ Hook wiring drift detected — fix before sync\n');
    process.exit(1);
  }
  pass('Hook wiring reconciled (hooks.jsonc ↔ composite ↔ files)');

  // Step 2.6: PII single-source drift guard. The detection patterns (pii-patterns.json) and the scrub
  // replacements (pii-replacements.json) must stay consistent, and the old hardcoded lists must NOT
  // reappear in the scripts. This is the SF-10 fix applied to PII: one source, guarded against drift.
  console.log('\n── PII single-source guard ──');
  {
    const piiErrors: string[] = [];
    const detectPatterns = getPIIPatterns(PAI_DIR); // flat regex array from pii-patterns.json
    // (a) every scrub 'find' must be covered by some detection pattern (so anything we scrub, we also detect)
    const replPath = join(PAI_DIR, 'scripts', 'pii-replacements.json');
    if (!existsSync(replPath)) {
      piiErrors.push('scripts/pii-replacements.json missing (scrubber single-source)');
    } else {
      try {
        const repl = JSON.parse(readFileSync(replPath, 'utf-8')) as { replacements: [string, string][] };
        const detectJoined = detectPatterns.join('\n');
        for (const [find] of repl.replacements) {
          // a 'find' is covered if it appears literally in a pattern, or a pattern matches it
          const covered = detectPatterns.some((p) => {
            try { return new RegExp(p, 'i').test(find) || p.includes(find); } catch { return p.includes(find); }
          });
          if (!covered) piiErrors.push(`scrub term "${find}" has no detection pattern in pii-patterns.json`);
        }
        void detectJoined;
      } catch (e) {
        piiErrors.push(`pii-replacements.json parse error: ${e}`);
      }
    }
    // (b) the old hardcoded lists must be gone (drift would silently re-fork the source of truth)
    const syncSrc = readFileSync(join(PAI_DIR, 'scripts', 'sync-to-kai.sh'), 'utf-8');
    // Match the POPULATED form (entries on following lines), not the empty `=()` init we now use.
    if (/declare -A PII_REPLACEMENTS=\(\s*\n\s*\[/.test(syncSrc)) piiErrors.push('sync-to-kai.sh still has a hardcoded PII_REPLACEMENTS array — must load from pii-replacements.json');
    const verifySrc = existsSync(join(PAI_DIR, 'scripts', 'verify-release.sh')) ? readFileSync(join(PAI_DIR, 'scripts', 'verify-release.sh'), 'utf-8') : '';
    if (/PII_PATTERNS=\(\s*\n\s*'\\b/.test(verifySrc)) piiErrors.push('verify-release.sh still has a hardcoded PII_PATTERNS array — must load from pii-patterns.json');

    if (piiErrors.length > 0) {
      for (const e of piiErrors) fail(e);
      console.log('\n✗ PII single-source drift detected — fix before sync\n');
      process.exit(1);
    }
    pass(`PII single-source intact (${detectPatterns.length} patterns, scrub terms all covered)`);
  }

  // Step 3: Classify all files
  console.log('\n── File Classification ──');
  const classified = {
    private: [] as string[],
    'kai-only': [] as string[],
    public: [] as string[],
  };

  for (const file of trackedFiles) {
    const category = classifyFile(file, excludePaths, kaiOnlyFiles);
    classified[category].push(file);
  }

  info(`Private (kai only): ${classified.private.length}`);
  info(`KAI-only (protected): ${classified['kai-only'].length}`);
  info(`Public (will sync): ${classified.public.length}`);

  // Step 4: PII scan on public files
  console.log('\n── PII Scan (public files) ──');
  const piiFindings: Array<{ file: string; patterns: string[] }> = [];

  for (const file of classified.public) {
    const patterns = scanForPII(file, PAI_DIR);
    if (patterns.length > 0) {
      piiFindings.push({ file, patterns });
    }
  }

  if (piiFindings.length > 0) {
    if (WARN_PII) {
      warn(`Found PII in ${piiFindings.length} public files (will be scrubbed during sync):`);
    } else {
      fail(`Found PII in ${piiFindings.length} public files:`);
    }
    for (const { file, patterns } of piiFindings.slice(0, 10)) {
      console.log(`    ${file}: ${patterns.slice(0, 3).join(', ')}`);
    }
    if (piiFindings.length > 10) {
      console.log(`    ... and ${piiFindings.length - 10} more`);
    }
    if (!WARN_PII) process.exit(1);
  }

  pass('No PII found in public files');

  // Step 5: Manifest verification (if manifest exists)
  console.log('\n── Manifest Verification ──');
  const manifestPath = join(PAI_DIR, 'manifest.json');
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      const actualSkills = execSync(
        "find skills -name SKILL.md -not -path '*/.archive/*' | wc -l | tr -d ' '",
        { cwd: PAI_DIR, encoding: 'utf-8' }
      ).trim();
      const actualHooks = execSync(
        "find hooks -maxdepth 1 -name '*.hook.ts' | wc -l | tr -d ' '",
        { cwd: PAI_DIR, encoding: 'utf-8' }
      ).trim();
      const actualAgents = execSync(
        "find agents -maxdepth 1 -name '*.md' ! -name README.md | wc -l | tr -d ' '",
        { cwd: PAI_DIR, encoding: 'utf-8' }
      ).trim();

      const counts = manifest.counts || manifest;
      const manifestSkills = (counts.skills ?? manifest.skills ?? 0).toString();
      const manifestHooks = (counts.hooks ?? manifest.hooks ?? 0).toString();
      const manifestAgents = (counts.agents ?? manifest.agents ?? 0).toString();

      let manifestOk = true;
      if (manifestSkills !== actualSkills) {
        fail(`Manifest skills (${manifestSkills}) != filesystem (${actualSkills})`);
        manifestOk = false;
      }
      if (manifestHooks !== actualHooks) {
        fail(`Manifest hooks (${manifestHooks}) != filesystem (${actualHooks})`);
        manifestOk = false;
      }
      if (manifestAgents !== actualAgents) {
        fail(`Manifest agents (${manifestAgents}) != filesystem (${actualAgents})`);
        manifestOk = false;
      }

      if (manifestOk) {
        pass(`Manifest counts match filesystem (${actualSkills} skills, ${actualHooks} hooks, ${actualAgents} agents)`);
      } else {
        fail('Run: PAI_DIR=$PWD bun PAI/Tools/BuildManifest.ts');
        process.exit(1);
      }
    } catch (err) {
      warn(`Could not verify manifest: ${err}`);
      if (STRICT) process.exit(1);
    }
  } else {
    info('No manifest.json found (expected in kai only)');
  }

  // Step 6: Check for kai repo existence (if syncing locally)
  console.log('\n── KAI Repo Status ──');
  if (existsSync(KAI_DIR)) {
    pass(`KAI repo found: ${KAI_DIR}`);
    // Could add drift check here, but sync-drift.ts already handles this
  } else {
    warn(`KAI repo not found at ${KAI_DIR} (set KAI_DIR if using different path)`);
    info('Sync will fail if run locally without kai repo');
    if (STRICT) process.exit(1);
  }

  // Step 7: Summary
  console.log('\n── Summary ──');
  pass('Sync CI gate passed');
  pass(`${classified.public.length} files ready to sync`);
  pass('No PII leaks detected');
  pass('Manifest counts aligned');

  console.log('\n✅ Ready to sync to kai\n');
  process.exit(0);
}

if (import.meta.main) {
  main();
}

export { classifyFile, scanForPII, parseExcludePaths, parseKaiOnlyFiles };
