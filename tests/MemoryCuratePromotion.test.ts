import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const repoRoot = join(import.meta.dir, '..');

function makePaiFixture() {
  const root = mkdtempSync(join(tmpdir(), 'pai-curate-promotion-'));
  const paiDir = join(root, 'pai');
  const home = join(root, 'home');
  const insightsDir = join(paiDir, 'MEMORY', 'LEARNING', 'INSIGHTS');
  const stagingDir = join(paiDir, 'MEMORY', 'STAGING');
  const kaiMemory = join(paiDir, 'projects', 'kai', 'memory');
  mkdirSync(insightsDir, { recursive: true });
  mkdirSync(stagingDir, { recursive: true });
  mkdirSync(kaiMemory, { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(kaiMemory, 'MEMORY.md'), '# KAI Memory\n');
  return { root, paiDir, home, insightsDir, stagingDir, kaiMemory };
}

function writeInsight(insightsDir: string, filename: string, title: string) {
  writeFileSync(join(insightsDir, filename), `---
title: "${title}"
category: testing
confidence: high
captured: 2026-06-26T12:00:00.000Z
session_id: test-session
status: candidate
---

${title} should become durable project memory.
`);
}

function runCurate(args: string[], paiDir: string, home: string): string {
  return execFileSync('bun', ['PAI/Tools/MemoryCurate.ts', ...args], {
    cwd: repoRoot,
    env: { ...process.env, PAI_DIR: paiDir, HOME: home },
    encoding: 'utf8',
  });
}

function writeDraft(stagingDir: string, filename: string, title: string, body: string) {
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 7 * 86_400_000).toISOString();
  writeFileSync(join(stagingDir, filename), `---
type: draft-memory
source_type: success-pattern
source_session: test-session
source_rating: 9
confidence: 0.9
generated: ${now}
expires: ${expires}
target_project: kai
target_filename: feedback_success_pattern.md
title: "${title}"
---

${body}
`);
  writeFileSync(join(stagingDir, '.staging-state.json'), JSON.stringify({
    created: now.slice(0, 10),
    expiryDays: 14,
    drafts: [{ filename, generated: now, expires, type: 'success-pattern' }],
    stats: { totalGenerated: 1, totalApproved: 0, totalRejected: 0, totalExpired: 0 },
  }, null, 2));
}

describe('MemoryCurate insight promotion', () => {
  test('promote --from-manifest drains multiple candidate insights in one process', () => {
    const fixture = makePaiFixture();
    writeInsight(fixture.insightsDir, 'one.md', 'First lesson');
    writeInsight(fixture.insightsDir, 'two.md', 'Second lesson');
    const manifest = join(fixture.root, 'promote.tsv');
    writeFileSync(manifest, 'one.md\tkai\ntwo.md\tkai\n');

    const output = runCurate(['promote', '--from-manifest', manifest], fixture.paiDir, fixture.home);

    expect(output).toContain('Promoted 2 insight(s)');
    const promoted = readFileSync(join(fixture.kaiMemory, 'insights_promoted.md'), 'utf-8');
    expect(promoted).toContain('## First lesson');
    expect(promoted).toContain('## Second lesson');
    expect(readFileSync(join(fixture.insightsDir, 'one.md'), 'utf-8')).toContain('status: promoted');
    expect(readFileSync(join(fixture.kaiMemory, 'MEMORY.md'), 'utf-8')).toContain('[Promoted Insights](insights_promoted.md)');
  });

  test('promote --all promotes every pending candidate to the requested project', () => {
    const fixture = makePaiFixture();
    writeInsight(fixture.insightsDir, 'all-one.md', 'All first lesson');
    writeInsight(fixture.insightsDir, 'all-two.md', 'All second lesson');
    writeFileSync(join(fixture.insightsDir, 'already.md'), `---
title: "Already promoted"
status: promoted
---

skip me
`);

    const output = runCurate(['promote', '--all', 'kai'], fixture.paiDir, fixture.home);

    expect(output).toContain('Promoted 2 insight(s)');
    const promoted = readFileSync(join(fixture.kaiMemory, 'insights_promoted.md'), 'utf-8');
    expect(promoted).toContain('## All first lesson');
    expect(promoted).toContain('## All second lesson');
    expect(promoted).not.toContain('Already promoted');
    expect(existsSync(join(fixture.kaiMemory, 'MEMORY.md'))).toBe(true);
  });
});

describe('MemoryCurate draft approval', () => {
  test('approve appends to an existing fixed-name memory file instead of overwriting', () => {
    const fixture = makePaiFixture();
    const target = join(fixture.kaiMemory, 'feedback_success_pattern.md');
    writeFileSync(target, `---
type: feedback
description: Existing hand-edited feedback
source: manual
---

Existing durable lesson.
`);

    writeDraft(fixture.stagingDir, 'first.md', 'First approved lesson', 'First generated lesson.');
    runCurate(['approve', '1'], fixture.paiDir, fixture.home);
    writeDraft(fixture.stagingDir, 'second.md', 'Second approved lesson', 'Second generated lesson.');
    runCurate(['approve', '1'], fixture.paiDir, fixture.home);

    const approved = readFileSync(target, 'utf-8');
    expect(approved).toContain('Existing durable lesson.');
    expect(approved).toContain('## First approved lesson');
    expect(approved).toContain('First generated lesson.');
    expect(approved).toContain('## Second approved lesson');
    expect(approved).toContain('Second generated lesson.');
  });
});
