#!/usr/bin/env bun
/**
 * SecurityValidator.hook.ts - Security Validation for Tool Calls (PreToolUse)
 *
 * PURPOSE:
 * Validates Bash commands and file operations against security patterns before
 * execution. Prevents accidental or malicious operations that could damage the
 * system, expose secrets, or compromise security.
 *
 * TRIGGER: PreToolUse (matcher: Bash, Edit, Write, Read, Glob, Grep)
 *
 * INPUT:
 * - tool_name: "Bash" | "Edit" | "Write" | "Read"
 * - tool_input: { command?: string, file_path?: string, ... }
 * - session_id: Current session identifier
 *
 * OUTPUT:
 * - stdout: JSON decision object
 *   - {"continue": true} → Allow operation
 *   - {hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"ask",…}} → confirm (2.1.185)
 * - exit(0): Normal completion (with decision)
 * - exit(2): Hard block (catastrophic operation prevented)
 *
 * SIDE EFFECTS:
 * - Writes to: MEMORY/SECURITY/security-events.jsonl (blocks + alerts only, 90-day rolling)
 * - User prompt: May trigger confirmation dialog for confirm-level operations
 *
 * INTER-HOOK RELATIONSHIPS:
 * - DEPENDS ON: patterns.yaml (security pattern definitions)
 * - COORDINATES WITH: None (standalone validation)
 * - MUST RUN BEFORE: Tool execution (blocking)
 * - MUST RUN AFTER: None
 *
 * ERROR HANDLING:
 * - Missing patterns.yaml: Uses default safe patterns
 * - Parse errors: Logs warning, allows operation (fail-open for usability)
 * - Logging failures: Silent (should not block operations)
 *
 * PERFORMANCE:
 * - Blocking: Yes (must complete before tool executes)
 * - Typical execution: <10ms
 * - Design: Fast path for safe operations, pattern matching only when needed
 *
 * PATTERN CATEGORIES:
 * Bash commands:
 * - blocked: Always prevented (rm -rf /, format, etc.)
 * - confirm: Requires user confirmation (git push --force, etc.)
 * - alert: Logged but allowed (sudo, etc.)
 *
 * File paths:
 * - zeroAccess: Never readable or writable (~/.ssh, credentials, etc.)
 * - readOnly: Readable but not writable (system configs)
 * - confirmWrite: Requires confirmation to write
 * - noDelete: Cannot be deleted
 *
 * SECURITY MODEL:
 * - Defense in depth: Multiple pattern layers
 * - Fail-safe for catastrophic operations (exit 2)
 * - Fail-open for minor concerns (log and allow)
 * - All decisions logged for audit trail
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync, appendFileSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { paiPath, expandPath } from './lib/paths';
import { classifyCommand } from './lib/risk-classifier';
import { askPreToolUse } from './lib/hook-io';

// ========================================
// Security Event Logging
// ========================================

// Single rolling log: MEMORY/SECURITY/security-events.jsonl
// Only blocks and alerts are recorded — confirms/allows are expected behavior, not incidents.
// Rotated on write: entries older than LOG_RETENTION_DAYS are dropped.

const SECURITY_LOG = paiPath('MEMORY', 'SECURITY', 'security-events.jsonl');
const LOG_RETENTION_DAYS = 90;

interface SecurityEvent {
  timestamp: string;
  session_id: string;
  event_type: 'block' | 'confirm' | 'alert' | 'allow';
  tool: string;
  category: 'bash_command' | 'path_access';
  target: string;  // command or path
  pattern_matched?: string;
  reason?: string;
  action_taken: string;
}

export function trimOldEntries(logPath: string): void {
  if (!existsSync(logPath)) return;
  try {
    const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const lines = readFileSync(logPath, 'utf-8').split('\n').filter(l => l.trim());
    const kept = lines.filter(line => {
      try { return new Date(JSON.parse(line).timestamp).getTime() >= cutoff; }
      catch { return false; }
    });
    if (kept.length < lines.length) {
      writeFileSync(logPath, kept.join('\n') + (kept.length > 0 ? '\n' : ''));
    }
  } catch { /* non-fatal */ }
}

const TRIM_SENTINEL = paiPath('MEMORY', 'SECURITY', '.last-trim');

function shouldTrimToday(): boolean {
  try {
    if (!existsSync(TRIM_SENTINEL)) return true;
    const lastTrim = readFileSync(TRIM_SENTINEL, 'utf-8').trim();
    return lastTrim !== new Date().toISOString().substring(0, 10);
  } catch { return true; }
}

function logSecurityEvent(event: SecurityEvent): void {
  if (event.event_type === 'confirm' || event.event_type === 'allow') return;

  try {
    const dir = paiPath('MEMORY', 'SECURITY');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (shouldTrimToday()) {
      trimOldEntries(SECURITY_LOG);
      writeFileSync(TRIM_SENTINEL, new Date().toISOString().substring(0, 10));
    }
    appendFileSync(SECURITY_LOG, JSON.stringify(event) + '\n');
  } catch {
    // Logging failure should not block operations
  }
}

// ========================================
// Types
// ========================================

interface HookInput {
  session_id: string;
  tool_name: string;
  tool_input: Record<string, unknown> | string;
}

interface Pattern {
  pattern: string;
  reason: string;
}

interface PatternsConfig {
  version: string;
  philosophy: {
    mode: string;
    principle: string;
  };
  bash: {
    trusted: Pattern[];
    blocked: Pattern[];
    confirm: Pattern[];
    alert: Pattern[];
  };
  paths: {
    zeroAccess: string[];
    readOnly: string[];
    confirmWrite: string[];
    noDelete: string[];
  };
  projects: Record<string, {
    path: string;
    rules: Array<{ action: string; reason: string }>;
  }>;
}

// ========================================
// Config Loading - Cascading Path Lookup
// ========================================

// Pattern paths in priority order:
// 1. PAI/USER/PAISECURITYSYSTEM/patterns.json (user's custom rules)
// 2. skills/PAI/PAISECURITYSYSTEM/patterns.example.json (default template)
// Legacy YAML fallback for backwards compatibility
// NOTE: computed lazily via paiPath() to respect PAI_DIR changes (e.g. in tests)
function getUserPatternsPath() { return paiPath('PAI', 'USER', 'PAISECURITYSYSTEM', 'patterns.json'); }
function getUserPatternsYaml() { return paiPath('PAI', 'USER', 'PAISECURITYSYSTEM', 'patterns.yaml'); }
function getSystemPatternsPath() { return paiPath('skills', 'PAI', 'PAISECURITYSYSTEM', 'patterns.example.json'); }
function getSystemPatternsYaml() { return paiPath('skills', 'PAI', 'PAISECURITYSYSTEM', 'patterns.example.yaml'); }

let patternsCache: PatternsConfig | null = null;
let patternsSource: 'user' | 'system' | 'none' = 'none';

export function resetPatternsCache(): void {
  patternsCache = null;
  patternsSource = 'none';
}

function getPatternsPath(): string | null {
  // Try USER JSON first (fast path)
  const userJson = getUserPatternsPath();
  if (existsSync(userJson)) {
    patternsSource = 'user';
    return userJson;
  }

  // Fall back to SYSTEM JSON
  const systemJson = getSystemPatternsPath();
  if (existsSync(systemJson)) {
    patternsSource = 'system';
    return systemJson;
  }

  // Legacy: fall back to YAML if JSON doesn't exist yet
  const userYaml = getUserPatternsYaml();
  if (existsSync(userYaml)) {
    patternsSource = 'user';
    return userYaml;
  }

  // System YAML fallback (patterns.example.yaml is tracked in git)
  const systemYaml = getSystemPatternsYaml();
  if (existsSync(systemYaml)) {
    patternsSource = 'system';
    return systemYaml;
  }

  // No patterns found
  patternsSource = 'none';
  return null;
}

export function loadPatterns(): PatternsConfig {
  if (patternsCache) return patternsCache;

  const patternsPath = getPatternsPath();

  if (!patternsPath) {
    // No patterns file - fail open (allow all)
    return {
      version: '0.0',
      philosophy: { mode: 'permissive', principle: 'No patterns loaded - fail open' },
      bash: { trusted: [], blocked: [], confirm: [], alert: [] },
      paths: { zeroAccess: [], readOnly: [], confirmWrite: [], noDelete: [] },
      projects: {}
    };
  }

  try {
    const content = readFileSync(patternsPath, 'utf-8');
    if (patternsPath.endsWith('.yaml')) {
      // Legacy YAML fallback — dynamic import to avoid loading yaml module on fast path
      const { parse: parseYaml } = require('yaml');
      patternsCache = parseYaml(content) as PatternsConfig;
    } else {
      patternsCache = JSON.parse(content) as PatternsConfig;
    }
    return patternsCache;
  } catch (error) {
    // Parse error - fail open
    console.error(`Failed to parse ${patternsSource} patterns:`, error);
    return {
      version: '0.0',
      philosophy: { mode: 'permissive', principle: 'Parse error - fail open' },
      bash: { trusted: [], blocked: [], confirm: [], alert: [] },
      paths: { zeroAccess: [], readOnly: [], confirmWrite: [], noDelete: [] },
      projects: {}
    };
  }
}

// ========================================
// Command Normalization
// ========================================

/**
 * Strip leading environment variable assignments from a command.
 * Prevents bypass like: LANG=C rm -rf / or FOO="bar" dangerous-cmd
 * Also strips leading whitespace.
 */
export function stripEnvVarPrefix(command: string): string {
  return command.replace(
    /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]*)\s+)*/,
    ''
  );
}

// ========================================
// Pattern Matching
// ========================================

export function matchesPattern(command: string, pattern: string): boolean {
  // Convert pattern to regex
  // Patterns can use .* for wildcards
  try {
    const regex = new RegExp(pattern, 'i');
    return regex.test(command);
  } catch {
    // Invalid regex - try literal match
    return command.toLowerCase().includes(pattern.toLowerCase());
  }
}


export function matchesPathPattern(filePath: string, pattern: string): boolean {
  const expandedPattern = expandPath(pattern);
  const expandedPath = expandPath(filePath);

  // Handle glob patterns
  if (pattern.includes('*')) {
    // First replace ** with a placeholder, then escape, then convert back
    let regexPattern = expandedPattern
      .replace(/\*\*/g, '<<<DOUBLESTAR>>>')  // Protect **
      .replace(/\*/g, '<<<SINGLESTAR>>>')    // Protect *
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape special chars
      .replace(/<<<DOUBLESTAR>>>/g, '.*')    // ** = anything including /
      .replace(/<<<SINGLESTAR>>>/g, '[^/]*'); // * = anything except /

    try {
      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(expandedPath);
    } catch {
      return false;
    }
  }

  // Exact match or prefix match for directories
  return expandedPath === expandedPattern ||
         expandedPath.startsWith(expandedPattern.endsWith('/') ? expandedPattern : expandedPattern + '/');
}

// ========================================
// Bash Command Validation
// ========================================

export function validateBashCommand(command: string): { action: 'allow' | 'block' | 'confirm' | 'alert'; reason?: string } {
  const patterns = loadPatterns();

  // Risk classifier fast-path: read-only commands are always safe
  const risk = classifyCommand(command);
  if (risk.is_read_only && !risk.is_destructive) {
    return { action: 'allow' };
  }

  // Check trusted patterns FIRST (fast-path allow, no logging)
  for (const p of (patterns.bash.trusted || [])) {
    if (matchesPattern(command, p.pattern)) {
      return { action: 'allow' };
    }
  }

  // Check blocked patterns (hard block)
  for (const p of patterns.bash.blocked) {
    if (matchesPattern(command, p.pattern)) {
      return { action: 'block', reason: p.reason };
    }
  }

  // Check confirm patterns (prompt user)
  for (const p of patterns.bash.confirm) {
    if (matchesPattern(command, p.pattern)) {
      return { action: 'confirm', reason: p.reason };
    }
  }

  // Check alert patterns (log but allow)
  for (const p of patterns.bash.alert) {
    if (matchesPattern(command, p.pattern)) {
      return { action: 'alert', reason: p.reason };
    }
  }

  return { action: 'allow' };
}

// ========================================
// Path Validation
// ========================================

type PathAction = 'read' | 'write' | 'delete';

export function validatePath(filePath: string, action: PathAction): { action: 'allow' | 'block' | 'confirm'; reason?: string } {
  const patterns = loadPatterns();

  // Check zeroAccess (complete denial)
  for (const p of patterns.paths.zeroAccess) {
    if (matchesPathPattern(filePath, p)) {
      return { action: 'block', reason: `Zero access path: ${p}` };
    }
  }

  // Check readOnly (can read, cannot write/delete)
  if (action === 'write' || action === 'delete') {
    for (const p of patterns.paths.readOnly) {
      if (matchesPathPattern(filePath, p)) {
        return { action: 'block', reason: `Read-only path: ${p}` };
      }
    }
  }

  // Check confirmWrite (can read, writing requires confirmation)
  if (action === 'write') {
    for (const p of patterns.paths.confirmWrite) {
      if (matchesPathPattern(filePath, p)) {
        return { action: 'confirm', reason: `Writing to protected file requires confirmation: ${p}` };
      }
    }
  }

  // Check noDelete (can read/write, cannot delete)
  if (action === 'delete') {
    for (const p of patterns.paths.noDelete) {
      if (matchesPathPattern(filePath, p)) {
        return { action: 'block', reason: `Cannot delete protected path: ${p}` };
      }
    }
  }

  return { action: 'allow' };
}

// ========================================
// Tool-Specific Handlers
// ========================================

function handleBash(input: HookInput): void {
  const rawCommand = typeof input.tool_input === 'string'
    ? input.tool_input
    : (input.tool_input?.command as string) || '';

  if (!rawCommand) {
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  // Normalize: strip env var prefixes to prevent bypass (e.g., LANG=C rm -rf /)
  const command = stripEnvVarPrefix(rawCommand);
  const result = validateBashCommand(command);

  switch (result.action) {
    case 'block':
      logSecurityEvent({
        timestamp: new Date().toISOString(),
        session_id: input.session_id,
        event_type: 'block',
        tool: 'Bash',
        category: 'bash_command',
        target: command.slice(0, 500),
        reason: result.reason,
        action_taken: 'Hard block - exit 2'
      });
      console.error(`[KAI SECURITY] 🚨 BLOCKED: ${result.reason}`);
      console.error(`Command: ${command.slice(0, 100)}`);
      process.exit(2);
      break;

    case 'confirm':
      logSecurityEvent({
        timestamp: new Date().toISOString(),
        session_id: input.session_id,
        event_type: 'confirm',
        tool: 'Bash',
        category: 'bash_command',
        target: command.slice(0, 500),
        reason: result.reason,
        action_taken: 'Prompted user for confirmation'
      });
      console.log(JSON.stringify(askPreToolUse(
        `[KAI SECURITY] ⚠️ ${result.reason}\n\nCommand: ${command.slice(0, 200)}\n\nProceed?`
      )));
      break;

    case 'alert':
      logSecurityEvent({
        timestamp: new Date().toISOString(),
        session_id: input.session_id,
        event_type: 'alert',
        tool: 'Bash',
        category: 'bash_command',
        target: command.slice(0, 500),
        reason: result.reason,
        action_taken: 'Logged alert, allowed execution'
      });
      console.error(`[KAI SECURITY] ⚠️ ALERT: ${result.reason}`);
      console.error(`Command: ${command.slice(0, 100)}`);
      console.log(JSON.stringify({ continue: true }));
      break;

    default:
      console.log(JSON.stringify({ continue: true }));
  }
}

function handleFileWrite(input: HookInput, toolName: string): void {
  const filePath = typeof input.tool_input === 'string'
    ? input.tool_input
    : (input.tool_input?.file_path as string) || '';

  if (!filePath) {
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  const result = validatePath(filePath, 'write');

  switch (result.action) {
    case 'block':
      logSecurityEvent({
        timestamp: new Date().toISOString(),
        session_id: input.session_id,
        event_type: 'block',
        tool: toolName,
        category: 'path_access',
        target: filePath,
        reason: result.reason,
        action_taken: 'Hard block - exit 2'
      });
      console.error(`[KAI SECURITY] 🚨 BLOCKED: ${result.reason}`);
      console.error(`Path: ${filePath}`);
      process.exit(2);
      break;

    case 'confirm':
      logSecurityEvent({
        timestamp: new Date().toISOString(),
        session_id: input.session_id,
        event_type: 'confirm',
        tool: toolName,
        category: 'path_access',
        target: filePath,
        reason: result.reason,
        action_taken: 'Prompted user for confirmation'
      });
      console.log(JSON.stringify(askPreToolUse(
        `[KAI SECURITY] ⚠️ ${result.reason}\n\nPath: ${filePath}\n\nProceed?`
      )));
      break;

    default:
      console.log(JSON.stringify({ continue: true }));
  }
}

function handleRead(input: HookInput): void {
  const filePath = typeof input.tool_input === 'string'
    ? input.tool_input
    : (input.tool_input?.file_path as string) || '';

  if (!filePath) {
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  const result = validatePath(filePath, 'read');

  switch (result.action) {
    case 'block':
      logSecurityEvent({
        timestamp: new Date().toISOString(),
        session_id: input.session_id,
        event_type: 'block',
        tool: 'Read',
        category: 'path_access',
        target: filePath,
        reason: result.reason,
        action_taken: 'Hard block - exit 2'
      });
      console.error(`[KAI SECURITY] 🚨 BLOCKED: ${result.reason}`);
      console.error(`Path: ${filePath}`);
      process.exit(2);
      break;

    default:
      console.log(JSON.stringify({ continue: true }));
  }
}

// ========================================
// Glob/Grep Validation
// ========================================

function handleGlob(input: HookInput): void {
  const searchPath = typeof input.tool_input === 'string'
    ? input.tool_input
    : (input.tool_input?.path as string) || '';

  if (!searchPath) {
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  // Check if the search path targets a zero-access directory
  const result = validatePath(searchPath, 'read');
  if (result.action === 'block') {
    logSecurityEvent({
      timestamp: new Date().toISOString(),
      session_id: input.session_id,
      event_type: 'block',
      tool: 'Glob',
      category: 'path_access',
      target: searchPath,
      reason: result.reason,
      action_taken: 'Hard block - exit 2'
    });
    console.error(`[KAI SECURITY] BLOCKED: Glob search in protected path: ${result.reason}`);
    process.exit(2);
  }

  console.log(JSON.stringify({ continue: true }));
}

function handleGrep(input: HookInput): void {
  const searchPath = typeof input.tool_input === 'string'
    ? input.tool_input
    : (input.tool_input?.path as string) || '';

  if (!searchPath) {
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  // Check if the search path targets a zero-access directory
  const result = validatePath(searchPath, 'read');
  if (result.action === 'block') {
    logSecurityEvent({
      timestamp: new Date().toISOString(),
      session_id: input.session_id,
      event_type: 'block',
      tool: 'Grep',
      category: 'path_access',
      target: searchPath,
      reason: result.reason,
      action_taken: 'Hard block - exit 2'
    });
    console.error(`[KAI SECURITY] BLOCKED: Grep search in protected path: ${result.reason}`);
    process.exit(2);
  }

  console.log(JSON.stringify({ continue: true }));
}

// ========================================
// Main
// ========================================

async function main(): Promise<void> {
  let input: HookInput;

  try {
    const raw = await Bun.stdin.text();

    if (!raw.trim()) {
      console.log(JSON.stringify({ continue: true }));
      return;
    }

    input = JSON.parse(raw);
  } catch {
    // Parse error - fail open
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  // Route to appropriate handler
  switch (input.tool_name) {
    case 'Bash':
      handleBash(input);
      break;
    case 'Edit':
    case 'MultiEdit':
      handleFileWrite(input, input.tool_name);
      break;
    case 'Write':
      handleFileWrite(input, 'Write');
      break;
    case 'Read':
      handleRead(input);
      break;
    case 'Glob':
      handleGlob(input);
      break;
    case 'Grep':
      handleGrep(input);
      break;
    default:
      // Allow all other tools
      console.log(JSON.stringify({ continue: true }));
  }
}

// Only run main if executed directly (not imported)
if (import.meta.main) {
  // Run main, fail open on any error
  main().catch(() => {
    console.log(JSON.stringify({ continue: true }));
  });
}
