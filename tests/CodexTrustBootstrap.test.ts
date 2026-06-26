import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  addTrustedProjectEntry,
  bootstrapCodexTrust,
  detectGitRoot,
  hasTrustedProject,
} from '../scripts/codex-trust-bootstrap';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'codex-trust-'));
}

describe('codex-trust-bootstrap', () => {
  test('adds a trusted project table without changing approval policy', () => {
    const content = 'approval_policy = "on-request"\nsandbox_mode = "workspace-write"\n';
    const project = '/tmp/example repo';
    const result = addTrustedProjectEntry(content, project);

    expect(result.changed).toBe(true);
    expect(result.content).toContain('approval_policy = "on-request"');
    expect(result.content).toContain('[projects."/tmp/example repo"]');
    expect(result.content).toContain('trust_level = "trusted"');
    expect(result.content).not.toContain('approval_policy = "never"');
  });

  test('does not duplicate existing trusted project entries', () => {
    const project = '/tmp/example';
    const content = `[projects.${JSON.stringify(project)}]\ntrust_level = "trusted"\n`;

    expect(hasTrustedProject(content, project)).toBe(true);
    const result = addTrustedProjectEntry(content, project);
    expect(result.changed).toBe(false);
    expect(result.content).toBe(content);
  });

  test('upgrades an existing untrusted project table in place without duplicating the header', () => {
    const project = '/tmp/repo';
    const header = `[projects.${JSON.stringify(project)}]`;
    const content = `${header}\ntrust_level = "untrusted"\n`;

    const result = addTrustedProjectEntry(content, project);

    expect(result.changed).toBe(true);
    expect(result.content.split(header).length - 1).toBe(1);
    expect(result.content).toContain('trust_level = "trusted"');
    expect(result.content).not.toContain('trust_level = "untrusted"');
  });

  test('detects trusted project entries with compact spacing and comments', () => {
    const project = '/tmp/repo';
    const content = `[projects.${JSON.stringify(project)}]\n# local trust\ntrust_level="trusted" # approved\n`;

    expect(hasTrustedProject(content, project)).toBe(true);
    const result = addTrustedProjectEntry(content, project);
    expect(result.changed).toBe(false);
  });

  test('adds trust_level to an existing project table that has no trust setting', () => {
    const project = '/tmp/repo';
    const other = '/tmp/other';
    const content = `[projects.${JSON.stringify(project)}]\nnotes = "seen before"\n\n[projects.${JSON.stringify(other)}]\ntrust_level = "trusted"\n`;

    const result = addTrustedProjectEntry(content, project);

    expect(result.changed).toBe(true);
    expect(result.content).toContain(`[projects.${JSON.stringify(project)}]\nnotes = "seen before"\ntrust_level = "trusted"\n\n[projects.${JSON.stringify(other)}]`);
  });

  test('dry-run returns changed content without writing the config file', () => {
    const dir = tempDir();
    try {
      const config = join(dir, 'config.toml');
      writeFileSync(config, 'approval_policy = "on-request"\n');

      const result = bootstrapCodexTrust({
        configPath: config,
        projectPath: join(dir, 'repo'),
        dryRun: true,
      });

      expect(result.changed).toBe(true);
      expect(result.content).toContain('trust_level = "trusted"');
      expect(readFileSync(config, 'utf8')).toBe('approval_policy = "on-request"\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('writes a trusted project entry to the supplied config file', () => {
    const dir = tempDir();
    try {
      const config = join(dir, 'codex', 'config.toml');
      const project = join(dir, 'repo');
      const result = bootstrapCodexTrust({ configPath: config, projectPath: project });

      expect(result.changed).toBe(true);
      expect(readFileSync(config, 'utf8')).toContain(`[projects.${JSON.stringify(project)}]`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('defaults to the current git root when no project is supplied', () => {
    const dir = tempDir();
    try {
      spawnSync('git', ['init', '-q'], { cwd: dir });
      mkdirSync(join(dir, 'nested'), { recursive: true });

      expect(detectGitRoot(join(dir, 'nested'))).toBe(realpathSync(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
