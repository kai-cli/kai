import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  analyzeAutoMemoryInbox,
  classifyAutoMemoryContent,
  resolveAutoMemoryInboxPath,
} from '../scripts/auto-memory-inbox-report';

describe('auto-memory-inbox-report', () => {
  test('classifies reusable lesson candidates for memcarry review', () => {
    const result = classifyAutoMemoryContent('WHEN a hook timeout equals its slowest child DO add parent headroom BECAUSE completion telemetry otherwise truncates.');

    expect(result.classification).toBe('global-lesson');
    expect(result.suggestion.route).toBe('memcarry-lesson');
    expect(result.suggestion.requires_confirmation).toBe(true);
  });

  test('classifies project-specific facts for project memory review', () => {
    const result = classifyAutoMemoryContent('Repo path: /Users/example/Projects/Jetson. Build uses the release branch for firmware tests.');

    expect(result.classification).toBe('project-fact');
    expect(result.project).toBe('Jetson');
    expect(result.suggestion.route).toBe('project-memory');
    expect(result.suggestion.target).toBe('projects/Jetson/memory/');
  });

  test('classifies short session notes as non-durable inbox items', () => {
    const result = classifyAutoMemoryContent('TODO: follow up later today.');

    expect(result.classification).toBe('session-note');
    expect(result.suggestion.route).toBe('leave-in-inbox');
  });

  test('analyzes markdown inbox files and skips compatibility MEMORY.md', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pai-auto-memory-inbox-'));
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'MEMORY.md'), 'compat index');
      writeFileSync(join(dir, 'lesson.md'), 'WHEN docs drift DO run the manifest gate BECAUSE generated docs can go stale.');
      writeFileSync(join(dir, 'project.md'), 'project: feed_bbf\nPR base must target dev for this repo.');
      writeFileSync(join(dir, 'note.md'), 'temporary scratch note');

      const report = analyzeAutoMemoryInbox(dir);

      expect(report.total_files).toBe(3);
      expect(report.counts['global-lesson']).toBe(1);
      expect(report.counts['project-fact']).toBe(1);
      expect(report.counts['session-note']).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('resolves explicit inbox paths with HOME expansion', () => {
    const resolved = resolveAutoMemoryInboxPath('~/auto-memory-test');

    expect(resolved).toContain('/auto-memory-test');
    expect(resolved).not.toContain('~');
  });
});
