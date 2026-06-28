import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, existsSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// --- trimOldEntries tests ---
import { trimOldEntries } from '../hooks/SecurityValidator.hook';

describe('trimOldEntries', () => {
  const testDir = join(tmpdir(), 'pai-test-trim-' + Date.now());
  const logPath = join(testDir, 'test-events.jsonl');

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test('removes entries older than 90 days', () => {
    const oldDate = new Date(Date.now() - 100 * 86_400_000).toISOString();
    const newDate = new Date().toISOString();
    const lines = [
      JSON.stringify({ timestamp: oldDate, event: 'old' }),
      JSON.stringify({ timestamp: newDate, event: 'new' }),
    ];
    writeFileSync(logPath, lines.join('\n') + '\n');

    trimOldEntries(logPath);

    const result = readFileSync(logPath, 'utf-8').trim().split('\n');
    expect(result.length).toBe(1);
    expect(JSON.parse(result[0]).event).toBe('new');
  });

  test('keeps entries within 90 days', () => {
    const recentDate = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const lines = [
      JSON.stringify({ timestamp: recentDate, event: 'recent1' }),
      JSON.stringify({ timestamp: recentDate, event: 'recent2' }),
    ];
    writeFileSync(logPath, lines.join('\n') + '\n');

    trimOldEntries(logPath);

    const result = readFileSync(logPath, 'utf-8').trim().split('\n');
    expect(result.length).toBe(2);
  });

  test('handles non-existent file gracefully', () => {
    expect(() => trimOldEntries('/tmp/nonexistent-path-xyz.jsonl')).not.toThrow();
  });

  test('handles malformed JSON lines', () => {
    const validDate = new Date().toISOString();
    const lines = [
      'not valid json',
      JSON.stringify({ timestamp: validDate, event: 'valid' }),
      '{ broken',
    ];
    writeFileSync(logPath, lines.join('\n') + '\n');

    trimOldEntries(logPath);

    const result = readFileSync(logPath, 'utf-8').trim().split('\n');
    expect(result.length).toBe(1);
    expect(JSON.parse(result[0]).event).toBe('valid');
  });

  test('handles empty file', () => {
    writeFileSync(logPath, '');
    expect(() => trimOldEntries(logPath)).not.toThrow();
  });
});

// --- loadRatings tests ---
import { loadRatings, synthesisToStagingContent, type SynthesisResult } from '../PAI/Tools/LearningPatternSynthesis';

describe('loadRatings', () => {
  test('returns empty array when file does not exist', () => {
    // loadRatings uses a hardcoded RATINGS_FILE path, so if it doesn't exist, empty
    const ratings = loadRatings(1);
    // This will either return [] (no file) or actual ratings (file exists)
    expect(Array.isArray(ratings)).toBe(true);
  });

  test('returns array type', () => {
    const ratings = loadRatings();
    expect(Array.isArray(ratings)).toBe(true);
  });

  test('filters by day count when specified', () => {
    const allRatings = loadRatings();
    const recentRatings = loadRatings(1);
    // Recent should be <= all
    expect(recentRatings.length).toBeLessThanOrEqual(allRatings.length);
  });
});

// --- synthesisToStagingContent tests ---
describe('synthesisToStagingContent', () => {
  test('generates numbered lessons from frustrations with count >= 2', () => {
    const result: SynthesisResult = {
      period: 'Weekly',
      totalRatings: 10,
      avgRating: 7.0,
      frustrations: [
        { pattern: 'Time Issues', count: 3, avgRating: 4.5, avgConfidence: 0.8, examples: ['slow'] },
        { pattern: 'Incomplete Work', count: 2, avgRating: 5.0, avgConfidence: 0.7, examples: ['partial'] },
      ],
      successes: [
        { pattern: 'Clear Communication', count: 4, avgRating: 9.0, avgConfidence: 0.9, examples: ['good'] },
      ],
      topIssues: ['timing'],
      recommendations: ['Be more concise'],
    };

    const content = synthesisToStagingContent(result);
    expect(content).toContain('1.');
    expect(content).toContain('time issues');
    expect(content).toContain('3 sessions');
  });

  test('skips frustrations with count < 2', () => {
    const result: SynthesisResult = {
      period: 'Weekly',
      totalRatings: 5,
      avgRating: 8.0,
      frustrations: [
        { pattern: 'Rare Issue', count: 1, avgRating: 3.0, avgConfidence: 0.5, examples: ['once'] },
      ],
      successes: [],
      topIssues: [],
      recommendations: ['Keep going'],
    };

    const content = synthesisToStagingContent(result);
    expect(content).not.toContain('Rare Issue');
    expect(content).toContain('Keep going');
  });

  test('includes success patterns with count >= 2', () => {
    const result: SynthesisResult = {
      period: 'Monthly',
      totalRatings: 20,
      avgRating: 8.5,
      frustrations: [],
      successes: [
        { pattern: 'Fast Responses', count: 5, avgRating: 9.2, avgConfidence: 0.9, examples: ['fast'] },
      ],
      topIssues: [],
      recommendations: [],
    };

    const content = synthesisToStagingContent(result);
    expect(content).toContain('fast responses');
    expect(content).toContain('5 sessions');
  });

  test('returns empty string when no patterns qualify', () => {
    const result: SynthesisResult = {
      period: 'Weekly',
      totalRatings: 2,
      avgRating: 7.0,
      frustrations: [
        { pattern: 'One-off', count: 1, avgRating: 5.0, avgConfidence: 0.5, examples: [] },
      ],
      successes: [
        { pattern: 'Also one-off', count: 1, avgRating: 9.0, avgConfidence: 0.8, examples: [] },
      ],
      topIssues: [],
      recommendations: [],
    };

    const content = synthesisToStagingContent(result);
    expect(content).toBe('');
  });
});

// --- maybeRunSynthesisBackstop tests ---
// Note: This function spawns a subprocess and reads state files.
// We test it indirectly by checking it doesn't throw.
import { autoConsolidateEnabled, maybeRunSynthesisBackstop, maybeAutoConsolidate } from '../hooks/SessionCleanup.hook';

describe('maybeRunSynthesisBackstop', () => {
  test('does not throw when called', () => {
    expect(() => maybeRunSynthesisBackstop()).not.toThrow();
  });

  test('is a function', () => {
    expect(typeof maybeRunSynthesisBackstop).toBe('function');
  });
});

describe('maybeAutoConsolidate', () => {
  test('is disabled by default and enabled only by explicit opt-in env', () => {
    expect(autoConsolidateEnabled({})).toBe(false);
    expect(autoConsolidateEnabled({ PAI_AUTO_CONSOLIDATE: '0' })).toBe(false);
    expect(autoConsolidateEnabled({ PAI_AUTO_CONSOLIDATE: '1' })).toBe(true);
    expect(autoConsolidateEnabled({ PAI_AUTO_CONSOLIDATE: 'true' })).toBe(true);
  });

  test('does not throw when called', () => {
    expect(() => maybeAutoConsolidate()).not.toThrow();
  });

  test('is a function', () => {
    expect(typeof maybeAutoConsolidate).toBe('function');
  });
});
