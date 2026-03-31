#!/usr/bin/env bun
/**
 * ResearchIndex.ts — Searchable catalog of prior research across sessions
 *
 * Two modes:
 *   query:  bun ResearchIndex.ts query "TR-369 compliance"
 *   save:   bun ResearchIndex.ts save --topic "TR-369 compliance" --summary "..." [--agents "Claude,Perplexity"] [--keywords "TR-369,USP,CWMP"] [--quality 8] [--sources "url1,url2"]
 *   list:   bun ResearchIndex.ts list [--limit 20]
 *   stats:  bun ResearchIndex.ts stats
 *
 * Index lives at MEMORY/RESEARCH/index.json
 * Max 500 entries (oldest pruned on save)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const PAI_DIR = process.env.PAI_DIR || join(process.env.HOME!, ".claude");
const RESEARCH_DIR = join(PAI_DIR, "MEMORY", "RESEARCH");
const INDEX_PATH = join(RESEARCH_DIR, "index.json");
const MAX_ENTRIES = 500;
const DEDUP_WINDOW_DAYS = 30;

// ── Types ─────────────────────────────────────────────────────────────────

interface ResearchEntry {
  id: string;
  topic: string;
  keywords: string[];
  summary: string;
  agents: string[];
  sources: string[];
  quality: number; // 1-10
  date: string; // ISO
  sessionId?: string;
}

interface ResearchIndex {
  version: 1;
  entries: ResearchEntry[];
  lastUpdated: string;
}

// ── Index I/O ─────────────────────────────────────────────────────────────

function loadIndex(): ResearchIndex {
  if (!existsSync(INDEX_PATH)) {
    return { version: 1, entries: [], lastUpdated: new Date().toISOString() };
  }
  try {
    return JSON.parse(readFileSync(INDEX_PATH, "utf-8"));
  } catch {
    return { version: 1, entries: [], lastUpdated: new Date().toISOString() };
  }
}

function saveIndex(index: ResearchIndex): void {
  if (!existsSync(RESEARCH_DIR)) {
    mkdirSync(RESEARCH_DIR, { recursive: true });
  }
  index.lastUpdated = new Date().toISOString();
  // Prune oldest if over max
  if (index.entries.length > MAX_ENTRIES) {
    index.entries = index.entries
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, MAX_ENTRIES);
  }
  writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), "utf-8");
}

// ── Search ────────────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, "").split(/\s+/).filter(Boolean);
}

function scoreMatch(entry: ResearchEntry, queryTokens: string[]): number {
  const entryText = [
    entry.topic,
    ...entry.keywords,
    entry.summary,
  ].join(" ").toLowerCase();

  let score = 0;
  for (const token of queryTokens) {
    // Exact keyword match = 3 points
    if (entry.keywords.some(k => k.toLowerCase() === token)) {
      score += 3;
    }
    // Topic contains token = 2 points
    else if (entry.topic.toLowerCase().includes(token)) {
      score += 2;
    }
    // Summary contains token = 1 point
    else if (entryText.includes(token)) {
      score += 1;
    }
  }

  // Recency boost: entries from last 7 days get +2
  const daysSince = (Date.now() - new Date(entry.date).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince < 7) score += 2;
  else if (daysSince < 30) score += 1;

  // Quality boost
  score += entry.quality / 10;

  return score;
}

function query(queryText: string, limit = 5): { entries: ResearchEntry[]; scores: number[] } {
  const index = loadIndex();
  const queryTokens = tokenize(queryText);

  if (queryTokens.length === 0) {
    return { entries: [], scores: [] };
  }

  const scored = index.entries
    .map(entry => ({ entry, score: scoreMatch(entry, queryTokens) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return {
    entries: scored.map(s => s.entry),
    scores: scored.map(s => s.score),
  };
}

// ── Dedup Check ───────────────────────────────────────────────────────────

function checkDedup(topic: string): ResearchEntry | null {
  const index = loadIndex();
  const queryTokens = tokenize(topic);
  const cutoff = Date.now() - DEDUP_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  for (const entry of index.entries) {
    if (new Date(entry.date).getTime() < cutoff) continue;

    const score = scoreMatch(entry, queryTokens);
    // High-confidence match: most query tokens found in topic+keywords
    const matchRatio = score / (queryTokens.length * 3); // max possible per token = 3
    if (matchRatio > 0.5) {
      return entry;
    }
  }
  return null;
}

// ── Save ──────────────────────────────────────────────────────────────────

function save(opts: {
  topic: string;
  summary: string;
  agents?: string[];
  keywords?: string[];
  quality?: number;
  sources?: string[];
  sessionId?: string;
}): ResearchEntry {
  const index = loadIndex();

  const entry: ResearchEntry = {
    id: `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    topic: opts.topic,
    keywords: opts.keywords || extractKeywords(opts.topic, opts.summary),
    summary: opts.summary.slice(0, 1500), // cap summary length
    agents: opts.agents || [],
    sources: opts.sources || [],
    quality: opts.quality || 5,
    date: new Date().toISOString(),
    sessionId: opts.sessionId,
  };

  index.entries.unshift(entry); // newest first
  saveIndex(index);

  return entry;
}

// ── Auto-extract keywords from topic + summary ──────────────────────────

function extractKeywords(topic: string, summary: string): string[] {
  const stopwords = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
    "being", "have", "has", "had", "do", "does", "did", "will", "would",
    "could", "should", "may", "might", "can", "this", "that", "these",
    "those", "it", "its", "not", "no", "how", "what", "when", "where",
    "which", "who", "whom", "why", "about", "into", "through", "during",
    "before", "after", "above", "below", "between", "same", "any", "each",
    "every", "all", "both", "few", "more", "most", "other", "some", "such",
    "than", "too", "very", "just", "also", "now", "here", "there",
  ]);

  const words = tokenize(`${topic} ${summary}`)
    .filter(w => w.length > 2 && !stopwords.has(w));

  // Count frequency
  const freq = new Map<string, number>();
  for (const w of words) {
    freq.set(w, (freq.get(w) || 0) + 1);
  }

  // Return top 10 by frequency
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);
}

// ── CLI ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0];

function getFlag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

if (command === "query") {
  const queryText = args[1];
  if (!queryText) {
    console.error("Usage: bun ResearchIndex.ts query <topic>");
    process.exit(1);
  }

  const result = query(queryText);
  if (result.entries.length === 0) {
    console.log(JSON.stringify({ found: false, message: "No prior research found", entries: [] }));
  } else {
    console.log(JSON.stringify({
      found: true,
      count: result.entries.length,
      entries: result.entries.map((e, i) => ({
        id: e.id,
        topic: e.topic,
        date: e.date,
        agents: e.agents,
        quality: e.quality,
        score: result.scores[i],
        summary: e.summary,
        keywords: e.keywords,
        sources: e.sources,
      })),
    }, null, 2));
  }

} else if (command === "dedup") {
  const topic = args[1];
  if (!topic) {
    console.error("Usage: bun ResearchIndex.ts dedup <topic>");
    process.exit(1);
  }

  const match = checkDedup(topic);
  if (match) {
    console.log(JSON.stringify({
      duplicate: true,
      entry: {
        id: match.id,
        topic: match.topic,
        date: match.date,
        quality: match.quality,
        summary: match.summary,
        keywords: match.keywords,
      },
    }, null, 2));
  } else {
    console.log(JSON.stringify({ duplicate: false }));
  }

} else if (command === "save") {
  const topic = getFlag("topic");
  const summary = getFlag("summary");
  if (!topic || !summary) {
    console.error("Usage: bun ResearchIndex.ts save --topic <topic> --summary <summary> [--agents a,b] [--keywords k1,k2] [--quality N] [--sources url1,url2]");
    process.exit(1);
  }

  const entry = save({
    topic,
    summary,
    agents: getFlag("agents")?.split(",") || [],
    keywords: getFlag("keywords")?.split(",") || [],
    quality: parseInt(getFlag("quality") || "5", 10),
    sources: getFlag("sources")?.split(",") || [],
    sessionId: getFlag("session"),
  });

  console.log(JSON.stringify({ saved: true, id: entry.id, topic: entry.topic, keywords: entry.keywords }));

} else if (command === "list") {
  const limit = parseInt(getFlag("limit") || "20", 10);
  const index = loadIndex();
  const entries = index.entries.slice(0, limit);

  console.log(`Research Index: ${index.entries.length} entries (showing ${entries.length})\n`);
  for (const e of entries) {
    const age = Math.floor((Date.now() - new Date(e.date).getTime()) / (1000 * 60 * 60 * 24));
    console.log(`  [${e.id}] ${e.topic} (${age}d ago, q:${e.quality}/10, agents: ${e.agents.join(",")})`);
  }

} else if (command === "stats") {
  const index = loadIndex();
  const entries = index.entries;

  const agentCounts = new Map<string, number>();
  let totalQuality = 0;
  for (const e of entries) {
    totalQuality += e.quality;
    for (const a of e.agents) {
      agentCounts.set(a, (agentCounts.get(a) || 0) + 1);
    }
  }

  console.log(`Research Index Stats`);
  console.log(`  Total entries: ${entries.length}`);
  console.log(`  Avg quality: ${entries.length ? (totalQuality / entries.length).toFixed(1) : "N/A"}`);
  console.log(`  Last updated: ${index.lastUpdated}`);
  console.log(`  Agent usage:`);
  for (const [agent, count] of [...agentCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${agent}: ${count}`);
  }

} else {
  console.log(`PAI Research Index — searchable catalog of prior research

Usage:
  bun ResearchIndex.ts query <topic>       Search for prior research
  bun ResearchIndex.ts dedup <topic>       Check if topic was recently researched
  bun ResearchIndex.ts save --topic <t> --summary <s> [options]
  bun ResearchIndex.ts list [--limit N]    List recent entries
  bun ResearchIndex.ts stats               Show index statistics`);
}
