#!/usr/bin/env bun
/**
 * LearningPatternSynthesis - Aggregate ratings into actionable patterns
 *
 * Analyzes LEARNING/SIGNALS/ratings.jsonl to find recurring patterns
 * and generates synthesis reports for continuous improvement.
 *
 * Commands:
 *   --week         Analyze last 7 days (default)
 *   --month        Analyze last 30 days
 *   --all          Analyze all ratings
 *   --dry-run      Show analysis without writing
 *
 * Examples:
 *   bun run LearningPatternSynthesis.ts --week
 *   bun run LearningPatternSynthesis.ts --month --dry-run
 */

import { parseArgs } from "util";
import * as fs from "fs";
import * as path from "path";
import { paiPath } from "../../hooks/lib/paths";

// ============================================================================
// Configuration
// ============================================================================

const LEARNING_DIR = paiPath("MEMORY", "LEARNING");
const RATINGS_FILE = paiPath("MEMORY", "LEARNING", "SIGNALS", "ratings.jsonl");
const SYNTHESIS_DIR = paiPath("MEMORY", "LEARNING", "SYNTHESIS");

// ============================================================================
// Types
// ============================================================================

interface Rating {
  timestamp: string;
  rating: number;
  session_id: string;
  source: "explicit" | "implicit";
  sentiment_summary: string;
  confidence: number;
  comment?: string;
}

interface PatternGroup {
  pattern: string;
  count: number;
  avgRating: number;
  avgConfidence: number;
  examples: string[];
}

export interface SynthesisResult {
  period: string;
  totalRatings: number;
  avgRating: number;
  frustrations: PatternGroup[];
  successes: PatternGroup[];
  topIssues: string[];
  recommendations: string[];
}

// ============================================================================
// Pattern Detection
// ============================================================================

const FRUSTRATION_PATTERNS: Record<string, RegExp> = {
  "Time/Performance Issues": /time|slow|delay|hang|wait|long|minutes|hours/i,
  "Incomplete Work": /incomplete|missing|partial|didn't finish|not done/i,
  "Wrong Approach": /wrong|incorrect|not what|misunderstand|mistake/i,
  "Over-engineering": /over-?engineer|too complex|unnecessary|bloat/i,
  "Tool/System Failures": /fail|error|broken|crash|bug|issue/i,
  "Communication Problems": /unclear|confus|didn't ask|should have asked/i,
  "Repetitive Issues": /again|repeat|still|same problem/i,
};

const SUCCESS_PATTERNS: Record<string, RegExp> = {
  "Quick Resolution": /quick|fast|efficient|smooth/i,
  "Good Understanding": /understood|clear|exactly|perfect/i,
  "Proactive Help": /proactive|anticipat|helpful|above and beyond/i,
  "Clean Implementation": /clean|simple|elegant|well done/i,
};

function detectPatterns(summaries: string[], patterns: Record<string, RegExp>): Map<string, string[]> {
  const results = new Map<string, string[]>();

  for (const summary of summaries) {
    for (const [name, pattern] of Object.entries(patterns)) {
      if (pattern.test(summary)) {
        if (!results.has(name)) {
          results.set(name, []);
        }
        results.get(name)!.push(summary);
      }
    }
  }

  return results;
}

function groupToPatternGroups(
  grouped: Map<string, string[]>,
  ratings: Rating[]
): PatternGroup[] {
  const groups: PatternGroup[] = [];

  for (const [pattern, examples] of grouped.entries()) {
    // Find ratings that match these examples
    const matchingRatings = ratings.filter(r =>
      examples.some(e => e === r.sentiment_summary)
    );

    const avgRating = matchingRatings.length > 0
      ? matchingRatings.reduce((sum, r) => sum + r.rating, 0) / matchingRatings.length
      : 5;

    const avgConfidence = matchingRatings.length > 0
      ? matchingRatings.reduce((sum, r) => sum + r.confidence, 0) / matchingRatings.length
      : 0.5;

    groups.push({
      pattern,
      count: examples.length,
      avgRating,
      avgConfidence,
      examples: examples.slice(0, 3), // Top 3 examples
    });
  }

  return groups.sort((a, b) => b.count - a.count);
}

// ============================================================================
// Analysis
// ============================================================================

export function analyzeRatings(ratings: Rating[], period: string): SynthesisResult {
  if (ratings.length === 0) {
    return {
      period,
      totalRatings: 0,
      avgRating: 0,
      frustrations: [],
      successes: [],
      topIssues: [],
      recommendations: [],
    };
  }

  const avgRating = ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length;

  // Separate frustrations (rating <= 4) and successes (rating >= 7)
  const frustrationRatings = ratings.filter(r => r.rating <= 4);
  const successRatings = ratings.filter(r => r.rating >= 7);

  const frustrationSummaries = frustrationRatings.map(r => r.sentiment_summary);
  const successSummaries = successRatings.map(r => r.sentiment_summary);

  // Detect patterns
  const frustrationGroups = detectPatterns(frustrationSummaries, FRUSTRATION_PATTERNS);
  const successGroups = detectPatterns(successSummaries, SUCCESS_PATTERNS);

  const frustrations = groupToPatternGroups(frustrationGroups, frustrationRatings);
  const successes = groupToPatternGroups(successGroups, successRatings);

  // Generate top issues (most common frustrations)
  const topIssues = frustrations
    .slice(0, 3)
    .map(f => `${f.pattern} (${f.count} occurrences, avg rating ${f.avgRating.toFixed(1)})`);

  // Generate recommendations based on patterns
  const recommendations: string[] = [];

  if (frustrations.some(f => f.pattern === "Time/Performance Issues")) {
    recommendations.push("Consider setting clearer time expectations and progress updates");
  }
  if (frustrations.some(f => f.pattern === "Wrong Approach")) {
    recommendations.push("Ask clarifying questions before starting complex tasks");
  }
  if (frustrations.some(f => f.pattern === "Over-engineering")) {
    recommendations.push("Default to simpler solutions; only add complexity when justified");
  }
  if (frustrations.some(f => f.pattern === "Communication Problems")) {
    recommendations.push("Summarize understanding before implementation");
  }

  if (recommendations.length === 0) {
    recommendations.push("Continue current patterns - no major issues detected");
  }

  return {
    period,
    totalRatings: ratings.length,
    avgRating,
    frustrations,
    successes,
    topIssues,
    recommendations,
  };
}

// ============================================================================
// File Generation
// ============================================================================

function formatSynthesisReport(result: SynthesisResult): string {
  const date = new Date().toISOString().split('T')[0];

  let content = `# Learning Pattern Synthesis

**Period:** ${result.period}
**Generated:** ${date}
**Total Ratings:** ${result.totalRatings}
**Average Rating:** ${result.avgRating.toFixed(1)}/10

---

## Top Issues

${result.topIssues.length > 0
    ? result.topIssues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')
    : 'No significant issues detected'}

## Frustration Patterns

`;

  if (result.frustrations.length === 0) {
    content += '*No frustration patterns detected*\n\n';
  } else {
    for (const f of result.frustrations) {
      content += `### ${f.pattern}

- **Occurrences:** ${f.count}
- **Avg Rating:** ${f.avgRating.toFixed(1)}
- **Confidence:** ${(f.avgConfidence * 100).toFixed(0)}%
- **Examples:**
${f.examples.map(e => `  - "${e}"`).join('\n')}

`;
    }
  }

  content += `## Success Patterns

`;

  if (result.successes.length === 0) {
    content += '*No success patterns detected*\n\n';
  } else {
    for (const s of result.successes) {
      content += `### ${s.pattern}

- **Occurrences:** ${s.count}
- **Avg Rating:** ${s.avgRating.toFixed(1)}
- **Examples:**
${s.examples.map(e => `  - "${e}"`).join('\n')}

`;
    }
  }

  content += `## Recommendations

${result.recommendations.map((r, i) => `${i + 1}. ${r}`).join('\n')}

---

*Generated by LearningPatternSynthesis tool*
`;

  return content;
}

function writeSynthesis(result: SynthesisResult, period: string): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');

  const monthDir = path.join(SYNTHESIS_DIR, `${year}-${month}`);
  if (!fs.existsSync(monthDir)) {
    fs.mkdirSync(monthDir, { recursive: true });
  }

  const dateStr = now.toISOString().split('T')[0];
  const filename = `${dateStr}_${period.toLowerCase().replace(/\s+/g, '-')}-patterns.md`;
  const filepath = path.join(monthDir, filename);

  const content = formatSynthesisReport(result);
  fs.writeFileSync(filepath, content);

  return filepath;
}

// ============================================================================
// Exports for pai curate integration
// ============================================================================

/** Load ratings from the JSONL file, optionally filtered to last N days. */
export function loadRatings(days?: number): Rating[] {
  if (!fs.existsSync(RATINGS_FILE)) return [];
  const cutoff = days ? Date.now() - days * 86_400_000 : 0;
  return fs.readFileSync(RATINGS_FILE, 'utf-8')
    .trim().split('\n').filter(l => l.trim())
    .flatMap(line => {
      try {
        const r = JSON.parse(line) as Rating;
        if (cutoff && new Date(r.timestamp).getTime() < cutoff) return [];
        return [r];
      } catch { return []; }
    });
}

/**
 * Convert a SynthesisResult into STAGING draft content (numbered lesson list).
 * Same format as ReflectionHarvester.writeLessonsToStaging() so both feed
 * the same STAGING → curate → WISDOM/FRAMES pipeline.
 */
export function synthesisToStagingContent(result: SynthesisResult): string {
  const lessons: string[] = [];

  // Top frustration patterns as "avoid" lessons
  for (const f of result.frustrations.slice(0, 3)) {
    if (f.count >= 2) {
      lessons.push(`Address ${f.pattern.toLowerCase()} proactively — occurs in ${f.count} sessions (avg ${f.avgRating.toFixed(1)}/10)`);
    }
  }
  // Top success patterns as "reinforce" lessons
  for (const s of result.successes.slice(0, 2)) {
    if (s.count >= 2) {
      lessons.push(`Maintain ${s.pattern.toLowerCase()} — associated with high satisfaction in ${s.count} sessions`);
    }
  }
  // Recommendations from the analysis
  for (const rec of result.recommendations.slice(0, 2)) {
    lessons.push(rec);
  }

  return lessons.map((l, i) => `${i + 1}. ${l}`).join('\n');
}

// ============================================================================
// Behavioral Trend Analysis (LLM-powered)
// ============================================================================

import { inference } from './Inference';

interface BehavioralTrend {
  theme: string;
  thisWeek: number;
  lastWeek: number;
  direction: 'up' | 'down' | 'stable';
  examples: string[];
}

interface TrendResult {
  trends: BehavioralTrend[];
  avgThisWeek: number;
  avgLastWeek: number;
  generated: string;
}

async function analyzeTrends(allRatings: Rating[]): Promise<TrendResult | null> {
  const now = Date.now();
  const oneWeek = 7 * 86_400_000;

  const thisWeek = allRatings.filter(r => {
    const t = new Date(r.timestamp).getTime();
    return t >= now - oneWeek;
  });
  const lastWeek = allRatings.filter(r => {
    const t = new Date(r.timestamp).getTime();
    return t >= now - 2 * oneWeek && t < now - oneWeek;
  });

  if (thisWeek.length < 3) {
    console.log('⚠️  Too few ratings this week for trend analysis');
    return null;
  }

  const thisWeekLow = thisWeek.filter(r => r.rating <= 4);
  const lastWeekLow = lastWeek.filter(r => r.rating <= 4);

  const allLowSummaries = [
    ...thisWeekLow.map(r => ({ summary: r.sentiment_summary, week: 'this' })),
    ...lastWeekLow.map(r => ({ summary: r.sentiment_summary, week: 'last' })),
  ];

  if (allLowSummaries.length < 3) {
    console.log('⚠️  Too few frustrations for trend clustering');
    return null;
  }

  const systemPrompt = `You cluster user frustration signals into 3-5 behavioral themes. Each theme represents a PATTERN of AI misbehavior (not a one-off event). Return valid JSON only.`;

  const userPrompt = `Cluster these frustration signals into 3-5 behavioral themes. Each signal is tagged [this_week] or [last_week].

Signals:
${allLowSummaries.map(s => `[${s.week === 'this' ? 'this_week' : 'last_week'}] "${s.summary}"`).join('\n')}

Return JSON:
{
  "themes": [
    {
      "theme": "short behavioral description (e.g. 'Does wrong thing without checking first')",
      "this_week_count": <number of this_week signals in this cluster>,
      "last_week_count": <number of last_week signals in this cluster>,
      "examples": ["most representative signal", "second example"]
    }
  ]
}

Rules:
- Theme names should describe the AI's BAD BEHAVIOR from the user's perspective
- Use plain language, not categories (not "Tool Failures" but "Keeps using broken tools instead of alternatives")
- Every signal must belong to exactly one theme
- Sort themes by this_week_count descending`;

  const result = await inference({
    systemPrompt,
    userPrompt,
    level: 'fast',
    timeout: 60000,
  });

  if (!result.success) {
    console.error(`[Trends] Inference failed: ${result.error}`);
    return null;
  }

  try {
    const jsonMatch = result.output.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);

    const trends: BehavioralTrend[] = (parsed.themes || []).map((t: any) => ({
      theme: t.theme,
      thisWeek: t.this_week_count || 0,
      lastWeek: t.last_week_count || 0,
      direction: t.this_week_count > t.last_week_count ? 'up' :
                 t.this_week_count < t.last_week_count ? 'down' : 'stable',
      examples: (t.examples || []).slice(0, 2),
    }));

    const avgThis = thisWeek.length > 0
      ? thisWeek.reduce((s, r) => s + r.rating, 0) / thisWeek.length : 0;
    const avgLast = lastWeek.length > 0
      ? lastWeek.reduce((s, r) => s + r.rating, 0) / lastWeek.length : 0;

    return {
      trends,
      avgThisWeek: avgThis,
      avgLastWeek: avgLast,
      generated: new Date().toISOString().split('T')[0],
    };
  } catch (err) {
    console.error(`[Trends] JSON parse failed: ${err}`);
    return null;
  }
}

function formatTrendReport(result: TrendResult): string {
  const arrow = (d: string) => d === 'up' ? '↑' : d === 'down' ? '↓' : '=';
  const avgDir = result.avgThisWeek > result.avgLastWeek ? '↑' : result.avgThisWeek < result.avgLastWeek ? '↓' : '=';

  let content = `# Behavioral Trend Analysis

**Generated:** ${result.generated}
**Average Rating:** ${result.avgThisWeek.toFixed(1)}/10 this week ${avgDir} (was ${result.avgLastWeek.toFixed(1)} last week)

---

## Behavioral Trends (this week vs last)

`;

  for (const t of result.trends) {
    content += `${arrow(t.direction)} **${t.theme}** — ${t.thisWeek} this week vs ${t.lastWeek} last\n`;
    for (const ex of t.examples) {
      content += `    • "${ex}"\n`;
    }
    content += '\n';
  }

  content += `---\n*Generated by LearningPatternSynthesis --trends*\n`;
  return content;
}

function writeTrendReport(result: TrendResult): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const monthDir = path.join(SYNTHESIS_DIR, `${year}-${month}`);
  if (!fs.existsSync(monthDir)) fs.mkdirSync(monthDir, { recursive: true });

  const dateStr = now.toISOString().split('T')[0];
  const filepath = path.join(monthDir, `${dateStr}_behavioral-trends.md`);
  fs.writeFileSync(filepath, formatTrendReport(result));
  return filepath;
}

// ============================================================================
// CLI
// ============================================================================

if (import.meta.main) {

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    week: { type: "boolean" },
    month: { type: "boolean" },
    all: { type: "boolean" },
    trends: { type: "boolean" },
    "dry-run": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.log(`
LearningPatternSynthesis - Aggregate ratings into actionable patterns

Usage:
  bun run LearningPatternSynthesis.ts --week      Analyze last 7 days (default)
  bun run LearningPatternSynthesis.ts --month     Analyze last 30 days
  bun run LearningPatternSynthesis.ts --all       Analyze all ratings
  bun run LearningPatternSynthesis.ts --trends    LLM-powered behavioral trend analysis (this week vs last)
  bun run LearningPatternSynthesis.ts --dry-run   Preview without writing

Output: Creates synthesis report in MEMORY/LEARNING/SYNTHESIS/YYYY-MM/
`);
  process.exit(0);
}

// --trends mode: LLM-powered behavioral clustering
if (values.trends) {
  if (!fs.existsSync(RATINGS_FILE)) {
    console.log('No ratings file found');
    process.exit(0);
  }
  const content = fs.readFileSync(RATINGS_FILE, 'utf-8');
  const allRatings: Rating[] = content.split('\n').filter(l => l.trim())
    .flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });

  console.log(`📊 Loaded ${allRatings.length} total ratings`);
  console.log('🧠 Running behavioral trend analysis...');

  const trendResult = await analyzeTrends(allRatings);
  if (!trendResult) {
    console.log('❌ Could not generate trends');
    process.exit(0);
  }

  console.log(`\n📈 Behavioral Trends (${trendResult.avgThisWeek.toFixed(1)}/10 this week vs ${trendResult.avgLastWeek.toFixed(1)} last):\n`);
  for (const t of trendResult.trends) {
    const arrow = t.direction === 'up' ? '↑' : t.direction === 'down' ? '↓' : '=';
    console.log(`  ${arrow} ${t.theme}: ${t.thisWeek} vs ${t.lastWeek}`);
  }

  if (!values['dry-run']) {
    const filepath = writeTrendReport(trendResult);
    console.log(`\n✅ Trend report: ${path.basename(filepath)}`);
  }
  process.exit(0);
}

// Check ratings file exists
if (!fs.existsSync(RATINGS_FILE)) {
  console.log("No ratings file found at:", RATINGS_FILE);
  process.exit(0);
}

// Read all ratings
const content = fs.readFileSync(RATINGS_FILE, 'utf-8');
const allRatings: Rating[] = content
  .split('\n')
  .filter(line => line.trim())
  .map(line => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  })
  .filter((r): r is Rating => r !== null);

console.log(`📊 Loaded ${allRatings.length} total ratings`);

// Determine period and filter
let period = 'Weekly';
let cutoffDate = new Date();

if (values.month) {
  period = 'Monthly';
  cutoffDate.setDate(cutoffDate.getDate() - 30);
} else if (values.all) {
  period = 'All Time';
  cutoffDate = new Date(0); // Beginning of time
} else {
  // Default: week
  cutoffDate.setDate(cutoffDate.getDate() - 7);
}

const filteredRatings = allRatings.filter(r => {
  const ratingDate = new Date(r.timestamp);
  return ratingDate >= cutoffDate;
});

console.log(`🔍 Analyzing ${filteredRatings.length} ratings for ${period.toLowerCase()} period`);

if (filteredRatings.length === 0) {
  console.log("✅ No ratings in this period");
  process.exit(0);
}

// Analyze
const result = analyzeRatings(filteredRatings, period);

console.log(`\n📈 Analysis Results:`);
console.log(`   Average Rating: ${result.avgRating.toFixed(1)}/10`);
console.log(`   Frustration Patterns: ${result.frustrations.length}`);
console.log(`   Success Patterns: ${result.successes.length}`);

if (result.topIssues.length > 0) {
  console.log(`\n⚠️  Top Issues:`);
  for (const issue of result.topIssues) {
    console.log(`   - ${issue}`);
  }
}

if (values["dry-run"]) {
  console.log("\n🔍 DRY RUN - Would write synthesis report");
  console.log("\nRecommendations:");
  for (const rec of result.recommendations) {
    console.log(`   - ${rec}`);
  }
} else {
  const filepath = writeSynthesis(result, period);
  console.log(`\n✅ Created synthesis report: ${path.basename(filepath)}`);
}

} // end import.meta.main
