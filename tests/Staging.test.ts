/**
 * Staging.test.ts — Unit tests for hooks/lib/staging.ts
 *
 * Tests: writeDraft, listDrafts, cleanupExpired, rejectDraft,
 *        approveDraft (partial — file write only), expiry filtering.
 *
 * Run: bun test tests/Staging.test.ts
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ── Fixture ───────────────────────────────────────────────────────────────────

let tmpDir: string;

function setup() {
  tmpDir = mkdtempSync(join(tmpdir(), 'pai-staging-test-'));
  mkdirSync(join(tmpDir, 'MEMORY', 'STAGING'), { recursive: true });
  process.env.PAI_DIR = tmpDir;
}

function cleanup() {
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.PAI_DIR;
}

async function getStaging() {
  return import('../hooks/lib/staging');
}

function makeDraft(overrides: Partial<{
  title: string;
  type: 'success-pattern' | 'correction' | 'pattern-insight';
  confidence: number;
  sourceSession: string;
  sourceRating: number;
  targetProject: string;
  targetFilename: string;
  content: string;
  generated: string;
}> = {}) {
  return {
    type: 'success-pattern' as const,
    sourceSession: 'session-abc123',
    sourceRating: 9,
    confidence: 0.85,
    generated: new Date().toISOString(),
    targetProject: 'pai-config',
    targetFilename: 'feedback_test_pattern.md',
    title: 'Test Pattern',
    content: 'This is the test pattern content.',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('staging - writeDraft', () => {
  beforeEach(setup);
  afterEach(cleanup);

  test('creates a file in STAGING directory', async () => {
    const { writeDraft } = await getStaging();
    const filename = writeDraft(makeDraft());
    const filePath = join(tmpDir, 'MEMORY', 'STAGING', filename);
    expect(existsSync(filePath)).toBe(true);
  });

  test('filename contains type and title slug', async () => {
    const { writeDraft } = await getStaging();
    const filename = writeDraft(makeDraft({ title: 'My Cool Pattern', type: 'success-pattern' }));
    expect(filename).toContain('success-pattern');
    expect(filename).toContain('my-cool-pattern');
  });

  test('file contains required frontmatter fields', async () => {
    const { writeDraft } = await getStaging();
    const filename = writeDraft(makeDraft({ confidence: 0.9, sourceRating: 8 }));
    const content = readFileSync(join(tmpDir, 'MEMORY', 'STAGING', filename), 'utf-8');
    expect(content).toContain('confidence: 0.9');
    expect(content).toContain('source_rating: 8');
    expect(content).toContain('target_project: pai-config');
    expect(content).toContain('expires:');
  });

  test('file contains the draft body content', async () => {
    const { writeDraft } = await getStaging();
    const filename = writeDraft(makeDraft({ content: 'Special body content here.' }));
    const content = readFileSync(join(tmpDir, 'MEMORY', 'STAGING', filename), 'utf-8');
    expect(content).toContain('Special body content here.');
  });

  test('updates .staging-state.json stats', async () => {
    const { writeDraft } = await getStaging();
    writeDraft(makeDraft({ title: 'First' }));
    writeDraft(makeDraft({ title: 'Second' }));
    const state = JSON.parse(readFileSync(
      join(tmpDir, 'MEMORY', 'STAGING', '.staging-state.json'), 'utf-8'
    ));
    expect(state.stats.totalGenerated).toBe(2);
    expect(state.drafts).toHaveLength(2);
  });
});

describe('staging - listDrafts', () => {
  beforeEach(setup);
  afterEach(cleanup);

  test('returns empty array when no drafts', async () => {
    const { listDrafts } = await getStaging();
    expect(listDrafts()).toEqual([]);
  });

  test('returns written drafts', async () => {
    const { writeDraft, listDrafts } = await getStaging();
    writeDraft(makeDraft({ title: 'Alpha', confidence: 0.9 }));
    writeDraft(makeDraft({ title: 'Beta', confidence: 0.7 }));
    const drafts = listDrafts();
    expect(drafts).toHaveLength(2);
  });

  test('drafts sorted by confidence descending', async () => {
    const { writeDraft, listDrafts } = await getStaging();
    writeDraft(makeDraft({ title: 'Low confidence', confidence: 0.5 }));
    writeDraft(makeDraft({ title: 'High confidence', confidence: 0.95 }));
    const drafts = listDrafts();
    expect(drafts[0].confidence).toBeGreaterThan(drafts[1].confidence);
  });

  test('filters out expired drafts', async () => {
    const { writeDraft, listDrafts } = await getStaging();
    const { writeFileSync } = await import('fs');

    // Write a draft with past expiry
    const filename = writeDraft(makeDraft({ title: 'About to expire' }));
    const filePath = join(tmpDir, 'MEMORY', 'STAGING', filename);
    const content = readFileSync(filePath, 'utf-8');
    const pastExpiry = new Date(Date.now() - 1000).toISOString();
    writeFileSync(filePath, content.replace(/^expires: .+$/m, `expires: ${pastExpiry}`));

    expect(listDrafts()).toHaveLength(0);
  });

  test('draft has all expected fields', async () => {
    const { writeDraft, listDrafts } = await getStaging();
    writeDraft(makeDraft({ title: 'Field Check', confidence: 0.88, sourceRating: 9 }));
    const [draft] = listDrafts();
    expect(draft.title).toBe('Field Check');
    expect(draft.confidence).toBe(0.88);
    expect(draft.sourceRating).toBe(9);
    expect(draft.type).toBe('success-pattern');
    expect(draft.targetProject).toBe('pai-config');
    expect(draft.expires).toBeTruthy();
    expect(draft.filename).toBeTruthy();
  });
});

describe('staging - cleanupExpired', () => {
  beforeEach(setup);
  afterEach(cleanup);

  test('removes expired draft files', async () => {
    const { writeDraft, cleanupExpired } = await getStaging();
    const { writeFileSync } = await import('fs');

    const filename = writeDraft(makeDraft({ title: 'Expired Draft' }));
    const filePath = join(tmpDir, 'MEMORY', 'STAGING', filename);
    const content = readFileSync(filePath, 'utf-8');
    const pastExpiry = new Date(Date.now() - 86400000).toISOString(); // 1 day ago
    writeFileSync(filePath, content.replace(/^expires: .+$/m, `expires: ${pastExpiry}`));

    expect(existsSync(filePath)).toBe(true);
    const removed = cleanupExpired();
    expect(removed).toBe(1);
    expect(existsSync(filePath)).toBe(false);
  });

  test('leaves non-expired drafts untouched', async () => {
    const { writeDraft, cleanupExpired } = await getStaging();
    const filename = writeDraft(makeDraft({ title: 'Fresh Draft' }));
    const filePath = join(tmpDir, 'MEMORY', 'STAGING', filename);
    const removed = cleanupExpired();
    expect(removed).toBe(0);
    expect(existsSync(filePath)).toBe(true);
  });

  test('returns 0 when staging is empty', async () => {
    const { cleanupExpired } = await getStaging();
    expect(cleanupExpired()).toBe(0);
  });

  test('increments totalExpired in state', async () => {
    const { writeDraft, cleanupExpired } = await getStaging();
    const { writeFileSync } = await import('fs');

    const filename = writeDraft(makeDraft({ title: 'Will expire' }));
    const filePath = join(tmpDir, 'MEMORY', 'STAGING', filename);
    const content = readFileSync(filePath, 'utf-8');
    writeFileSync(filePath, content.replace(/^expires: .+$/m,
      `expires: ${new Date(Date.now() - 1000).toISOString()}`));

    cleanupExpired();
    const state = JSON.parse(readFileSync(
      join(tmpDir, 'MEMORY', 'STAGING', '.staging-state.json'), 'utf-8'
    ));
    expect(state.stats.totalExpired).toBe(1);
  });
});

describe('staging - rejectDraft', () => {
  beforeEach(setup);
  afterEach(cleanup);

  test('removes draft file', async () => {
    const { writeDraft, rejectDraft } = await getStaging();
    const filename = writeDraft(makeDraft({ title: 'To Reject' }));
    const filePath = join(tmpDir, 'MEMORY', 'STAGING', filename);
    expect(existsSync(filePath)).toBe(true);
    rejectDraft(filename);
    expect(existsSync(filePath)).toBe(false);
  });

  test('returns false for non-existent draft', async () => {
    const { rejectDraft } = await getStaging();
    expect(rejectDraft('nonexistent.md')).toBe(false);
  });

  test('logs rejection to .rejections.jsonl', async () => {
    const { writeDraft, rejectDraft } = await getStaging();
    const filename = writeDraft(makeDraft({ title: 'Logged Rejection' }));
    rejectDraft(filename, 'not relevant');

    const rejectLog = join(tmpDir, 'MEMORY', 'STAGING', '.rejections.jsonl');
    expect(existsSync(rejectLog)).toBe(true);
    const entry = JSON.parse(readFileSync(rejectLog, 'utf-8').trim());
    expect(entry.filename).toBe(filename);
    expect(entry.reason).toBe('not relevant');
  });

  test('increments totalRejected in state', async () => {
    const { writeDraft, rejectDraft } = await getStaging();
    const filename = writeDraft(makeDraft({ title: 'Count Me' }));
    rejectDraft(filename);
    const state = JSON.parse(readFileSync(
      join(tmpDir, 'MEMORY', 'STAGING', '.staging-state.json'), 'utf-8'
    ));
    expect(state.stats.totalRejected).toBe(1);
  });

  test('draft no longer appears in listDrafts after rejection', async () => {
    const { writeDraft, rejectDraft, listDrafts } = await getStaging();
    const filename = writeDraft(makeDraft({ title: 'Gone After Reject' }));
    expect(listDrafts()).toHaveLength(1);
    rejectDraft(filename);
    expect(listDrafts()).toHaveLength(0);
  });
});
