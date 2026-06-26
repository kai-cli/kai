import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { writeFileSync, mkdirSync, existsSync, unlinkSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { analyzeTranscript, isTrivialSession } from '../hooks/SessionEndComposite.hook';

const HOOK_SOURCE = readFileSync(join(import.meta.dir, '../hooks/SessionEndComposite.hook.ts'), 'utf-8');

const TEST_DIR = join(import.meta.dir, '.test-session-end-composite');
const TRANSCRIPT_PATH = join(TEST_DIR, 'transcript.jsonl');

beforeAll(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

describe('SessionEndComposite', () => {
  test('emits decision telemetry explaining why inference hooks did or did not run', () => {
    expect(HOOK_SOURCE).toContain("emitMemoryTelemetry('session_end.composite'");
    expect(HOOK_SOURCE).toContain('selected_hooks');
    expect(HOOK_SOURCE).toContain('skipped_hooks');
    expect(HOOK_SOURCE).toContain('estimated_tokens');
    expect(HOOK_SOURCE).toContain('message_count');
    expect(HOOK_SOURCE).toContain('gate_enabled');
  });

  describe('analyzeTranscript', () => {
    test('detects trivial session (4 messages, 1500 tokens)', () => {
      const transcript = [
        '{"type":"user","message":{"content":"Hello"}}',
        '{"type":"assistant","message":{"content":"Hi there!"}}',
        '{"type":"user","message":{"content":"How are you?"}}',
        '{"type":"assistant","message":{"content":"I\'m doing well, thanks!"}}',
      ].join('\n');

      writeFileSync(TRANSCRIPT_PATH, transcript);

      const metrics = analyzeTranscript(TRANSCRIPT_PATH);

      expect(metrics.messageCount).toBe(4);
      expect(metrics.estimatedTokens).toBeLessThan(2000);
      expect(metrics.hasFeedback).toBe(false);
    });

    test('detects substantial session (10 messages, 5000 tokens)', () => {
      const longMessage = 'A'.repeat(20000); // ~5000 tokens
      const transcript = [
        '{"type":"user","message":{"content":"Start work"}}',
        '{"type":"assistant","message":{"content":"OK"}}',
        '{"type":"user","message":{"content":"Do something"}}',
        `{"type":"assistant","message":{"content":"${longMessage}"}}`,
        '{"type":"user","message":{"content":"Continue"}}',
        '{"type":"assistant","message":{"content":"Done"}}',
        '{"type":"user","message":{"content":"Test it"}}',
        '{"type":"assistant","message":{"content":"Passed"}}',
        '{"type":"user","message":{"content":"Deploy"}}',
        '{"type":"assistant","message":{"content":"Deployed"}}',
      ].join('\n');

      writeFileSync(TRANSCRIPT_PATH, transcript);

      const metrics = analyzeTranscript(TRANSCRIPT_PATH);

      expect(metrics.messageCount).toBe(10);
      expect(metrics.estimatedTokens).toBeGreaterThan(2000);
      expect(metrics.hasFeedback).toBe(false);
    });

    test('detects /feedback command in transcript', () => {
      const transcript = [
        '{"type":"user","message":{"content":"Hello"}}',
        '{"type":"assistant","message":{"content":"Hi"}}',
        '{"type":"user","message":{"content":"/feedback This was great"}}',
        '{"type":"assistant","message":{"content":"Thank you!"}}',
      ].join('\n');

      writeFileSync(TRANSCRIPT_PATH, transcript);

      const metrics = analyzeTranscript(TRANSCRIPT_PATH);

      expect(metrics.messageCount).toBe(4);
      expect(metrics.hasFeedback).toBe(true);
    });

    test('handles missing transcript gracefully', () => {
      const metrics = analyzeTranscript('/nonexistent/path.jsonl');

      expect(metrics.messageCount).toBe(0);
      expect(metrics.estimatedTokens).toBe(0);
      expect(metrics.hasFeedback).toBe(false);
    });
  });

  describe('isTrivialSession', () => {
    test('returns true for trivial session (4 messages, 1500 tokens)', () => {
      const metrics = {
        messageCount: 4,
        estimatedTokens: 1500,
        hasFeedback: false,
      };

      expect(isTrivialSession(metrics)).toBe(true);
    });

    test('returns false for session with many messages', () => {
      const metrics = {
        messageCount: 10,
        estimatedTokens: 1500,
        hasFeedback: false,
      };

      expect(isTrivialSession(metrics)).toBe(false);
    });

    test('returns false for session with many tokens', () => {
      const metrics = {
        messageCount: 4,
        estimatedTokens: 5000,
        hasFeedback: false,
      };

      expect(isTrivialSession(metrics)).toBe(false);
    });

    test('returns false when /feedback is present (bypass gate)', () => {
      const metrics = {
        messageCount: 4,
        estimatedTokens: 1500,
        hasFeedback: true,
      };

      expect(isTrivialSession(metrics)).toBe(false);
    });

    test('returns false for edge case: exactly at threshold', () => {
      const metrics = {
        messageCount: 6,
        estimatedTokens: 2000,
        hasFeedback: false,
      };

      // Should be false because the condition is < not <=
      expect(isTrivialSession(metrics)).toBe(false);
    });
  });

  describe('integration scenarios', () => {
    test('trivial greeting session should skip inference hooks', () => {
      const transcript = [
        '{"type":"user","message":{"content":"Hello PAI"}}',
        '{"type":"assistant","message":{"content":"Ready"}}',
      ].join('\n');

      writeFileSync(TRANSCRIPT_PATH, transcript);

      const metrics = analyzeTranscript(TRANSCRIPT_PATH);
      const trivial = isTrivialSession(metrics);

      expect(trivial).toBe(true);
      // In actual execution, this means only 4 hooks run instead of 9
    });

    test('debugging session should run all hooks', () => {
      const transcript = [
        '{"type":"user","message":{"content":"Debug this issue"}}',
        '{"type":"assistant","message":{"content":"' + 'x'.repeat(1000) + '"}}',
        '{"type":"user","message":{"content":"Try this fix"}}',
        '{"type":"assistant","message":{"content":"' + 'y'.repeat(1000) + '"}}',
        '{"type":"user","message":{"content":"Run tests"}}',
        '{"type":"assistant","message":{"content":"' + 'z'.repeat(1000) + '"}}',
        '{"type":"user","message":{"content":"Looks good"}}',
        '{"type":"assistant","message":{"content":"Complete"}}',
      ].join('\n');

      writeFileSync(TRANSCRIPT_PATH, transcript);

      const metrics = analyzeTranscript(TRANSCRIPT_PATH);
      const trivial = isTrivialSession(metrics);

      expect(trivial).toBe(false);
      expect(metrics.messageCount).toBeGreaterThanOrEqual(6);
    });

    test('feedback session always runs all hooks', () => {
      const transcript = [
        '{"type":"user","message":{"content":"Hi"}}',
        '{"type":"assistant","message":{"content":"Hello"}}',
        '{"type":"user","message":{"content":"/feedback This hook system is working great"}}',
        '{"type":"assistant","message":{"content":"Thank you for the feedback!"}}',
      ].join('\n');

      writeFileSync(TRANSCRIPT_PATH, transcript);

      const metrics = analyzeTranscript(TRANSCRIPT_PATH);
      const trivial = isTrivialSession(metrics);

      expect(trivial).toBe(false);
      expect(metrics.hasFeedback).toBe(true);
    });
  });

  describe('edge cases', () => {
    test('empty transcript is trivial', () => {
      writeFileSync(TRANSCRIPT_PATH, '');

      const metrics = analyzeTranscript(TRANSCRIPT_PATH);
      const trivial = isTrivialSession(metrics);

      expect(trivial).toBe(true);
      expect(metrics.messageCount).toBe(0);
    });

    test('malformed JSON lines are ignored in count', () => {
      const transcript = [
        '{"type":"user","message":{"content":"Hello"}}',
        'CORRUPTED LINE',
        '{"type":"assistant","message":{"content":"Hi"}}',
        'ANOTHER BAD LINE',
      ].join('\n');

      writeFileSync(TRANSCRIPT_PATH, transcript);

      const metrics = analyzeTranscript(TRANSCRIPT_PATH);

      // Should count all non-empty lines, not just valid JSON
      expect(metrics.messageCount).toBeGreaterThan(0);
    });

    test('very long single message exceeds token threshold', () => {
      const veryLongMessage = 'A'.repeat(10000); // ~2500 tokens
      const transcript = [
        '{"type":"user","message":{"content":"Tell me about everything"}}',
        `{"type":"assistant","message":{"content":"${veryLongMessage}"}}`,
      ].join('\n');

      writeFileSync(TRANSCRIPT_PATH, transcript);

      const metrics = analyzeTranscript(TRANSCRIPT_PATH);
      const trivial = isTrivialSession(metrics);

      expect(metrics.messageCount).toBe(2);
      expect(metrics.estimatedTokens).toBeGreaterThan(2000);
      expect(trivial).toBe(false);
    });
  });
});
