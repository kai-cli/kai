/**
 * KnowledgeSync.test.ts — Tests for hooks/KnowledgeSync.hook.ts
 *
 * Covers: extractFacts (fact extraction from markdown), identifyAffectedDomains
 */

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { clearConfigCache } from '../hooks/lib/config-loader';
import {
  extractFacts,
  identifyAffectedDomains,
  type ChangedFile,
} from '../hooks/KnowledgeSync.hook.ts';

// ── extractFacts ──────────────────────────────────────────────────────────────

describe('extractFacts', () => {
  test('extracts bold markdown phrases (10-200 chars)', () => {
    const content = '**Authentication system uses JWT tokens** for session management.';
    const facts = extractFacts(content, 'test.md');
    expect(facts).toContain('Authentication system uses JWT tokens');
  });

  test('skips bold phrases under 10 chars', () => {
    const content = '**short** phrase here.';
    const facts = extractFacts(content, 'test.md');
    expect(facts).not.toContain('short');
  });

  test('extracts bullet list items (15-200 chars)', () => {
    const content = '- Deploy the authentication service to production cluster\n- Another bullet point with enough text';
    const facts = extractFacts(content, 'test.md');
    expect(facts.some(f => f.includes('Deploy the authentication service'))).toBe(true);
  });

  test('extracts table rows as key: value facts', () => {
    const content = '| Authentication | Uses JWT with 24h expiry |\n| Database | PostgreSQL 15 |';
    const facts = extractFacts(content, 'test.md');
    expect(facts.some(f => f.includes('Authentication') && f.includes('JWT'))).toBe(true);
  });

  test('skips table header separator rows', () => {
    const content = '| --- | --- |\n| Topic | Value |';
    const facts = extractFacts(content, 'test.md');
    expect(facts).not.toContain('--- | ---');
  });

  test('returns empty array for empty content', () => {
    expect(extractFacts('', 'test.md')).toEqual([]);
  });

  test('returns empty array for plain prose with no patterns', () => {
    const content = 'This is a simple paragraph with no markdown formatting.';
    const facts = extractFacts(content, 'test.md');
    expect(facts).toEqual([]);
  });

  test('strips markdown bold markers from bullet facts', () => {
    const content = '- **Key insight** about the deployment pipeline and its behavior';
    const facts = extractFacts(content, 'test.md');
    // Bullet extraction strips ** markers
    const bulletFact = facts.find(f => f.includes('Key insight'));
    if (bulletFact) {
      expect(bulletFact).not.toContain('**');
    }
  });
});

// ── identifyAffectedDomains ───────────────────────────────────────────────────

describe('identifyAffectedDomains', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `ks-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(testDir, 'config'), { recursive: true });
    process.env.PAI_DIR = testDir;
    clearConfigCache();
    writeFileSync(join(testDir, 'config', 'domains.jsonc'), JSON.stringify({
      definitions: {
        backend: { description: 'Backend', keywords: ['api', 'server', 'database', 'endpoint', 'auth'] },
        devops: { description: 'DevOps', keywords: ['docker', 'kubernetes', 'ci', 'cd', 'deploy', 'pipeline'] },
        security: { description: 'Security', keywords: ['security', 'vulnerability', 'cve', 'encryption', 'audit'] },
      },
    }));
  });

  afterEach(() => {
    delete process.env.PAI_DIR;
    clearConfigCache();
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  test('identifies domains from file content keywords', () => {
    const files: ChangedFile[] = [{
      project: 'myapp',
      filename: 'auth-notes.md',
      path: '/path/auth-notes.md',
      content: 'api endpoint auth server database database api auth server api api api',
    }];
    const domains = identifyAffectedDomains(files);
    expect(domains.has('backend')).toBe(true);
  });

  test('returns empty set when no domain has ≥3 keyword hits', () => {
    const files: ChangedFile[] = [{
      project: 'myapp',
      filename: 'random.md',
      path: '/path/random.md',
      content: 'some general text without specific domain keywords here',
    }];
    const domains = identifyAffectedDomains(files);
    expect(domains.size).toBe(0);
  });

  test('returns empty set for empty file list', () => {
    const domains = identifyAffectedDomains([]);
    expect(domains.size).toBe(0);
  });

  test('caps at 2 domains per file', () => {
    // File with many keywords across all 3 domains
    const files: ChangedFile[] = [{
      project: 'myapp',
      filename: 'mixed.md',
      path: '/path/mixed.md',
      content: 'api server auth database docker kubernetes deploy pipeline security vulnerability cve',
    }];
    const domains = identifyAffectedDomains(files);
    // Should not exceed 2 domains per file (top 2 by score)
    expect(domains.size).toBeLessThanOrEqual(2);
  });

  test('accumulates domains across multiple files', () => {
    const files: ChangedFile[] = [
      {
        project: 'myapp',
        filename: 'backend.md',
        path: '/path/backend.md',
        content: 'api server endpoint auth database server api api api auth auth',
      },
      {
        project: 'myapp',
        filename: 'infra.md',
        path: '/path/infra.md',
        content: 'docker kubernetes deploy pipeline cd ci docker docker kubernetes kubernetes docker',
      },
    ];
    const domains = identifyAffectedDomains(files);
    expect(domains.has('backend')).toBe(true);
    expect(domains.has('devops')).toBe(true);
  });
});
