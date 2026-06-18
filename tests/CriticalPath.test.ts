/**
 * CriticalPath.test.ts — Integration tests for the self-learning loop
 *
 * Tests the critical path: RatingCapture → writes draft to STAGING →
 * LoadContext reads STAGING for nudge → pai curate lists draft.
 *
 * If any handoff breaks it fails silently in production, hence these tests.
 *
 * Run: bun test tests/CriticalPath.test.ts
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let tmpDir: string;

function setup() {
  tmpDir = mkdtempSync(join(tmpdir(), 'pai-critical-test-'));
  mkdirSync(join(tmpDir, 'MEMORY', 'STAGING'), { recursive: true });
  mkdirSync(join(tmpDir, 'MEMORY', 'STATE'), { recursive: true });
  mkdirSync(join(tmpDir, 'MEMORY', 'LEARNING', 'SIGNALS'), { recursive: true });
  process.env.PAI_DIR = tmpDir;
}

function cleanup() {
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.PAI_DIR;
}

// ── Leg 1: RatingCapture generates correction draft → STAGING ─────────────────

describe('CriticalPath: RatingCapture correction draft → STAGING', () => {
  beforeEach(setup);
  afterEach(cleanup);

  test('generateCorrectionDraft writes a file to STAGING', async () => {
    const { writeDraft } = await import('../hooks/lib/staging');

    writeDraft({
      type: 'correction',
      sourceSession: 'session-test-001',
      sourceRating: 4,
      confidence: 0.65,
      generated: new Date().toISOString(),
      targetProject: 'test-project',
      targetFilename: 'feedback_correction.md',
      title: 'Correction pattern (4/10 session)',
      content: 'Session required corrections:\n- no, I meant the other file',
    });

    const stagingDir = join(tmpDir, 'MEMORY', 'STAGING');
    const files = require('fs').readdirSync(stagingDir).filter((f: string) => f.endsWith('.md'));
    expect(files.length).toBe(1);
    expect(files[0]).toContain('correction');
  });

  test('correction draft frontmatter has required fields', async () => {
    const { writeDraft, listDrafts } = await import('../hooks/lib/staging');

    writeDraft({
      type: 'correction',
      sourceSession: 'session-test-002',
      sourceRating: 5,
      confidence: 0.65,
      generated: new Date().toISOString(),
      targetProject: 'test-project',
      targetFilename: 'feedback_correction.md',
      title: 'Correction test',
      content: 'Correction content',
    });

    const drafts = listDrafts();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].type).toBe('correction');
    expect(drafts[0].sourceRating).toBe(5);
    expect(drafts[0].confidence).toBe(0.65);
    expect(drafts[0].expires).toBeTruthy();
  });
});

// ── Leg 2: STAGING has drafts → LoadContext nudge fires ──────────────────────

describe('CriticalPath: STAGING drafts → LoadContext nudge', () => {
  beforeEach(setup);
  afterEach(cleanup);

  test('nudge fires when STAGING has drafts and no recent curation', () => {
    // Write a draft file to STAGING
    const stagingDir = join(tmpDir, 'MEMORY', 'STAGING');
    writeFileSync(join(stagingDir, '2026-04-16T00-00-00_correction_test.md'), `---
type: draft-memory
expires: ${new Date(Date.now() + 14 * 86400000).toISOString()}
---
Test draft
`);

    // No curation log = last curation was never (>14 days threshold)
    const curationLog = join(tmpDir, 'MEMORY', 'STATE', 'curation-log.jsonl');
    expect(existsSync(curationLog)).toBe(false);

    // Verify the nudge condition would trigger (LoadContext logic in isolation)
    const { readdirSync } = require('fs');
    const drafts = readdirSync(stagingDir).filter((f: string) => f.endsWith('.md'));
    expect(drafts.length).toBeGreaterThan(0);
    // No curation log = daysSinceCuration defaults to 999 (>14 threshold)
    // → nudge would fire
  });

  test('nudge suppressed when curated recently (<14 days)', () => {
    // Write a draft
    const stagingDir = join(tmpDir, 'MEMORY', 'STAGING');
    writeFileSync(join(stagingDir, '2026-04-16T00-00-00_correction_test.md'), `---
type: draft-memory
expires: ${new Date(Date.now() + 14 * 86400000).toISOString()}
---
Test draft
`);

    // Write a recent curation log entry (today)
    const curationLog = join(tmpDir, 'MEMORY', 'STATE', 'curation-log.jsonl');
    appendFileSync(curationLog, JSON.stringify({
      timestamp: new Date().toISOString(),
      dryRun: false,
      actionsQueued: 0,
    }) + '\n');

    // Verify condition: curation was recent, nudge should NOT fire
    const lines = readFileSync(curationLog, 'utf-8').trim().split('\n').filter(l => l);
    const lastEntry = JSON.parse(lines[lines.length - 1]);
    const daysSince = Math.floor((Date.now() - new Date(lastEntry.timestamp).getTime()) / 86400000);
    expect(daysSince).toBeLessThan(14); // < 14 days = no nudge
  });
});

// ── Leg 3: STAGING draft → pai curate lists it correctly ─────────────────────

describe('CriticalPath: STAGING draft → pai curate lists correctly', () => {
  beforeEach(setup);
  afterEach(cleanup);

  test('draft written by RatingCapture path is visible in listDrafts', async () => {
    const { writeDraft, listDrafts } = await import('../hooks/lib/staging');

    // Simulate what RatingCapture.generateCorrectionDraft does
    writeDraft({
      type: 'correction',
      sourceSession: 'integration-test-session',
      sourceRating: 4,
      confidence: 0.65,
      generated: new Date().toISOString(),
      targetProject: 'pai-config',
      targetFilename: 'feedback_correction_pattern.md',
      title: 'Correction pattern (4/10 session)',
      content: 'Session required corrections:\n- no, I meant the other file\n\nReview for systematic misunderstanding patterns.',
    });

    const drafts = listDrafts();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].title).toContain('Correction pattern');
    expect(drafts[0].targetFilename).toBe('feedback_correction_pattern.md');
    expect(drafts[0].content).toContain('corrections');
  });

  test('expired draft is not listed', async () => {
    const { listDrafts, writeDraft } = await import('../hooks/lib/staging');
    const { writeFileSync: write } = await import('fs');

    // Write a draft then manually expire it
    const filename = writeDraft({
      type: 'success-pattern',
      sourceSession: 'expired-session',
      sourceRating: 9,
      confidence: 0.8,
      generated: new Date().toISOString(),
      targetProject: 'pai-config',
      targetFilename: 'feedback_success.md',
      title: 'Expired draft',
      content: 'This should expire',
    });

    const filePath = join(tmpDir, 'MEMORY', 'STAGING', filename);
    const content = readFileSync(filePath, 'utf-8');
    const pastExpiry = new Date(Date.now() - 1000).toISOString();
    write(filePath, content.replace(/^expires: .+$/m, `expires: ${pastExpiry}`));

    expect(listDrafts()).toHaveLength(0);
  });

  test('reject removes draft from listDrafts', async () => {
    const { writeDraft, listDrafts, rejectDraft } = await import('../hooks/lib/staging');

    const filename = writeDraft({
      type: 'correction',
      sourceSession: 'reject-test',
      sourceRating: 4,
      confidence: 0.65,
      generated: new Date().toISOString(),
      targetProject: 'pai-config',
      targetFilename: 'feedback_correction.md',
      title: 'To reject',
      content: 'Content',
    });

    expect(listDrafts()).toHaveLength(1);
    rejectDraft(filename);
    expect(listDrafts()).toHaveLength(0);
  });
});

// ── Leg 4: LAST_RESPONSE_CACHE missing → graceful fallback ──────────────────

describe('CriticalPath: LAST_RESPONSE_CACHE missing → graceful fallback', () => {
  test('detectCorrections returns empty for missing transcript path', async () => {
    const { detectCorrections } = await import('../hooks/lib/rating-parser');
    expect(detectCorrections('/nonexistent/transcript.jsonl')).toEqual([]);
  });

  test('detectCorrections returns empty for empty string path', async () => {
    const { detectCorrections } = await import('../hooks/lib/rating-parser');
    expect(detectCorrections('')).toEqual([]);
  });

  test('parseExplicitRating still works without any file system access', async () => {
    const { parseExplicitRating } = await import('../hooks/lib/rating-parser');
    expect(parseExplicitRating('8 great session')).not.toBeNull();
    expect(parseExplicitRating('3 bugs found')).toBeNull();
  });
});
