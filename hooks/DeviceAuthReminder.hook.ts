#!/usr/bin/env bun
/**
 * DeviceAuthReminder.hook.ts — Inject device auth context on SSH/device access attempts
 *
 * TRIGGER: PreToolUse (Bash only)
 *
 * PURPOSE:
 * When the model attempts SSH, sshpass, or any command targeting device IPs (192.168.1.1),
 * inject a context reminder with the correct auth method. Prevents the model from
 * guessing passwords or ignoring loaded TOOLS.md auth patterns.
 *
 * This does NOT block — it adds context so the model self-corrects before execution.
 * If the command already uses the correct auth pattern (env var reference), it passes silently.
 *
 * PERFORMANCE:
 * - Blocking: No (adds context, does not block)
 * - Typical execution: <5ms (regex only, no I/O)
 */

interface HookInput {
  tool_name?: string;
  tool_input?: {
    command?: string;
  };
}

const DEVICE_PATTERNS = [
  /\bssh\b/,
  /\bsshpass\b/,
  /\bscp\b/,
  /192\.168\.1\.1/,
  /mcp__router/,
];

const CORRECT_AUTH_PATTERNS = [
  /\$YOURCOMPANY_ROUTER_M6[02](DU)?_PASS/,
  /\$\{YOURCOMPANY_ROUTER_M6[02](DU)?_PASS\}/,
  /"\$YOURCOMPANY_ROUTER_M6[02](DU)?_PASS"/,
];

async function main() {
  let input: HookInput;
  try {
    const stdinText = await Bun.stdin.text();
    input = JSON.parse(stdinText);
  } catch {
    process.exit(0);
  }

  if (input.tool_name !== 'Bash') process.exit(0);

  const command = input.tool_input?.command || '';
  if (!command) process.exit(0);

  const isDeviceAccess = DEVICE_PATTERNS.some(p => p.test(command));
  if (!isDeviceAccess) process.exit(0);

  const usesCorrectAuth = CORRECT_AUTH_PATTERNS.some(p => p.test(command));
  if (usesCorrectAuth) {
    // Already using proper env var auth — pass silently
    console.log(JSON.stringify({ continue: true }));
    process.exit(0);
  }

  // Detect bare ssh without sshpass (will prompt for password interactively — always wrong)
  const isBareSSH = /\bssh\b/.test(command) && !/\bsshpass\b/.test(command) && !/StrictHostKeyChecking/.test(command);

  if (isBareSSH) {
    // Block bare SSH — it will hang waiting for interactive password input
    const message = `⚠️ DEVICE AUTH REQUIRED — bare ssh will hang (no interactive input).

Use this pattern instead:
  sshpass -p "$YOURCOMPANY_ROUTER_M62_PASS" ssh -o StrictHostKeyChecking=no root@192.168.1.1 "<command>"
  sshpass -p "$YOURCOMPANY_ROUTER_M60_PASS" ssh -o StrictHostKeyChecking=no root@192.168.1.1 "<command>"

Device registry: ~/.config/yourcompany-mcp/devices.json
M62 (lab, SSH): env YOURCOMPANY_ROUTER_M62_PASS
M60 (remote, USP-only): env YOURCOMPANY_ROUTER_M60_PASS — SSH may not be available

Or use MCP tools: mcp__router__router_exec (handles auth automatically)`;

    console.log(JSON.stringify({ decision: "block", message }));
    process.exit(0);
  }

  // For sshpass without env var (hardcoded password attempt) or other patterns
  const hasHardcodedPassword = /sshpass\s+-p\s+["']?[^$]/.test(command) || /sshpass\s+-p\s+[^"'\s$]/.test(command);

  if (hasHardcodedPassword) {
    const message = `⚠️ NEVER hardcode device passwords. Use env vars:
  sshpass -p "$YOURCOMPANY_ROUTER_M62_PASS" ssh ...
  sshpass -p "$YOURCOMPANY_ROUTER_M60_PASS" ssh ...

Passwords are in env vars (loaded from ~/.zshenv). See TOOLS.md.`;

    console.log(JSON.stringify({ decision: "block", message }));
    process.exit(0);
  }

  // General device access without clear auth — add context reminder (don't block)
  const context = `<device-auth-reminder>
Device access detected. Auth reference:
- M62 (lab SSH): sshpass -p "$YOURCOMPANY_ROUTER_M62_PASS" ssh -o StrictHostKeyChecking=no root@192.168.1.1
- M60 (remote): USP-only via ACSPlatform (env YOURCOMPANY_OKTOPUS_EMAIL/PASS) — no SSH
- MCP tools: mcp__router__router_exec (serial from ~/.config/yourcompany-mcp/devices.json)
- Device registry: see ~/.config/yourcompany-mcp/devices.json
</device-auth-reminder>`;

  console.log(JSON.stringify({ additionalContext: context }));
  process.exit(0);
}

main();
