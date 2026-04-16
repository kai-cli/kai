#!/usr/bin/env bun
/**
 * WebFetchGuard.hook.ts - URL validation for WebFetch and WebSearch (PreToolUse)
 *
 * PURPOSE:
 * Validates outbound URLs before WebFetch/WebSearch executes.
 * Blocks internal network ranges, logs all outbound requests.
 *
 * TRIGGER: PreToolUse (matcher: WebFetch, WebSearch)
 *
 * OUTPUT:
 * - {"continue": true}           → Allow
 * - {"decision": "block", ...}   → Hard block (internal network)
 * - {"decision": "ask", ...}     → Confirm (suspicious pattern)
 */

import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const PAI_DIR = process.env.PAI_DIR || join(process.env.HOME!, '.claude');
const SECURITY_LOG = join(PAI_DIR, 'MEMORY', 'SECURITY', 'security-events.jsonl');

// Internal network ranges — should never be fetched
const BLOCKED_PATTERNS = [
  /^https?:\/\/(?:10\.\d+\.\d+\.\d+)/,           // 10.x.x.x
  /^https?:\/\/(?:192\.168\.\d+\.\d+)/,           // 192.168.x.x
  /^https?:\/\/(?:172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)/, // 172.16-31.x.x
  /^https?:\/\/(?:127\.\d+\.\d+\.\d+)/,           // 127.x.x.x (loopback)
  /^https?:\/\/localhost/,                          // localhost
  /^https?:\/\/0\.0\.0\.0/,                        // 0.0.0.0
  /^file:\/\//,                                     // file:// protocol
];

// Suspicious but ask-before-fetching patterns
const SUSPICIOUS_PATTERNS = [
  { pattern: /ngrok\.io/, reason: 'ngrok tunnel — unusual for automated fetch' },
  { pattern: /pastebin\.com|paste\.ee|hastebin/, reason: 'paste service — potential data exfil target' },
  { pattern: /\.(onion)$/, reason: 'Tor hidden service' },
];

function logEvent(level: string, url: string, reason: string, tool: string): void {
  try {
    mkdirSync(join(PAI_DIR, 'MEMORY', 'SECURITY'), { recursive: true });
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      tool,
      url: url.slice(0, 200), // truncate — don't log full URLs with params
      reason,
    };
    appendFileSync(SECURITY_LOG, JSON.stringify(entry) + '\n');
  } catch { /* non-fatal */ }
}

async function main() {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString());

    const toolName = input.tool_name || '';
    const toolInput = input.tool_input || {};

    // Extract URL from WebFetch or WebSearch
    const url: string = toolInput.url || toolInput.query || '';

    if (!url) {
      process.stdout.write(JSON.stringify({ continue: true }));
      process.exit(0);
    }

    // Check blocked patterns (internal networks)
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(url)) {
        logEvent('blocked', url, 'internal network range', toolName);
        process.stdout.write(JSON.stringify({
          decision: 'block',
          reason: `[WebFetchGuard] Blocked: internal network URL detected. URL: ${url.slice(0, 80)}`,
        }));
        process.exit(0);
      }
    }

    // Check suspicious patterns (ask)
    for (const { pattern, reason } of SUSPICIOUS_PATTERNS) {
      if (pattern.test(url)) {
        logEvent('suspicious', url, reason, toolName);
        process.stdout.write(JSON.stringify({
          decision: 'ask',
          message: `[WebFetchGuard] Unusual URL pattern detected (${reason}): ${url.slice(0, 100)}\n\nProceed?`,
        }));
        process.exit(0);
      }
    }

    // Log all outbound fetches (allow)
    logEvent('allowed', url, 'outbound fetch logged', toolName);
    process.stdout.write(JSON.stringify({ continue: true }));
    process.exit(0);

  } catch (err) {
    // Fail open — don't block on guard errors
    console.error(`[WebFetchGuard] Error (fail-open): ${err}`);
    process.stdout.write(JSON.stringify({ continue: true }));
    process.exit(0);
  }
}

main();
