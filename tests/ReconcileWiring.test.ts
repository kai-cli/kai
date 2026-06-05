import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { reconcile, hookFileFromCommand } from '../scripts/reconcile-wiring';

const REPO = join(import.meta.dir, '..');

describe('reconcile-wiring — command parser', () => {
  test('extracts hook file from run-hook.sh command', () => {
    expect(hookFileFromCommand('${PAI_DIR}/hooks/lib/run-hook.sh MemCapture.hook.ts')).toBe('MemCapture.hook.ts');
  });
  test('extracts hook file from bare-bun command with flags', () => {
    expect(hookFileFromCommand('bun /x/y/InsightExtractor.hook.ts --foo')).toBe('InsightExtractor.hook.ts');
  });
  test('returns null for non-hook commands', () => {
    expect(hookFileFromCommand('echo hello')).toBeNull();
  });
});

describe('reconcile-wiring — against the real repo (current W4 state)', () => {
  test('passes with zero errors on the live config', () => {
    const r = reconcile(REPO, '/nonexistent-wiki'); // skip wiki check deterministically
    expect(r.errors).toEqual([]);
  });
  test('SessionEnd registers exactly one entry in the live config', () => {
    const r = reconcile(REPO, '/nonexistent-wiki');
    expect(r.registeredCounts.SessionEnd).toBe(1);
  });
  test('warns (not errors) when wiki is absent', () => {
    const r = reconcile(REPO, '/nonexistent-wiki');
    expect(r.warnings.some(w => w.includes('skipped wiki count reconciliation'))).toBe(true);
  });
});

describe('reconcile-wiring — synthetic drift detection', () => {
  let TMP: string;
  beforeAll(() => {
    TMP = mkdtempSync(join(tmpdir(), 'recon-'));
    mkdirSync(join(TMP, 'config'), { recursive: true });
    mkdirSync(join(TMP, 'hooks'), { recursive: true });
    // Provide the real hook files the composite fan-out needs, so invariant 3 is satisfiable.
    cpSync(join(REPO, 'hooks'), join(TMP, 'hooks'), { recursive: true });
  });
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  function writeHooks(jsonc: string) {
    writeFileSync(join(TMP, 'config', 'hooks.jsonc'), jsonc);
  }

  test('clean composite-only SessionEnd passes', () => {
    writeHooks(`{ "hooks": { "SessionEnd": [ { "hooks": [
      { "type":"command", "command":"\${PAI_DIR}/hooks/lib/run-hook.sh SessionEndComposite.hook.ts" }
    ] } ] } }`);
    const r = reconcile(TMP, '/nonexistent-wiki');
    expect(r.errors).toEqual([]);
  });

  test('detects a registered hook with no file (the MemCapture-class bug)', () => {
    writeHooks(`{ "hooks": { "SessionEnd": [ { "hooks": [
      { "type":"command", "command":"\${PAI_DIR}/hooks/lib/run-hook.sh SessionEndComposite.hook.ts" },
      { "type":"command", "command":"\${PAI_DIR}/hooks/lib/run-hook.sh PhantomHook.hook.ts" }
    ] } ] } }`);
    const r = reconcile(TMP, '/nonexistent-wiki');
    expect(r.errors.some(e => e.includes('PhantomHook'))).toBe(true);
  });

  test('composite mode: detects composite + leftover individual (double-run hazard)', () => {
    writeHooks(`{ "hooks": { "SessionEnd": [ { "hooks": [
      { "type":"command", "command":"\${PAI_DIR}/hooks/lib/run-hook.sh SessionEndComposite.hook.ts" },
      { "type":"command", "command":"\${PAI_DIR}/hooks/lib/run-hook.sh KnowledgeSync.hook.ts" }
    ] } ] } }`);
    const r = reconcile(TMP, '/nonexistent-wiki');
    expect(r.errors.some(e => e.includes('double-run hazard'))).toBe(true);
  });

  test('individual mode (KAI pre-W4): N individual SessionEnd entries pass when files resolve', () => {
    // SF-16: the guard must be topology-aware — KAI wires individuals, no composite. No error.
    writeHooks(`{ "hooks": { "SessionEnd": [ { "hooks": [
      { "type":"command", "command":"\${PAI_DIR}/hooks/lib/run-hook.sh KnowledgeSync.hook.ts" },
      { "type":"command", "command":"\${PAI_DIR}/hooks/lib/run-hook.sh InsightExtractor.hook.ts" },
      { "type":"command", "command":"\${PAI_DIR}/hooks/lib/run-hook.sh SessionCleanup.hook.ts" }
    ] } ] } }`);
    const r = reconcile(TMP, '/nonexistent-wiki');
    expect(r.errors).toEqual([]);
  });

  test('individual mode: a missing-file entry is still caught (invariant 1)', () => {
    writeHooks(`{ "hooks": { "SessionEnd": [ { "hooks": [
      { "type":"command", "command":"\${PAI_DIR}/hooks/lib/run-hook.sh KnowledgeSync.hook.ts" },
      { "type":"command", "command":"\${PAI_DIR}/hooks/lib/run-hook.sh GhostHook.hook.ts" }
    ] } ] } }`);
    const r = reconcile(TMP, '/nonexistent-wiki');
    expect(r.errors.some(e => e.includes('GhostHook'))).toBe(true);
  });

  test('detects wiki count mismatch (best-effort warning)', () => {
    writeHooks(`{ "hooks": { "SessionEnd": [ { "hooks": [
      { "type":"command", "command":"\${PAI_DIR}/hooks/lib/run-hook.sh SessionEndComposite.hook.ts" }
    ] } ] } }`);
    // Wiki with a wrong SessionEnd count (says 7, reality fan-out = 10).
    const wikiDir = join(TMP, 'wiki');
    mkdirSync(wikiDir, { recursive: true });
    writeFileSync(join(wikiDir, 'overview.md'), '| Event | Hooks | Role |\n|--|--|--|\n| SessionEnd | 7 | x |\n');
    const r = reconcile(TMP, wikiDir);
    expect(r.warnings.some(w => w.includes('SessionEnd') && w.includes('reality=10'))).toBe(true);
  });
});
