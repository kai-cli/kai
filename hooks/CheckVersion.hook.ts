#!/usr/bin/env bun
/**
 * CheckVersion.hook.ts - Check for Claude Code Updates (SessionStart)
 *
 * Compares installed Claude Code version against npm latest.
 * Uses a 24h TTL cache to avoid spawning child processes on every session.
 *
 * TRIGGER: SessionStart
 * OUTPUT: stderr only (update notification if newer version available)
 * PERFORMANCE: <5ms (cache hit) / ~500ms (cache miss, npm fetch)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getPaiDir } from './lib/paths';

const CACHE_FILE = join(getPaiDir(), 'MEMORY', 'STATE', '.version-check-cache.json');
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface VersionCache {
  current: string;
  latest: string;
  checkedAt: number;
}

function readCache(): VersionCache | null {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    const data = JSON.parse(readFileSync(CACHE_FILE, 'utf-8')) as VersionCache;
    if (Date.now() - data.checkedAt < TTL_MS) return data;
    return null;
  } catch {
    return null;
  }
}

function writeCache(cache: VersionCache): void {
  try {
    mkdirSync(join(getPaiDir(), 'MEMORY', 'STATE'), { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(cache));
  } catch { /* non-fatal */ }
}

async function getCurrentVersion(): Promise<string> {
  try {
    const proc = Bun.spawn(['claude', '--version'], { stdout: 'pipe', stderr: 'pipe' });
    const output = await new Response(proc.stdout).text();
    const match = output.match(/(\d+\.\d+\.\d+)/);
    return match ? match[1] : 'unknown';
  } catch {
    return 'unknown';
  }
}

async function getLatestVersion(): Promise<string> {
  try {
    const proc = Bun.spawn(['npm', 'view', '@anthropic-ai/claude-code', 'version'], { stdout: 'pipe', stderr: 'pipe' });
    const output = await new Response(proc.stdout).text();
    return output.trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

async function main() {
  try {
    // Skip on compaction
    try {
      const stdinText = await Bun.stdin.text();
      if (stdinText.trim()) {
        const hookInput = JSON.parse(stdinText);
        if (hookInput.source === 'compact') process.exit(0);
      }
    } catch { /* proceed */ }

    // Skip for subagents
    const claudeProjectDir = process.env.CLAUDE_PROJECT_DIR || '';
    if (claudeProjectDir.includes('/.claude/Agents/') || process.env.CLAUDE_AGENT_TYPE !== undefined) {
      process.exit(0);
    }

    // Check TTL cache first
    const cached = readCache();
    if (cached) {
      if (cached.current !== cached.latest) {
        console.error(`💡 Update available: CC ${cached.current} → ${cached.latest}`);
      }
      process.exit(0);
    }

    // Cache miss — fetch fresh
    const [currentVersion, latestVersion] = await Promise.all([
      getCurrentVersion(),
      getLatestVersion()
    ]);

    if (currentVersion !== 'unknown' && latestVersion !== 'unknown') {
      writeCache({ current: currentVersion, latest: latestVersion, checkedAt: Date.now() });
      if (currentVersion !== latestVersion) {
        console.error(`💡 Update available: CC ${currentVersion} → ${latestVersion}`);
      }
    }

    process.exit(0);
  } catch {
    process.exit(0);
  }
}

main().catch((err) => { console.error(`[CheckVersion] Error:`, err); process.exit(0); });
