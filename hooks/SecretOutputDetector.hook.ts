#!/usr/bin/env bun
/**
 * SecretOutputDetector.hook.ts - Scan tool output for leaked secrets (PostToolUse)
 *
 * PURPOSE:
 * Scans tool output (Bash, WebFetch) for secret patterns after execution.
 * Alerts (never blocks) when potential credential is detected in output.
 * Piggybacks on SecretScanner patterns.
 *
 * TRIGGER: PostToolUse (matcher: Bash, WebFetch)
 *
 * OUTPUT:
 * - {"continue": true}                  → No secrets detected
 * - {"decision": "ask", "message": ...} → Potential secret in output, warn
 */

import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { SECRET_PATTERNS as SHARED_PATTERNS } from './lib/secret-patterns';

const PAI_DIR = process.env.PAI_DIR || join(process.env.HOME!, '.claude');
const SECURITY_LOG = join(PAI_DIR, 'MEMORY', 'SECURITY', 'security-events.jsonl');

// Single-sourced from hooks/lib/secret-patterns.ts (the UNION shared with SecretScanner — no drift).
// Re-exported here so the existing test (imports SECRET_PATTERNS + scanForSecrets) and the
// SecurityAuditLoop log contract keep working unchanged.
export const SECRET_PATTERNS = SHARED_PATTERNS;

function logDetection(toolName: string, patternName: string): void {
  try {
    mkdirSync(join(PAI_DIR, 'MEMORY', 'SECURITY'), { recursive: true });
    appendFileSync(SECURITY_LOG, JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'alert',
      hook: 'SecretOutputDetector',
      tool: toolName,
      pattern: patternName,
      note: 'Potential secret in tool output — content not logged',
    }) + '\n');
  } catch { /* non-fatal */ }
}

export function scanForSecrets(output: string): { detected: string[] } {
  const detected: string[] = [];
  // Only scan first 8KB — secrets typically appear early in output
  const scanTarget = output.slice(0, 8192);

  for (const { name, pattern } of SECRET_PATTERNS) {
    if (pattern.test(scanTarget)) {
      detected.push(name);
    }
  }

  return { detected };
}

async function main() {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString());

    const toolName: string = input.tool_name || '';
    // PostToolUse: output is in tool_response
    const output: string = typeof input.tool_response === 'string'
      ? input.tool_response
      : JSON.stringify(input.tool_response || '');

    if (!output || output.length < 10) {
      process.stdout.write(JSON.stringify({ continue: true }));
      process.exit(0);
    }

    // Only scan first 8KB — secrets typically appear early in output
    const scanTarget = output.slice(0, 8192);

    const detected: string[] = [];
    for (const { name, pattern } of SECRET_PATTERNS) {
      if (pattern.test(scanTarget)) {
        detected.push(name);
        logDetection(toolName, name);
      }
    }

    if (detected.length === 0) {
      process.stdout.write(JSON.stringify({ continue: true }));
      process.exit(0);
    }

    // Alert — never block, just warn
    process.stdout.write(JSON.stringify({
      decision: 'ask',
      message: `⚠️ [SecretOutputDetector] Potential secret pattern detected in ${toolName} output:\n• ${detected.join('\n• ')}\n\nThis has been logged. The output may contain credentials — review before sharing or storing.`,
    }));
    process.exit(0);

  } catch (err) {
    // Fail open
    console.error(`[SecretOutputDetector] Error (fail-open): ${err}`);
    process.stdout.write(JSON.stringify({ continue: true }));
    process.exit(0);
  }
}

// Only run main if executed directly (not imported)
if (import.meta.main) {
  main().catch((err) => { console.error(`[SecretOutputDetector] Error:`, err); process.exit(0); });
}
