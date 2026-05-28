/**
 * Memory scoring library for ranking memory entries
 * Based on recency, frequency, importance, and relevance
 */

export interface MemoryEntry {
  path: string;
  content: string;
  created: Date;
  lastAccessed?: Date;
  frequency: number; // content-hash count across all LEARNING/ files
  pinned: boolean;
  tags?: string[];
}

export interface ScoringConfig {
  recencyHalfLife: number; // days (default: 30)
  importancePinned: number; // multiplier (default: 2.0)
  importanceFlagged: number; // multiplier (default: 1.5)
  relevanceExact: number; // multiplier (default: 2.0)
  relevancePartial: number; // multiplier (default: 1.2)
}

const DEFAULT_CONFIG: ScoringConfig = {
  recencyHalfLife: 30,
  importancePinned: 2.0,
  importanceFlagged: 1.5,
  relevanceExact: 2.0,
  relevancePartial: 1.2,
};

/**
 * Calculate recency score using exponential decay
 * Returns value between 0.0 and 1.0
 */
function calculateRecencyScore(
  created: Date,
  halfLife: number,
  now: Date = new Date()
): number {
  const daysSinceCreated =
    (now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);
  return Math.exp((-Math.LN2 * daysSinceCreated) / halfLife);
}

/**
 * Calculate frequency score normalized to max of 2.0
 */
function calculateFrequencyScore(frequency: number): number {
  return Math.min(frequency / 5, 2.0);
}

/**
 * Calculate importance score based on pinned and flagged status
 */
function calculateImportanceScore(
  entry: MemoryEntry,
  config: ScoringConfig
): number {
  if (entry.pinned) {
    return config.importancePinned;
  }
  // Check if entry has any tags indicating it's flagged/important
  if (
    entry.tags &&
    entry.tags.some((tag) => tag === "important" || tag === "flagged")
  ) {
    return config.importanceFlagged;
  }
  return 1.0;
}

/**
 * Calculate relevance score based on keyword matches
 * Returns highest match score: exact match (2.0), partial match (1.2), or no match (1.0)
 */
function calculateRelevanceScore(
  entry: MemoryEntry,
  context: string[],
  config: ScoringConfig
): number {
  if (context.length === 0) {
    return 1.0;
  }

  const contentLower = entry.content.toLowerCase();
  const pathLower = entry.path.toLowerCase();
  const tagsLower = (entry.tags || []).map((t) => t.toLowerCase());

  let maxScore = 1.0;

  for (const keyword of context) {
    const keywordLower = keyword.toLowerCase();
    const words = keywordLower.split(/\s+/);

    // Check for exact match in content, path, or tags
    if (
      contentLower.includes(keywordLower) ||
      pathLower.includes(keywordLower) ||
      tagsLower.some((tag) => tag === keywordLower)
    ) {
      maxScore = Math.max(maxScore, config.relevanceExact);
      continue;
    }

    // Check for partial match (any word from the keyword)
    for (const word of words) {
      if (word.length < 3) continue; // Skip short words
      if (
        contentLower.includes(word) ||
        pathLower.includes(word) ||
        tagsLower.some((tag) => tag.includes(word))
      ) {
        maxScore = Math.max(maxScore, config.relevancePartial);
        break;
      }
    }
  }

  return maxScore;
}

/**
 * Score a single memory entry using composite scoring
 * Formula: recency * frequency * importance * relevance
 */
export function scoreEntry(
  entry: MemoryEntry,
  context: string[] = [],
  config?: Partial<ScoringConfig>
): number {
  const fullConfig: ScoringConfig = { ...DEFAULT_CONFIG, ...config };

  const recencyScore = calculateRecencyScore(
    entry.created,
    fullConfig.recencyHalfLife
  );
  const frequencyScore = calculateFrequencyScore(entry.frequency);
  const importanceScore = calculateImportanceScore(entry, fullConfig);
  const relevanceScore = calculateRelevanceScore(entry, context, fullConfig);

  return recencyScore * frequencyScore * importanceScore * relevanceScore;
}

/**
 * Estimate token count for an entry (words * 1.3)
 */
function estimateTokens(content: string): number {
  const words = content.split(/\s+/).filter((w) => w.length > 0);
  return Math.ceil(words.length * 1.3);
}

/**
 * Rank entries by composite score and return subset within token budget
 * Pinned entries are always included regardless of score
 */
export function rankEntries(
  entries: MemoryEntry[],
  context: string[] = [],
  tokenBudget: number,
  config?: Partial<ScoringConfig>
): MemoryEntry[] {
  if (entries.length === 0) {
    return [];
  }

  // Score all entries
  const scoredEntries = entries.map((entry) => ({
    entry,
    score: scoreEntry(entry, context, config),
    tokens: estimateTokens(entry.content),
  }));

  // Separate pinned and unpinned entries
  const pinnedEntries = scoredEntries.filter((se) => se.entry.pinned);
  const unpinnedEntries = scoredEntries.filter((se) => !se.entry.pinned);

  // Sort unpinned by score (descending)
  unpinnedEntries.sort((a, b) => b.score - a.score);

  // Start with all pinned entries
  const result: MemoryEntry[] = [];
  let tokensUsed = 0;

  for (const se of pinnedEntries) {
    result.push(se.entry);
    tokensUsed += se.tokens;
  }

  // Add unpinned entries until budget exhausted
  for (const se of unpinnedEntries) {
    if (tokensUsed + se.tokens > tokenBudget) {
      break;
    }
    result.push(se.entry);
    tokensUsed += se.tokens;
  }

  return result;
}
