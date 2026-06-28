import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const repo = join(import.meta.dir, '..');

describe('install relocation resilience', () => {
  test('runtime scripts do not pin old ~/Projects checkout locations', () => {
    const files = [
      'scripts/hooks/pre-push',
      'scripts/weekly-maintenance.ts',
      'hooks/handlers/WikiCurrency.ts',
    ];

    for (const file of files) {
      const text = readFileSync(join(repo, file), 'utf8');
      expect(text).not.toContain('Projects/kai');
      expect(text).not.toContain('Projects/kai');
    }
  });

  test('relocation-sensitive paths derive from repo or PAI environment', () => {
    const prePush = readFileSync(join(repo, 'scripts/hooks/pre-push'), 'utf8');
    const weekly = readFileSync(join(repo, 'scripts/weekly-maintenance.ts'), 'utf8');
    const wikiCurrency = readFileSync(join(repo, 'hooks/handlers/WikiCurrency.ts'), 'utf8');

    expect(prePush).toContain('${KAI_PII_PATTERNS:-$REPO_ROOT/scripts/pii-patterns.json}');
    expect(weekly).toContain("process.env.PAI_REPO_DIR ?? PAI_DIR");
    expect(wikiCurrency).toContain('process.env.PAI_REPO_DIR || getPaiDir()');
  });
});
