/**
 * Centralized Path Resolution
 *
 * Handles environment variable expansion for portable PAI configuration.
 * Claude Code doesn't expand $HOME in settings.json env values, so we do it here.
 *
 * Usage:
 *   import { getPaiDir, getSettingsPath } from './lib/paths';
 *   const paiDir = getPaiDir(); // Always returns expanded absolute path
 */

import { homedir } from 'os';
import { join } from 'path';

/**
 * Expand shell variables in a path string
 * Supports: $HOME, ${HOME}, ~
 */
export function expandPath(path: string): string {
  const home = homedir();

  return path
    .replace(/^\$HOME(?=\/|$)/, home)
    .replace(/^\$\{HOME\}(?=\/|$)/, home)
    .replace(/^~(?=\/|$)/, home);
}

/**
 * Get the PAI directory (expanded)
 * Priority: PAI_DIR env var (expanded) → ~/.claude
 */
export function getPaiDir(): string {
  const envPaiDir = process.env.PAI_DIR;

  if (envPaiDir) {
    return expandPath(envPaiDir);
  }

  return join(homedir(), '.claude');
}

/**
 * Get the settings.json path
 */
export function getSettingsPath(): string {
  return join(getPaiDir(), 'settings.json');
}

/**
 * Get a path relative to PAI_DIR
 */
export function paiPath(...segments: string[]): string {
  return join(getPaiDir(), ...segments);
}

/**
 * Get the hooks directory
 */
export function getHooksDir(): string {
  return paiPath('hooks');
}

/**
 * Get the skills directory
 */
export function getSkillsDir(): string {
  return paiPath('skills');
}

/**
 * Get the MEMORY directory
 */
export function getMemoryDir(): string {
  return paiPath('MEMORY');
}

/**
 * Encode an absolute project path to its Claude Code transcript/memory store dir name.
 *
 * Claude Code names `~/.claude/projects/<dir>` by replacing EVERY non-alphanumeric character with `-`
 * (so `/Users/deven.ducommun/Projects/Instant_Help` → `-Users-deven-ducommun-Projects-Instant-Help`).
 *
 * SINGLE SOURCE — fixes a system-wide bug where 6 call sites used `replace(/[/_]/g,'-')`, which missed the
 * `.` in the username (and spaces), computed a nonexistent dir, and silently fell back to GLOBAL memory.
 * That broke ALL per-project memory loading + MemoryRecall. Use this everywhere a project store dir is resolved.
 */
export function encodeProjectDir(absPath: string): string {
  return absPath.replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * Resolve a project's memory dir under the store: `<paiDir>/projects/<encoded>/memory`.
 */
export function projectMemoryDir(absProjectPath: string): string {
  return paiPath('projects', encodeProjectDir(absProjectPath), 'memory');
}
