#!/usr/bin/env bun
/**
 * MemoryAccessTracker.hook.ts — Track detail-file reads for memory metadata
 *
 * TRIGGER: PostToolUse (Read tool)
 * PURPOSE: When the model reads a memory detail file, increment reference_count
 *          in memory-meta.jsonl. This keeps eviction scoring accurate.
 *
 * Fast-path: exits immediately if the Read target is not a memory path.
 */

import { join } from 'path';
import { getPaiDir } from './lib/paths';
import { recordDetailRead } from './lib/memory-disclosure';

async function main() {
  try {
    let toolInput: { file_path?: string } = {};

    try {
      const stdinText = await Bun.stdin.text();
      if (stdinText.trim()) {
        const payload = JSON.parse(stdinText);
        // PostToolUse payload: { tool_name, tool_input, tool_response, ... }
        toolInput = payload.tool_input || {};
      }
    } catch {
      process.exit(0);
    }

    const filePath = toolInput.file_path || '';

    // Fast-path: skip non-memory reads
    if (!filePath.includes('/memory/') && !filePath.includes('/MEMORY/')) {
      process.exit(0);
    }

    // Only track .md detail files (not index or state files)
    if (!filePath.endsWith('.md')) {
      process.exit(0);
    }

    const paiDir = getPaiDir();
    recordDetailRead(paiDir, filePath);
    console.error(`[MemoryAccessTracker] Tracked detail read: ${filePath}`);
    process.exit(0);
  } catch (err) {
    console.error('[MemoryAccessTracker] Error:', err);
    process.exit(0);
  }
}

if (import.meta.main) main();
