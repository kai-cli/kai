#!/usr/bin/env bun
/**
 * WriteTracker.hook.ts — Track PAI file writes for revert detection
 *
 * TRIGGER: PostToolUse (async)
 * PURPOSE: Log Write/Edit tool calls so InstinctCapture can detect user reverts.
 *
 * Maintains a session-scoped ledger at MEMORY/STATE/session-writes.jsonl.
 * Each entry records the file path and a content hash of what PAI wrote.
 * InstinctCapture reads this ledger to detect when a user reverts KAI's changes.
 *
 * Ledger is cleared at session start by LoadContext.hook.ts.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { createHash } from 'crypto';
import { getPaiDir, paiPath } from './lib/paths';

const LEDGER_FILE = 'MEMORY/STATE/session-writes.jsonl';

export interface WriteEntry {
  path: string;
  timestamp: string;
  contentHash: string;
  snippet: string;
}

interface HookInput {
  session_id?: string;
  tool_name?: string;
  tool_input?: {
    file_path?: string;
    content?: string;
    old_string?: string;
    new_string?: string;
  };
}

function ledgerPath(paiDir: string): string {
  return join(paiDir, LEDGER_FILE);
}

export function loadLedger(paiDir: string): WriteEntry[] {
  const path = ledgerPath(paiDir);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, 'utf-8')
      .trim()
      .split('\n')
      .filter(l => l.trim())
      .map(l => JSON.parse(l) as WriteEntry);
  } catch {
    return [];
  }
}

export function clearLedger(paiDir: string): void {
  const path = ledgerPath(paiDir);
  if (existsSync(path)) writeFileSync(path, '');
}

function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function extractSnippet(toolInput: HookInput['tool_input']): string {
  if (!toolInput) return '';
  if (toolInput.new_string) {
    return toolInput.new_string.substring(0, 120).replace(/\n/g, ' ');
  }
  if (toolInput.content) {
    return toolInput.content.substring(0, 120).replace(/\n/g, ' ');
  }
  return '';
}

function getWrittenContent(toolInput: HookInput['tool_input']): string {
  if (!toolInput) return '';
  if (toolInput.content) return toolInput.content;
  if (toolInput.new_string) return toolInput.new_string;
  return '';
}

async function main() {
  try {
    const decoder = new TextDecoder();
    const reader = Bun.stdin.stream().getReader();
    let raw = '';
    const timeout = setTimeout(() => process.exit(0), 500);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      raw += decoder.decode(value, { stream: true });
    }
    clearTimeout(timeout);

    if (!raw.trim()) process.exit(0);
    const input: HookInput = JSON.parse(raw);

    const toolName = input.tool_name ?? '';
    if (toolName !== 'Write' && toolName !== 'Edit') process.exit(0);

    const filePath = input.tool_input?.file_path;
    if (!filePath) process.exit(0);

    const content = getWrittenContent(input.tool_input);
    if (!content) process.exit(0);

    const paiDir = getPaiDir();
    const stateDir = join(paiDir, 'MEMORY', 'STATE');
    mkdirSync(stateDir, { recursive: true });

    const entry: WriteEntry = {
      path: filePath,
      timestamp: new Date().toISOString(),
      contentHash: computeHash(content),
      snippet: extractSnippet(input.tool_input),
    };

    // Append-or-replace: read existing, remove old entry for same path, append new
    const existing = loadLedger(paiDir).filter(e => e.path !== filePath);
    existing.push(entry);

    writeFileSync(ledgerPath(paiDir), existing.map(e => JSON.stringify(e)).join('\n') + '\n');
  } catch {
    // Never block — fail silently
  }
  process.exit(0);
}

if (import.meta.main) main();
