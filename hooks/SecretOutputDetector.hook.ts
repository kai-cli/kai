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

const PAI_DIR = process.env.PAI_DIR || join(process.env.HOME!, '.claude');
const SECURITY_LOG = join(PAI_DIR, 'MEMORY', 'SECURITY', 'security-events.jsonl');

// Same patterns as SecretScanner — scan tool OUTPUT for leakage
const SECRET_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: 'API key (generic)', pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"]?[A-Za-z0-9_\-]{20,}['"]?/i },
  { name: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'AWS Secret Key', pattern: /(?:aws[_-]?secret|secret[_-]?access[_-]?key)\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/i },
  { name: 'Anthropic API Key', pattern: /sk-ant-[A-Za-z0-9_\-]{40,}/ },
  { name: 'OpenAI API Key', pattern: /sk-[A-Za-z0-9]{40,}/ },
  { name: 'GitHub Token', pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/ },
  { name: 'Bearer token', pattern: /[Bb]earer\s+[A-Za-z0-9_\-\.]{20,}/ },
  { name: 'Private key block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'Password in env/config', pattern: /(?:PASSWORD|PASSWD|SECRET)\s*=\s*['"]?[^\s'"]{8,}['"]?/ },
];

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

main();
