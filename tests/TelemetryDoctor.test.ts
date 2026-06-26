import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, cpSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTelemetryDoctor } from '../scripts/telemetry-doctor';
import { buildSettings } from '../hooks/handlers/BuildSettings';

const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

function copyFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'telemetry-doctor-'));
  for (const path of ['config', 'hooks', 'PAI']) {
    cpSync(join(REPO, path), join(root, path), { recursive: true });
  }
  const oldPaiDir = process.env.PAI_DIR;
  try {
    process.env.PAI_DIR = root;
    writeFileSync(join(root, 'settings.json'), JSON.stringify(buildSettings(root), null, 2));
  } finally {
    if (oldPaiDir === undefined) delete process.env.PAI_DIR;
    else process.env.PAI_DIR = oldPaiDir;
  }
  return root;
}

describe('telemetry doctor', () => {
  test('passes current source and generated hook wiring', () => {
    const root = copyFixture();
    try {
      const result = runTelemetryDoctor(root);
      expect(result.errors).toEqual([]);
      expect(result.ok).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('catches missing live TurnTelemetry registration', () => {
    const root = copyFixture();
    try {
      const settingsPath = join(root, 'settings.json');
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
      const groups = settings.hooks.UserPromptSubmit as Array<{ hooks: Array<{ command: string }> }>;
      for (const group of groups) {
        group.hooks = group.hooks.filter(h => !h.command.includes('TurnTelemetry.hook.ts'));
      }
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

      const result = runTelemetryDoctor(root);
      expect(result.ok).toBe(false);
      expect(result.errors.some(e => e.includes('settings.json') && e.includes('TurnTelemetry.hook.ts'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
