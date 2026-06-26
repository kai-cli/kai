/**
 * pai-test-fixtures.ts — shared helpers for tests that need a deterministic PAI tree.
 *
 * Several integration tests build settings from config/*.jsonc. Those code paths expand
 * ${PAI_DIR}/${HOME}, while unrelated tests also mutate process.env in Bun's parallel
 * test runner. These helpers make the dependency explicit and remove assumptions about
 * a developer's personal install files.
 */

import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export function stableTestHome(): string {
  return process.env.HOME || '/tmp';
}

export function pinPaiEnv(paiDir: string, home = stableTestHome()): void {
  process.env.PAI_DIR = paiDir;
  process.env.HOME = home;
}

export interface PaiConfigFixture {
  dir: string;
  cleanup: () => void;
}

export function makePaiConfigFixture(repoRoot: string, localPreferences?: Record<string, unknown>): PaiConfigFixture {
  const dir = mkdtempSync(join(tmpdir(), 'kai-fixture-'));
  cpSync(join(repoRoot, 'config'), join(dir, 'config'), { recursive: true });

  if (localPreferences) {
    writeFileSync(
      join(dir, 'config', 'preferences.local.jsonc'),
      `${JSON.stringify(localPreferences, null, 2)}\n`
    );
  }

  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
