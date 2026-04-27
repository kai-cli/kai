/**
 * RatingCapture.test.ts — Unit + Integration tests for rating capture pipeline
 *
 * Three sections:
 *   1. parseExplicitRating — pure parsing logic, all edge cases
 *   2. detectCorrections — regex scanning of transcript JSONL
 *   3. Integration — hook subprocess → MEMORY/STAGING handoff (no inference)
 *
 * The integration tests use the correction-draft path (rating 4-5) which is
 * fully synchronous (regex-only, no LLM), making it safe for automated testing.
 *
 * Run: bun test tests/RatingCapture.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  mkdirSync, writeFileSync, existsSync, readFileSync,
  readdirSync, rmSync, mkdtempSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'bun';

import { parseExplicitRating, detectCorrections } from '../hooks/lib/rating-parser';
import { listDrafts } from '../hooks/lib/staging';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

const HOOK_PATH = join(import.meta.dir, '../hooks/RatingCapture.hook.ts');

function createFixture(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pai-rating-test-'));

  // Minimal settings.json (required for identity.ts in the subprocess)
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({
    daidentity: { name: 'TestDA', displayName: 'TestDA', color: '#3B82F6' },
    principal: { name: 'TestUser', timezone: 'UTC' },
    env: { PAI_DIR: dir },
  }, null, 2));

  // Directories the hook may write into (auto-created by hooks too, but pre-create for safety)
  for (const d of ['MEMORY/STATE', 'MEMORY/STAGING', 'MEMORY/LEARNING/SIGNALS']) {
    mkdirSync(join(dir, d), { recursive: true });
  }

  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Build a minimal UserPromptSubmit payload JSON string */
function makePayload(prompt: string, sessionId: string, transcriptPath = ''): string {
  return JSON.stringify({
    hook_event_name: 'UserPromptSubmit',
    session_id: sessionId,
    prompt,
    transcript_path: transcriptPath,
  });
}

/** Run the RatingCapture hook with the given payload in a subprocess */
async function runHook(
  payload: string,
  env: Record<string, string> = {},
): Promise<{ exitCode: number; stderr: string }> {
  const proc = spawn({
    cmd: ['bun', HOOK_PATH],
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, ...env },
  });

  proc.stdin.write(payload);
  proc.stdin.end();

  const [stderr, exitCode] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { exitCode, stderr };
}

/** Write a fake transcript JSONL with alternating user/assistant turns */
function writeTranscript(path: string, entries: Array<{ type: 'user' | 'assistant'; content: string }>): void {
  const lines = entries.map(e => JSON.stringify({
    type: e.type,
    message: { content: e.content },
  }));
  writeFileSync(path, lines.join('\n') + '\n');
}

// ─── 1. parseExplicitRating ───────────────────────────────────────────────────

describe('parseExplicitRating — valid inputs', () => {
  it('parses a bare number', () => {
    expect(parseExplicitRating('7')).toEqual({ rating: 7 });
    expect(parseExplicitRating('1')).toEqual({ rating: 1 });
    expect(parseExplicitRating('10')).toEqual({ rating: 10 });
  });

  it('parses rating with dash separator', () => {
    const result = parseExplicitRating('8 - great work');
    expect(result?.rating).toBe(8);
    expect(result?.comment).toBe('great work');
  });

  it('parses rating with colon separator', () => {
    const result = parseExplicitRating('6: needs improvement');
    expect(result?.rating).toBe(6);
    expect(result?.comment).toBe('needs improvement');
  });

  it('parses rating with space and comment', () => {
    const result = parseExplicitRating('9 excellent session');
    expect(result?.rating).toBe(9);
    expect(result?.comment).toBe('excellent session');
  });

  it('strips leading/trailing whitespace before parsing', () => {
    expect(parseExplicitRating('  7  ')?.rating).toBe(7);
    expect(parseExplicitRating('\t8\t')?.rating).toBe(8);
  });

  it('handles "10!" — trailing punctuation is allowed', () => {
    // "!" is not an alphanumeric/separator character, so it is treated as a comment
    const result = parseExplicitRating('10!');
    expect(result).not.toBeNull();
    expect(result?.rating).toBe(10);
  });

  it('parses 10 with a dash comment', () => {
    const result = parseExplicitRating('10 - perfect');
    expect(result?.rating).toBe(10);
    expect(result?.comment).toBe('perfect');
  });
});

describe('parseExplicitRating — rejected inputs', () => {
  it('rejects "10/10" — slash immediately after number', () => {
    expect(parseExplicitRating('10/10')).toBeNull();
  });

  it('rejects "3.5" — decimal point after number', () => {
    expect(parseExplicitRating('3.5')).toBeNull();
  });

  it('rejects "7th" — ordinal suffix', () => {
    expect(parseExplicitRating('7th')).toBeNull();
  });

  it('rejects "11" — above valid range', () => {
    // "11" → matches [1] then afterNumber = "1" (digit) → rejected
    expect(parseExplicitRating('11')).toBeNull();
  });

  it('rejects "0" — below valid range', () => {
    expect(parseExplicitRating('0')).toBeNull();
  });

  it('rejects "3 items" — sentence starter word', () => {
    expect(parseExplicitRating('3 items')).toBeNull();
  });

  it('rejects "5 things to fix" — sentence starter word', () => {
    expect(parseExplicitRating('5 things to fix')).toBeNull();
  });

  it('rejects "3 of the bugs"', () => {
    expect(parseExplicitRating('3 of the bugs')).toBeNull();
  });

  it('rejects "4 steps remaining"', () => {
    expect(parseExplicitRating('4 steps remaining')).toBeNull();
  });

  it('rejects "fix the bug" — no leading number', () => {
    expect(parseExplicitRating('fix the bug')).toBeNull();
  });

  it('rejects empty string', () => {
    expect(parseExplicitRating('')).toBeNull();
  });

  it('rejects "9x" — letter immediately after number', () => {
    expect(parseExplicitRating('9x')).toBeNull();
  });
});

// ─── 2. detectCorrections ─────────────────────────────────────────────────────

describe('detectCorrections', () => {
  const TMP = tmpdir();
  let transcriptPath: string;

  beforeEach(() => {
    transcriptPath = join(TMP, `pai-transcript-test-${Date.now()}.jsonl`);
  });

  afterEach(() => {
    try { rmSync(transcriptPath); } catch { /* ok if already removed */ }
  });

  it('returns [] for a missing file', () => {
    expect(detectCorrections('/nonexistent/path/transcript.jsonl')).toEqual([]);
  });

  it('returns [] for an empty transcript', () => {
    writeFileSync(transcriptPath, '');
    expect(detectCorrections(transcriptPath)).toEqual([]);
  });

  it('returns [] when transcript has only assistant turns', () => {
    writeTranscript(transcriptPath, [
      { type: 'assistant', content: 'I will fix the login bug now.' },
      { type: 'assistant', content: 'Done, here are the changes.' },
    ]);
    expect(detectCorrections(transcriptPath)).toEqual([]);
  });

  it('returns [] when user turns have no correction language', () => {
    writeTranscript(transcriptPath, [
      { type: 'user', content: 'Fix the authentication bug' },
      { type: 'assistant', content: "I'll refactor the auth handler" },
      { type: 'user', content: 'Looks good, deploy it' },
    ]);
    expect(detectCorrections(transcriptPath)).toEqual([]);
  });

  it('detects "No, I meant" correction', () => {
    writeTranscript(transcriptPath, [
      { type: 'user', content: 'Fix the login bug' },
      { type: 'assistant', content: 'Updated the session handler' },
      { type: 'user', content: 'No, I meant the JWT validation, not the session handler' },
    ]);
    const corrections = detectCorrections(transcriptPath);
    expect(corrections.length).toBe(1);
    expect(corrections[0]).toContain('JWT validation');
  });

  it('detects "That\'s not what I" correction', () => {
    writeTranscript(transcriptPath, [
      { type: 'user', content: "That's not what I asked for" },
    ]);
    const corrections = detectCorrections(transcriptPath);
    expect(corrections.length).toBe(1);
  });

  it('detects "I said X not Y" correction', () => {
    writeTranscript(transcriptPath, [
      { type: 'user', content: 'I said add a test, not delete the existing ones' },
    ]);
    const corrections = detectCorrections(transcriptPath);
    expect(corrections.length).toBe(1);
  });

  it('detects "wrong direction" correction', () => {
    writeTranscript(transcriptPath, [
      { type: 'user', content: "You're going in the wrong direction entirely" },
    ]);
    const corrections = detectCorrections(transcriptPath);
    expect(corrections.length).toBe(1);
  });

  it('detects "stop doing" correction', () => {
    writeTranscript(transcriptPath, [
      { type: 'user', content: 'Stop adding comments to every single line' },
    ]);
    const corrections = detectCorrections(transcriptPath);
    expect(corrections.length).toBe(1);
  });

  it('skips assistant turn with correction-like language', () => {
    // Correction patterns should ONLY match user turns
    writeTranscript(transcriptPath, [
      { type: 'assistant', content: 'No, I meant to say the approach is different' },
    ]);
    expect(detectCorrections(transcriptPath)).toEqual([]);
  });

  it('caps at 3 corrections even with more matches', () => {
    writeTranscript(transcriptPath, [
      { type: 'user', content: 'No, I meant the other file' },
      { type: 'user', content: "That's not what I said" },
      { type: 'user', content: 'Wrong direction on the refactor' },
      { type: 'user', content: 'Stop adding those extra imports' },
    ]);
    const corrections = detectCorrections(transcriptPath);
    expect(corrections.length).toBe(3);
  });

  it('handles array-format message content', () => {
    // Claude Code sometimes sends content as [{type:"text",text:"..."}]
    const line = JSON.stringify({
      type: 'user',
      message: {
        content: [
          { type: 'text', text: 'No, I meant to use the config file, not hardcoded values' },
        ],
      },
    });
    writeFileSync(transcriptPath, line + '\n');
    const corrections = detectCorrections(transcriptPath);
    expect(corrections.length).toBe(1);
    expect(corrections[0]).toContain('config file');
  });

  it('truncates correction text at 120 characters', () => {
    const longMessage = 'No, I meant ' + 'x'.repeat(200);
    writeTranscript(transcriptPath, [
      { type: 'user', content: longMessage },
    ]);
    const corrections = detectCorrections(transcriptPath);
    expect(corrections[0].length).toBeLessThanOrEqual(120);
  });
});

// ─── 3. Integration: RatingCapture hook → MEMORY/STAGING handoff ─────────────

describe('RatingCapture integration: correction-draft staging handoff', () => {
  let fixture: { dir: string; cleanup: () => void };
  let savedPaiDir: string | undefined;

  beforeEach(() => {
    fixture = createFixture();
    savedPaiDir = process.env.PAI_DIR;
  });

  afterEach(() => {
    fixture.cleanup();
    // Restore PAI_DIR so other tests are unaffected
    if (savedPaiDir !== undefined) {
      process.env.PAI_DIR = savedPaiDir;
    } else {
      delete process.env.PAI_DIR;
    }
  });

  it('writes a correction draft to MEMORY/STAGING when rating 4 with corrections detected', async () => {
    // Write a transcript with a clear correction message
    const transcriptPath = join(fixture.dir, 'test-transcript.jsonl');
    writeTranscript(transcriptPath, [
      { type: 'user', content: 'Refactor the auth module' },
      { type: 'assistant', content: 'I rewrote the entire session handler' },
      { type: 'user', content: 'No, I meant just the JWT part, not the session handler' },
    ]);

    const payload = makePayload('4', 'test-session-handoff', transcriptPath);
    const { exitCode, stderr } = await runHook(payload, { PAI_DIR: fixture.dir });

    expect(exitCode).toBe(0);

    // A draft .md file should exist in MEMORY/STAGING
    const stagingDir = join(fixture.dir, 'MEMORY', 'STAGING');
    const files = existsSync(stagingDir)
      ? readdirSync(stagingDir).filter(f => f.endsWith('.md'))
      : [];
    expect(files.length).toBe(1);
    expect(stderr).toContain('[RatingCapture] Generated correction draft');
  });

  it('draft is readable via listDrafts() after the hook writes it', async () => {
    const transcriptPath = join(fixture.dir, 'test-transcript.jsonl');
    writeTranscript(transcriptPath, [
      { type: 'user', content: 'No, I meant the database layer, not the API layer' },
    ]);

    const sessionId = 'test-session-listdrafts';
    const payload = makePayload('5', sessionId, transcriptPath);
    const { exitCode } = await runHook(payload, { PAI_DIR: fixture.dir });
    expect(exitCode).toBe(0);

    // Point in-process paiPath at the fixture, then call listDrafts()
    process.env.PAI_DIR = fixture.dir;
    const drafts = listDrafts();

    expect(drafts.length).toBe(1);
    expect(drafts[0].type).toBe('correction');
    expect(drafts[0].sourceRating).toBe(5);
    expect(drafts[0].confidence).toBe(0.65);
    expect(drafts[0].targetProject).toBe('kai');
  });

  it('staging-state.json totalGenerated increments after draft is written', async () => {
    const transcriptPath = join(fixture.dir, 'test-transcript.jsonl');
    writeTranscript(transcriptPath, [
      { type: 'user', content: 'Wrong direction on this approach' },
    ]);

    const payload = makePayload('4', 'test-session-state', transcriptPath);
    await runHook(payload, { PAI_DIR: fixture.dir });

    const stateFile = join(fixture.dir, 'MEMORY', 'STAGING', '.staging-state.json');
    expect(existsSync(stateFile)).toBe(true);
    const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
    expect(state.stats.totalGenerated).toBe(1);
    expect(state.drafts.length).toBe(1);
    expect(state.drafts[0].type).toBe('correction');
  });

  it('writes ratings.jsonl entry for any explicit rating', async () => {
    const payload = makePayload('7 good session', 'test-session-ratings');
    const { exitCode } = await runHook(payload, { PAI_DIR: fixture.dir });
    expect(exitCode).toBe(0);

    const ratingsFile = join(fixture.dir, 'MEMORY', 'LEARNING', 'SIGNALS', 'ratings.jsonl');
    expect(existsSync(ratingsFile)).toBe(true);

    const entry = JSON.parse(readFileSync(ratingsFile, 'utf-8').trim().split('\n')[0]);
    expect(entry.rating).toBe(7);
    expect(entry.source).toBe('explicit');
    expect(entry.session_id).toBe('test-session-ratings');
    expect(entry.comment).toBe('good session');
    expect(entry.timestamp).toBeTruthy();
  });

  it('does NOT write a draft when rating 4 with no corrections in transcript', async () => {
    // Transcript with user messages but no correction patterns
    const transcriptPath = join(fixture.dir, 'test-transcript.jsonl');
    writeTranscript(transcriptPath, [
      { type: 'user', content: 'Build a caching layer' },
      { type: 'assistant', content: 'Done, added Redis caching' },
      { type: 'user', content: 'Deploy it' },
    ]);

    const payload = makePayload('4', 'test-session-no-corrections', transcriptPath);
    await runHook(payload, { PAI_DIR: fixture.dir });

    const stagingDir = join(fixture.dir, 'MEMORY', 'STAGING');
    const files = existsSync(stagingDir)
      ? readdirSync(stagingDir).filter(f => f.endsWith('.md'))
      : [];
    // No corrections → no draft generated
    expect(files.length).toBe(0);
  });
});
