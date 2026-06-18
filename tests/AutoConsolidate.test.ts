import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `auto-consolidate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(testDir, 'MEMORY', 'STAGING'), { recursive: true });
  mkdirSync(join(testDir, 'MEMORY', 'WISDOM', 'FRAMES'), { recursive: true });
  mkdirSync(join(testDir, 'MEMORY', 'STATE'), { recursive: true });
  process.env.PAI_DIR = testDir;
});

afterEach(() => {
  delete process.env.PAI_DIR;
  try { rmSync(testDir, { recursive: true, force: true }); } catch {}
});

function writeStagingDraft(opts: { title?: string; confidence?: number; daysAgo?: number; content?: string } = {}): string {
  const title = opts.title ?? 'Test draft';
  const confidence = opts.confidence ?? 0.85;
  const daysAgo = opts.daysAgo ?? 20;
  const content = opts.content ?? '1. Always verify before committing.\n2. Pre-read all inputs.\n';

  const generated = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const filename = `${generated.replace(/[:.]/g, '-').slice(0, 19)}_pattern-insight_test.md`;

  const fileContent = `---
type: draft-memory
source_type: pattern-insight
source_session: test
source_rating: n/a
confidence: ${confidence}
generated: ${generated}
expires: ${expires}
target_project: pai-config
target_filename: feedback_test.md
title: "${title}"
---

${content}
`;

  writeFileSync(join(testDir, 'MEMORY', 'STAGING', filename), fileContent);

  // Also write staging state
  const state = {
    created: '2026-01-01',
    expiryDays: 14,
    drafts: [{ filename, generated, expires, type: 'pattern-insight' }],
    stats: { totalGenerated: 1, totalApproved: 0, totalRejected: 0, totalExpired: 0 },
  };
  writeFileSync(join(testDir, 'MEMORY', 'STAGING', '.staging-state.json'), JSON.stringify(state));

  return filename;
}

async function autoConsol() {
  return await import('../PAI/Tools/AutoConsolidate');
}

describe('AutoConsolidate', () => {
  describe('consolidate', () => {
    it('returns empty result when no staging entries', async () => {
      const { consolidate } = await autoConsol();
      const result = consolidate(true);
      expect(result.candidates).toHaveLength(0);
      expect(result.promoted).toHaveLength(0);
    });

    it('skips entries younger than 14 days', async () => {
      const { consolidate } = await autoConsol();
      writeStagingDraft({ daysAgo: 5 });
      const result = consolidate(true);
      expect(result.promoted).toHaveLength(0);
      expect(result.skipped.length).toBeGreaterThan(0);
      expect(result.skipped[0]).toContain('too young');
    });

    it('skips entries with confidence below 0.8', async () => {
      const { consolidate } = await autoConsol();
      writeStagingDraft({ confidence: 0.6, daysAgo: 20 });
      const result = consolidate(true);
      expect(result.promoted).toHaveLength(0);
      expect(result.skipped[0]).toContain('low confidence');
    });

    it('skips entries containing uncertainty language', async () => {
      const { consolidate } = await autoConsol();
      writeStagingDraft({ daysAgo: 20, content: '1. Maybe check the logs first.\n' });
      const result = consolidate(true);
      expect(result.promoted).toHaveLength(0);
      expect(result.skipped[0]).toContain('uncertainty');
    });

    it('skips entries with "might" in content', async () => {
      const { consolidate } = await autoConsol();
      writeStagingDraft({ daysAgo: 20, content: '1. This might help with debugging.\n' });
      const result = consolidate(true);
      expect(result.skipped[0]).toContain('might');
    });

    it('promotes eligible entries in dry-run without modifying files', async () => {
      const { consolidate } = await autoConsol();
      writeStagingDraft({ daysAgo: 20, confidence: 0.85 });
      const result = consolidate(true);
      expect(result.promoted).toHaveLength(1);
      expect(result.dryRun).toBe(true);
      // File should still exist in staging
      const stagingFiles = require('fs').readdirSync(join(testDir, 'MEMORY', 'STAGING')).filter((f: string) => f.endsWith('.md'));
      expect(stagingFiles.length).toBe(1);
    });

    it('actually promotes and archives when not dry-run', async () => {
      const { consolidate } = await autoConsol();
      writeStagingDraft({ daysAgo: 20, confidence: 0.85 });
      const result = consolidate(false);
      expect(result.promoted).toHaveLength(1);
      // File should be archived
      const archiveDir = join(testDir, 'MEMORY', 'STAGING', '.archive');
      expect(existsSync(archiveDir)).toBe(true);
      const archived = require('fs').readdirSync(archiveDir);
      expect(archived.length).toBe(1);
    });

    it('writes promotion log entry', async () => {
      const { consolidate } = await autoConsol();
      writeStagingDraft({ daysAgo: 20, confidence: 0.85 });
      consolidate(false);
      const logPath = join(testDir, 'MEMORY', 'STATE', 'auto-promotions.jsonl');
      expect(existsSync(logPath)).toBe(true);
      const content = readFileSync(logPath, 'utf-8');
      expect(content).toContain('auto-consolidate');
    });

    it('appends promoted content to WISDOM/FRAMES/algorithm.md', async () => {
      const { consolidate } = await autoConsol();
      writeFileSync(join(testDir, 'MEMORY', 'WISDOM', 'FRAMES', 'algorithm.md'), '# Existing\n\nOld content.\n');
      writeStagingDraft({ daysAgo: 20, confidence: 0.85, content: '1. New insight here.\n' });
      consolidate(false);
      const frames = readFileSync(join(testDir, 'MEMORY', 'WISDOM', 'FRAMES', 'algorithm.md'), 'utf-8');
      expect(frames).toContain('New insight here');
      expect(frames).toContain('Old content');
    });

    it('respects max 3 promotions per run', async () => {
      const { consolidate } = await autoConsol();
      for (let i = 0; i < 5; i++) {
        writeStagingDraft({ daysAgo: 20 + i, confidence: 0.85, title: `Draft ${i}`, content: `1. Unique insight ${i} for testing consolidation limits.\n` });
      }
      // Rewrite state with all 5
      const staging = join(testDir, 'MEMORY', 'STAGING');
      const files = require('fs').readdirSync(staging).filter((f: string) => f.endsWith('.md'));
      const state = {
        created: '2026-01-01', expiryDays: 14,
        drafts: files.map((f: string) => ({ filename: f, generated: new Date().toISOString(), expires: new Date(Date.now() + 7 * 86400000).toISOString(), type: 'pattern-insight' })),
        stats: { totalGenerated: 5, totalApproved: 0, totalRejected: 0, totalExpired: 0 },
      };
      writeFileSync(join(staging, '.staging-state.json'), JSON.stringify(state));

      const result = consolidate(true);
      expect(result.promoted.length).toBeLessThanOrEqual(3);
    });

    it('skips entries similar to existing wisdom', async () => {
      const { consolidate } = await autoConsol();
      const existingContent = '### Always verify before committing [CRYSTAL: 90%]\nAlways verify before committing changes to production systems.\n';
      writeFileSync(join(testDir, 'MEMORY', 'WISDOM', 'FRAMES', 'algorithm.md'), existingContent);
      writeStagingDraft({ daysAgo: 20, content: '1. Always verify before committing changes to production systems and environments.\n' });
      const result = consolidate(true);
      expect(result.promoted).toHaveLength(0);
      expect(result.skipped[0]).toContain('similar');
    });
  });

  describe('edge cases', () => {
    it('handles missing WISDOM/FRAMES directory gracefully', async () => {
      const { consolidate } = await autoConsol();
      rmSync(join(testDir, 'MEMORY', 'WISDOM'), { recursive: true, force: true });
      writeStagingDraft({ daysAgo: 20, confidence: 0.85 });
      const result = consolidate(true);
      expect(result.promoted).toHaveLength(1);
    });

    it('handles empty STAGING directory', async () => {
      const { consolidate } = await autoConsol();
      const result = consolidate(false);
      expect(result.candidates).toHaveLength(0);
      expect(result.promoted).toHaveLength(0);
    });

    it('does not promote entry with "not sure" in content', async () => {
      const { consolidate } = await autoConsol();
      writeStagingDraft({ daysAgo: 20, content: '1. I am not sure this is the right approach.\n' });
      const result = consolidate(true);
      expect(result.promoted).toHaveLength(0);
    });

    it('does not promote entry with "possibly" in content', async () => {
      const { consolidate } = await autoConsol();
      writeStagingDraft({ daysAgo: 20, content: '1. This could possibly work for debugging.\n' });
      const result = consolidate(true);
      expect(result.promoted).toHaveLength(0);
    });

    it('concurrent calls produce consistent results (idempotent dry-run)', async () => {
      const { consolidate } = await autoConsol();
      writeStagingDraft({ daysAgo: 20, confidence: 0.85 });
      const [r1, r2] = await Promise.all([
        Promise.resolve(consolidate(true)),
        Promise.resolve(consolidate(true)),
      ]);
      expect(r1.promoted).toEqual(r2.promoted);
      expect(r1.skipped).toEqual(r2.skipped);
    });
  });

  describe('formatConsolidationResult', () => {
    it('shows "nothing to consolidate" when no candidates', async () => {
      const { formatConsolidationResult } = await autoConsol();
      const result = { candidates: [], promoted: [], skipped: [], dryRun: false };
      const formatted = formatConsolidationResult(result);
      expect(formatted).toContain('Nothing to consolidate');
    });

    it('shows promoted entries', async () => {
      const { formatConsolidationResult } = await autoConsol();
      const result = { candidates: [], promoted: ['Test insight'], skipped: [], dryRun: false };
      const formatted = formatConsolidationResult(result);
      expect(formatted).toContain('Test insight');
      expect(formatted).toContain('Promoted');
    });
  });
});
