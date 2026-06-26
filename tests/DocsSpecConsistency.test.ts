import { describe, expect, test } from 'bun:test';
import {
  checkRoadmapVersionSequence,
  checkShippedPrReferences,
  checkStaleTaskTerminology,
  prNumbersFromText,
} from '../scripts/docs-spec-consistency';

describe('docs-spec-consistency', () => {
  test('extracts PR numbers from git-style subjects', () => {
    const prs = prNumbersFromText([
      '7.4.2 — CI safety gates (#19)',
      'Merge pull request #17 from branch',
      'docs without a PR number',
    ].join('\n'));

    expect(prs.has(19)).toBe(true);
    expect(prs.has(17)).toBe(true);
    expect(prs.has(18)).toBe(false);
  });

  test('flags shipped PR references missing from main history', () => {
    const findings = checkShippedPrReferences({
      'docs/planning/example.md': [
        '- [x] **Feature** ✅ shipped in PR #10',
        '- [x] **Other** ✅ shipped in PR #999',
        '- [ ] pending in PR #888',
        '- [x] Close PR #8 + delete poisoned branch — DONE.',
      ].join('\n'),
    }, new Set([10]));

    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('PR #999');
  });

  test('flags stale active Task terminology but allows retired/legacy discussion', () => {
    const findings = checkStaleTaskTerminology({
      'docs/planning/example.md': [
        '- Promote to full **PostToolUse `Task`-matcher** agent-harvesting path.',
        '- The retired `Task` tool is now `Agent`.',
        '- Do not reintroduce Task matchers.',
      ].join('\n'),
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(1);
  });

  test('validates 7.4.1 → 7.4.2 → 7.5.x roadmap order', () => {
    const ok = checkRoadmapVersionSequence([
      '## 7.4.1 (TARGETED)',
      '## 7.4.2 (TARGETED)',
      '## 7.5.0 (TARGETED)',
      '## 7.5.1 (TARGETED)',
      '## 7.5.2 (TARGETED)',
    ].join('\n'));

    expect(ok).toHaveLength(0);

    const bad = checkRoadmapVersionSequence([
      '## 7.4.2 (TARGETED)',
      '## 7.4.1 (TARGETED)',
      '## 7.5.0 (TARGETED)',
      '## 7.5.1 (TARGETED)',
      '## 7.5.2 (TARGETED)',
    ].join('\n'));

    expect(bad.length).toBeGreaterThan(0);
  });
});
