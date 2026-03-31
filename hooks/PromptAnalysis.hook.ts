#!/usr/bin/env bun
/**
 * PromptAnalysis.hook.ts - Batched Inference for Tab Title + Session Name (UserPromptSubmit)
 *
 * PURPOSE:
 * Makes a SINGLE Haiku inference call that returns both the tab title and session name.
 * Writes results to a cache file that UpdateTabTitle and SessionAutoName read from,
 * eliminating their separate inference calls (~50% reduction in per-prompt API costs).
 *
 * TRIGGER: UserPromptSubmit (must run BEFORE UpdateTabTitle and SessionAutoName)
 *
 * CACHE:
 * - Location: MEMORY/STATE/prompt-analysis-cache/{session_id}.json
 * - Valid for: 30 seconds (same prompt window)
 * - Format: { tabTitle, sessionName, prompt, timestamp }
 *
 * OUTPUT:
 * - Writes cache file
 * - exit(0): Always (non-blocking)
 *
 * INTER-HOOK RELATIONSHIPS:
 * - PRODUCES: Cache file read by UpdateTabTitle and SessionAutoName
 * - REPLACES: Individual inference calls in those two hooks
 */

import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { paiPath } from './lib/paths';
import { inference } from '../skills/PAI/Tools/Inference';

interface HookInput {
  session_id: string;
  prompt?: string;
  user_prompt?: string;
}

export interface PromptAnalysisCache {
  tabTitle: string | null;
  sessionName: string | null;
  prompt: string;
  timestamp: number;
}

const CACHE_DIR = paiPath('MEMORY', 'STATE', 'prompt-analysis-cache');
const CACHE_TTL_MS = 30000; // 30 seconds

const ANALYSIS_SYSTEM_PROMPT = `Given a user's message to an AI assistant, provide TWO labels:

1. TAB_TITLE: A 2-4 word COMPLETE SENTENCE starting with a gerund (-ing verb).
   Rules: Start with gerund, include specific object, end with period, max 4 words.
   Good: "Fixing auth bug." "Reviewing hook code." "Building MCP server."
   Bad: "Working on it." "Completing the task." "Updating things."

2. SESSION_NAME: A 2-3 word noun phrase (Topic Case, no verbs/articles).
   Rules: Exactly 2-3 real words, describe the TOPIC not the action.
   Good: "Auth Bug Fix" "Hook Code Review" "MCP Server Build"
   Bad: "Fix Bug" "Reviewing Code" "Working On"

Output ONLY valid JSON, nothing else:
{"tabTitle": "...", "sessionName": "..."}

If the message is too short or unclear for a meaningful label, use null for that field.`;

export function getCachePath(sessionId: string): string {
  return paiPath('MEMORY', 'STATE', 'prompt-analysis-cache', `${sessionId}.json`);
}

export function readCache(sessionId: string): PromptAnalysisCache | null {
  try {
    const path = getCachePath(sessionId);
    if (!existsSync(path)) return null;
    const cache: PromptAnalysisCache = JSON.parse(readFileSync(path, 'utf-8'));
    if (Date.now() - cache.timestamp > CACHE_TTL_MS) return null;
    return cache;
  } catch {
    return null;
  }
}

async function readStdinWithTimeout(timeout = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    const timer = setTimeout(() => reject(new Error('Timeout')), timeout);
    process.stdin.on('data', (chunk) => { data += chunk.toString(); });
    process.stdin.on('end', () => { clearTimeout(timer); resolve(data); });
    process.stdin.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

async function main() {
  try {
    const raw = await readStdinWithTimeout();
    const data: HookInput = JSON.parse(raw);
    const prompt = data.prompt || data.user_prompt || '';
    const sessionId = data.session_id;

    if (!prompt || prompt.length < 3 || !sessionId) {
      process.exit(0);
    }

    // Skip ratings — preserve current tab title
    if (/^([1-9]|10)$/.test(prompt.trim())) {
      process.exit(0);
    }

    // Ensure cache dir exists
    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true });
    }

    const cleanPrompt = prompt.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 800);

    const result = await inference({
      systemPrompt: ANALYSIS_SYSTEM_PROMPT,
      userPrompt: cleanPrompt,
      expectJson: true,
      timeout: 15000,
      level: 'fast',
    });

    const cache: PromptAnalysisCache = {
      tabTitle: null,
      sessionName: null,
      prompt: cleanPrompt,
      timestamp: Date.now(),
    };

    if (result.success && result.parsed) {
      const parsed = result.parsed as { tabTitle?: string; sessionName?: string };
      cache.tabTitle = parsed.tabTitle || null;
      cache.sessionName = parsed.sessionName || null;
      console.error(`[PromptAnalysis] tabTitle="${cache.tabTitle}" sessionName="${cache.sessionName}"`);
    } else {
      console.error(`[PromptAnalysis] Inference failed: ${result.error}`);
    }

    writeFileSync(getCachePath(sessionId), JSON.stringify(cache), 'utf-8');
    process.exit(0);
  } catch (err) {
    console.error(`[PromptAnalysis] Error: ${err}`);
    process.exit(0);
  }
}

// Only run as standalone hook — not when imported by UpdateTabTitle/SessionAutoName
if (import.meta.main) {
  main();
}
