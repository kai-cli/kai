import { describe, test, expect } from 'bun:test';
import { selectHarness } from '../agents/harnesses/router';

describe('HarnessRouter', () => {
  describe('Routing signals', () => {
    test('no signals → default claude harness', () => {
      const config = selectHarness({});
      expect(config.harness).toBe('claude');
    });

    test('empty call (no argument) → default claude harness', () => {
      const config = selectHarness();
      expect(config.harness).toBe('claude');
    });

    test('{ hasImages: true } → gemini harness', () => {
      const config = selectHarness({ hasImages: true });
      expect(config.harness).toBe('gemini');
    });

    test('{ privacyLevel: "sensitive" } → local harness', () => {
      const config = selectHarness({ privacyLevel: 'sensitive' });
      expect(config.harness).toBe('local');
    });

    test('{ privacyLevel: "public" } → default claude harness', () => {
      const config = selectHarness({ privacyLevel: 'public' });
      expect(config.harness).toBe('claude');
    });

    test('{ taskType: "code-gen" } → codex harness', () => {
      const config = selectHarness({ taskType: 'code-gen' });
      expect(config.harness).toBe('codex');
    });

    test('{ preferredHarness: "gemini" } → gemini (explicit preference wins)', () => {
      const config = selectHarness({ preferredHarness: 'gemini' });
      expect(config.harness).toBe('gemini');
    });

    test('explicit preference overrides privacy constraint', () => {
      const config = selectHarness({
        preferredHarness: 'codex',
        privacyLevel: 'sensitive',
      });
      expect(config.harness).toBe('codex');
    });

    test('explicit preference overrides image signal', () => {
      const config = selectHarness({
        preferredHarness: 'claude',
        hasImages: true,
      });
      expect(config.harness).toBe('claude');
    });
  });

  describe('OrchestrationConfig shape', () => {
    test('result has harness, executionMode fields', () => {
      const config = selectHarness({});
      expect(typeof config.harness).toBe('string');
      expect(['local', 'remote']).toContain(config.executionMode);
    });

    test('local harness has executionMode=local', () => {
      const config = selectHarness({ privacyLevel: 'sensitive' });
      expect(config.executionMode).toBe('local');
    });

    test('claude harness has executionMode=remote', () => {
      const config = selectHarness({});
      expect(config.executionMode).toBe('remote');
    });
  });

  describe('Harness interface', () => {
    test('Harness interface has no costTier field (per v6.0 spec)', () => {
      // Verify via the type system — costTier must not exist in OrchestrationConfig
      const config = selectHarness({});
      expect((config as any).costTier).toBeUndefined();
    });
  });
});
