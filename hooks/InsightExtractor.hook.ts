#!/usr/bin/env bun
// InsightExtractor.hook.ts - Extract learnings from session transcripts (SessionEnd)
//
// Reads the session transcript, identifies new factual learnings (not failures,
// not sentiment — actual knowledge gained through investigation), and writes
// them as insight candidates to MEMORY/LEARNING/INSIGHTS/.
//
// KnowledgeSync picks these up on future runs and distills into domain files.
// MemoryCurate surfaces them for promotion to project/feedback memories.
//
// TRIGGER: SessionEnd (async)
//
// INPUT: stdin hook JSON (session_id, transcript_path)
// OUTPUT: stderr status messages, exit(0) always
//
// SIDE EFFECTS:
//   Creates: MEMORY/LEARNING/INSIGHTS/<YYYY-MM-DD>_<slug>.md
//   Reads: transcript file

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { readJSON, atomicWriteJSON } from './lib/atomic';
import { join, basename } from 'path';
import { paiPath } from './lib/paths';
import { inference } from '../PAI/Tools/Inference';

// ============================================================================
// Configuration
// ============================================================================

const INSIGHTS_DIR = paiPath('MEMORY', 'LEARNING', 'INSIGHTS');
const STATE_FILE = paiPath('MEMORY', 'STATE', '.insight-extractor-state.json');
const MAX_TRANSCRIPT_CHARS = 80_000; // ~20K tokens — enough context without blowing budget
const MIN_TRANSCRIPT_CHARS = 2_000;  // Skip trivial sessions
const COOLDOWN_HOURS = 4;            // Don't run more than once per 4 hours
const MAX_INSIGHTS_PER_DAY = 10;     // Cap to prevent runaway writes

// ============================================================================
// Types
// ============================================================================

export interface HookInput {
  session_id: string;
  transcript_path: string;
}

export interface ExtractorState {
  lastRun: string;
  lastSessionId: string;
  insightsToday: number;
  todayDate: string;
}

export interface Insight {
  title: string;
  content: string;
  category: 'domain' | 'workflow' | 'architecture' | 'debugging' | 'integration';
  confidence: 'high' | 'medium';
}

// ============================================================================
// State Management (exported for testing)
// ============================================================================

export function loadState(): ExtractorState {
  return readJSON<ExtractorState>(STATE_FILE, { lastRun: '', lastSessionId: '', insightsToday: 0, todayDate: '' });
}

export function saveState(state: ExtractorState): void {
  mkdirSync(paiPath('MEMORY', 'STATE'), { recursive: true });
  atomicWriteJSON(STATE_FILE, state);
}

// ============================================================================
// Transcript Extraction
// ============================================================================

export function extractConversation(transcriptPath: string): string {
  const raw = readFileSync(transcriptPath, 'utf-8');
  const lines = raw.trim().split('\n');
  const parts: string[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'human' || entry.type === 'user') {
        const content = entry.message?.content;
        if (typeof content === 'string') {
          parts.push(`USER: ${content.slice(0, 500)}`);
        } else if (Array.isArray(content)) {
          const text = content
            .filter((b: any) => b?.type === 'text')
            .map((b: any) => b.text)
            .join(' ')
            .slice(0, 500);
          if (text) parts.push(`USER: ${text}`);
        }
      } else if (entry.type === 'assistant') {
        const content = entry.message?.content;
        if (typeof content === 'string') {
          parts.push(`ASSISTANT: ${content.slice(0, 1000)}`);
        } else if (Array.isArray(content)) {
          const text = content
            .filter((b: any) => b?.type === 'text')
            .map((b: any) => b.text)
            .join(' ')
            .slice(0, 1000);
          if (text) parts.push(`ASSISTANT: ${text}`);
        }
      }
    } catch {}
  }

  const full = parts.join('\n\n');
  // Take last N chars if too long (recent context is more valuable)
  if (full.length > MAX_TRANSCRIPT_CHARS) {
    return full.slice(-MAX_TRANSCRIPT_CHARS);
  }
  return full;
}

// ============================================================================
// Insight Extraction via LLM
// ============================================================================

async function extractInsights(conversation: string): Promise<Insight[]> {
  const systemPrompt = `You extract factual learnings from a work session transcript.

EXTRACT only things that were DISCOVERED or CONFIRMED through investigation — new facts, configurations, behaviors, workarounds, or architectural insights that weren't known before this session.

DO NOT extract:
- Failures or bugs (those are captured elsewhere)
- Sentiment or emotional states
- Task completions ("we deployed X")
- Obvious facts anyone could look up
- Opinions or preferences (unless the user stated them as rules)
- Things already documented in code comments or READMEs

Each insight should be a standalone fact that would be useful in a FUTURE session without context of this one.

Respond with a JSON array of 0-5 insights (return [] if nothing novel was learned):
[{
  "title": "Short descriptive title (5-10 words)",
  "content": "The factual insight in 1-3 sentences. Be specific — include file paths, config values, command syntax, or behavior details.",
  "category": "domain|workflow|architecture|debugging|integration",
  "confidence": "high|medium"
}]

Return ONLY valid JSON, no markdown fencing.`;

  const result = await inference({
    level: 'fast',
    systemPrompt,
    userPrompt: conversation,
    expectJson: true,
    timeout: 60_000,
  });

  if (result.error) {
    console.error(`[InsightExtractor] Inference error: ${result.error}`);
    return [];
  }

  if (!result.parsed) {
    // Try manual JSON parse from raw output
    try {
      const cleaned = result.output.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const manual = JSON.parse(cleaned);
      if (Array.isArray(manual)) {
        return manual.filter((item: any) =>
          item.title && item.content && item.category && item.confidence
        );
      }
    } catch {}
    console.error(`[InsightExtractor] Could not parse output (${result.output.length} chars): ${result.output.slice(0, 200)}`);
    return [];
  }

  const parsed = result.parsed as any;
  if (!Array.isArray(parsed)) return [];

  return parsed.filter((item: any) =>
    item.title && item.content && item.category && item.confidence
  );
}

// ============================================================================
// File Writing
// ============================================================================

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

export function writeInsight(insight: Insight, sessionId: string): string {
  mkdirSync(INSIGHTS_DIR, { recursive: true });

  const date = new Date().toISOString().slice(0, 10);
  const slug = slugify(insight.title);
  const filename = `${date}_${slug}.md`;
  const filepath = join(INSIGHTS_DIR, filename);

  // Don't overwrite existing
  if (existsSync(filepath)) return '';

  const content = `---
title: "${insight.title}"
category: ${insight.category}
confidence: ${insight.confidence}
captured: ${new Date().toISOString()}
session_id: ${sessionId}
status: candidate
---

${insight.content}
`;

  writeFileSync(filepath, content);
  return filename;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  // Read hook input
  let hookInput: HookInput;
  try {
    const stdin = readFileSync('/dev/stdin', 'utf-8');
    hookInput = JSON.parse(stdin);
  } catch {
    console.error('[InsightExtractor] No input received, exiting');
    process.exit(0);
  }

  if (!hookInput.transcript_path || !existsSync(hookInput.transcript_path)) {
    console.error('[InsightExtractor] No transcript path, exiting');
    process.exit(0);
  }

  // Check cooldown
  const state = loadState();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  if (state.lastRun) {
    const elapsed = now.getTime() - new Date(state.lastRun).getTime();
    if (elapsed < COOLDOWN_HOURS * 60 * 60 * 1000) {
      console.error(`[InsightExtractor] In cooldown (${Math.round(elapsed / 60000)}m < ${COOLDOWN_HOURS * 60}m), skipping`);
      process.exit(0);
    }
  }

  // Reset daily counter
  if (state.todayDate !== today) {
    state.insightsToday = 0;
    state.todayDate = today;
  }

  if (state.insightsToday >= MAX_INSIGHTS_PER_DAY) {
    console.error(`[InsightExtractor] Daily cap reached (${MAX_INSIGHTS_PER_DAY}), skipping`);
    process.exit(0);
  }

  // Extract conversation
  const conversation = extractConversation(hookInput.transcript_path);
  if (conversation.length < MIN_TRANSCRIPT_CHARS) {
    console.error(`[InsightExtractor] Session too short (${conversation.length} chars), skipping`);
    process.exit(0);
  }

  console.error(`[InsightExtractor] Extracting insights from ${conversation.length} chars of conversation...`);

  // Run extraction
  const insights = await extractInsights(conversation);

  if (insights.length === 0) {
    console.error('[InsightExtractor] No novel insights found');
    saveState({ ...state, lastRun: now.toISOString(), lastSessionId: hookInput.session_id });
    process.exit(0);
  }

  // Write insights
  let written = 0;
  for (const insight of insights) {
    if (state.insightsToday >= MAX_INSIGHTS_PER_DAY) break;
    const filename = writeInsight(insight, hookInput.session_id);
    if (filename) {
      console.error(`[InsightExtractor] Wrote: ${filename}`);
      written++;
      state.insightsToday++;
    }
  }

  console.error(`[InsightExtractor] Done: ${written} insights captured`);
  saveState({ ...state, lastRun: now.toISOString(), lastSessionId: hookInput.session_id });
}

if (import.meta.main) {
  main().catch(err => {
    console.error('[InsightExtractor] Fatal:', err);
    process.exit(0); // Never block session end
  });
}
