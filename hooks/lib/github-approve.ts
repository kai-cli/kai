#!/usr/bin/env bun
/**
 * github-approve.ts - Pre-approve GitHub write commands
 *
 * Supports two modes:
 *
 * SINGLE MODE (one command):
 *   bun github-approve.ts "git push origin main" "Yes, push it"
 *
 * BATCH MODE (multiple commands, one approval):
 *   bun github-approve.ts --batch "user response" "git push origin main" "git push -u origin v4.5.0-dev"
 *
 * BATCH mode is for umbrella approvals where the user has explicitly
 * confirmed ALL listed operations via AskUserQuestion. Each command
 * gets its own 120-second token. Commands NOT in the batch are NOT
 * approved — GitHubWriteGuard will block them as usual.
 *
 * REQUIRES the user's actual response from AskUserQuestion.
 * Rejects calls with missing or empty responses.
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';

const BASE_DIR = process.env.PAI_DIR || join(homedir(), '.claude');
const APPROVALS_DIR = join(BASE_DIR, 'MEMORY', 'STATE', 'github-approvals');

// Token TTL: 120 seconds for batch (multiple commands take time to execute),
// 60 seconds for single
const SINGLE_TTL = 60_000;
const BATCH_TTL = 120_000;

function ensureDir() {
  if (!existsSync(APPROVALS_DIR)) {
    mkdirSync(APPROVALS_DIR, { recursive: true });
  }
}

function validateResponse(response: string | undefined): string {
  if (!response) {
    console.error('❌ Missing user response. AskUserQuestion must be used first.');
    console.error('');
    console.error('   The user\'s actual response from AskUserQuestion is REQUIRED.');
    console.error('   This prevents bypassing the confirmation step.');
    process.exit(1);
  }
  const trimmed = response.trim();
  if (trimmed.length < 2) {
    console.error('❌ User response is too short or empty. AskUserQuestion must be used first.');
    process.exit(1);
  }
  return trimmed;
}

function createToken(command: string, userResponse: string, ttl: number): string {
  const hash = createHash('sha256').update(command.trim()).digest('hex').slice(0, 12);
  const tokenPath = join(APPROVALS_DIR, `${hash}.json`);

  writeFileSync(tokenPath, JSON.stringify({
    command: command.trim(),
    hash,
    approved_at: Date.now(),
    expires_at: Date.now() + ttl,
    user_response: userResponse,
  }), 'utf-8');

  return hash;
}

// --- Main ---

const args = process.argv.slice(2);
const isBatch = args[0] === '--batch';

if (isBatch) {
  // BATCH MODE: --batch "user response" "cmd1" "cmd2" ...
  const userResponse = validateResponse(args[1]);
  const commands = args.slice(2);

  if (commands.length === 0) {
    console.error('❌ Batch mode requires at least one command.');
    console.error('   Usage: bun github-approve.ts --batch "user response" "cmd1" "cmd2" ...');
    process.exit(1);
  }

  ensureDir();

  console.log(`✅ Batch approved (${BATCH_TTL / 1000}s window) — ${commands.length} command(s):`);
  console.log(`   Confirmed by: "${userResponse}"`);
  console.log('');

  for (const cmd of commands) {
    const hash = createToken(cmd, userResponse, BATCH_TTL);
    console.log(`   [${hash}] ${cmd}`);
  }
} else {
  // SINGLE MODE: "command" "user response"
  const command = args[0];
  const userResponse = validateResponse(args[1]);

  if (!command) {
    console.error('❌ Usage: bun github-approve.ts "command" "user response"');
    console.error('   Or:    bun github-approve.ts --batch "user response" "cmd1" "cmd2" ...');
    process.exit(1);
  }

  ensureDir();

  const hash = createToken(command, userResponse, SINGLE_TTL);
  console.log(`✅ GitHub command approved (${SINGLE_TTL / 1000}s window): "${command.trim()}"`);
  console.log(`   Token: ${hash}`);
  console.log(`   Confirmed by: "${userResponse}"`);
}
