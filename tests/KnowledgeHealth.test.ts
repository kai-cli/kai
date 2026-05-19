import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `knowledge-health-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(testDir, 'MEMORY', 'STATE'), { recursive: true });
  mkdirSync(join(testDir, 'MEMORY', 'KNOWLEDGE'), { recursive: true });
  process.env.PAI_DIR = testDir;
});

afterEach(() => {
  delete process.env.PAI_DIR;
  try { rmSync(testDir, { recursive: true, force: true }); } catch {}
});

function writeReadsLog(entries: Array<{ timestamp: string; domains_injected: string[] }>): void {
  const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(join(testDir, 'MEMORY', 'STATE', 'memory-reads.jsonl'), content);
}

function writeKnowledgeFile(domain: string): void {
  const content = `---\ndomain: ${domain}\nupdated: 2026-05-01\ntags: [test]\nrelated: []\n---\nBody content.\n`;
  writeFileSync(join(testDir, 'MEMORY', 'KNOWLEDGE', `${domain}.md`), content);
}

async function health() {
  return await import('../PAI/Tools/KnowledgeHealth');
}

describe('KnowledgeHealth', () => {
  describe('analyzeHealth', () => {
    it('returns empty report when no telemetry file exists', async () => {
      const { analyzeHealth } = await health();
      writeKnowledgeFile('test-domain');
      const report = analyzeHealth();
      expect(report.totalReads).toBe(0);
      expect(report.domains.length).toBeGreaterThanOrEqual(0);
    });

    it('returns empty report when reads file is empty', async () => {
      const { analyzeHealth } = await health();
      writeFileSync(join(testDir, 'MEMORY', 'STATE', 'memory-reads.jsonl'), '');
      const report = analyzeHealth();
      expect(report.totalReads).toBe(0);
    });

    it('counts references per domain', async () => {
      const { analyzeHealth } = await health();
      writeKnowledgeFile('firmware');
      writeKnowledgeFile('devops');
      writeReadsLog([
        { timestamp: new Date().toISOString(), domains_injected: ['firmware'] },
        { timestamp: new Date().toISOString(), domains_injected: ['firmware'] },
        { timestamp: new Date().toISOString(), domains_injected: ['devops'] },
      ]);
      const report = analyzeHealth();
      expect(report.totalReads).toBe(3);
      const fw = report.domains.find(d => d.domain === 'firmware');
      const dv = report.domains.find(d => d.domain === 'devops');
      expect(fw?.countTotal).toBe(2);
      expect(dv?.countTotal).toBe(1);
    });

    it('marks recently referenced domains as ACTIVE', async () => {
      const { analyzeHealth } = await health();
      writeKnowledgeFile('firmware');
      writeReadsLog([
        { timestamp: new Date().toISOString(), domains_injected: ['firmware'] },
      ]);
      const report = analyzeHealth();
      const fw = report.domains.find(d => d.domain === 'firmware');
      expect(fw?.status).toBe('ACTIVE');
    });

    it('marks domains unreferenced for >90 days as DORMANT', async () => {
      const { analyzeHealth } = await health();
      writeKnowledgeFile('old-domain');
      const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
      writeReadsLog([
        { timestamp: oldDate, domains_injected: ['old-domain'] },
      ]);
      const report = analyzeHealth();
      const old = report.domains.find(d => d.domain === 'old-domain');
      expect(old?.status).toBe('DORMANT');
    });

    it('marks domains referenced 30-90 days ago as IDLE', async () => {
      const { analyzeHealth } = await health();
      writeKnowledgeFile('idle-domain');
      const idleDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      writeReadsLog([
        { timestamp: idleDate, domains_injected: ['idle-domain'] },
      ]);
      const report = analyzeHealth();
      const idle = report.domains.find(d => d.domain === 'idle-domain');
      expect(idle?.status).toBe('IDLE');
    });

    it('marks never-referenced domains as NEVER', async () => {
      const { analyzeHealth } = await health();
      writeKnowledgeFile('lonely');
      writeReadsLog([
        { timestamp: new Date().toISOString(), domains_injected: ['other'] },
      ]);
      const report = analyzeHealth();
      const lonely = report.domains.find(d => d.domain === 'lonely');
      expect(lonely?.status).toBe('NEVER');
    });

    it('computes 30d and 90d window counts separately', async () => {
      const { analyzeHealth } = await health();
      writeKnowledgeFile('firmware');
      const now = new Date();
      const fiftyDaysAgo = new Date(now.getTime() - 50 * 24 * 60 * 60 * 1000);
      const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
      writeReadsLog([
        { timestamp: fiftyDaysAgo.toISOString(), domains_injected: ['firmware'] },
        { timestamp: tenDaysAgo.toISOString(), domains_injected: ['firmware'] },
        { timestamp: now.toISOString(), domains_injected: ['firmware'] },
      ]);
      const report = analyzeHealth();
      const fw = report.domains.find(d => d.domain === 'firmware');
      expect(fw?.count30d).toBe(2);
      expect(fw?.count90d).toBe(3);
      expect(fw?.countTotal).toBe(3);
    });

    it('handles malformed lines in telemetry gracefully', async () => {
      const { analyzeHealth } = await health();
      writeKnowledgeFile('test');
      const content = '{"bad json\n{"timestamp":"2026-05-01T00:00:00Z","domains_injected":["test"]}\nnot json at all\n';
      writeFileSync(join(testDir, 'MEMORY', 'STATE', 'memory-reads.jsonl'), content);
      const report = analyzeHealth();
      expect(report.totalReads).toBe(1);
    });

    it('sorts domains by total count descending', async () => {
      const { analyzeHealth } = await health();
      writeKnowledgeFile('low');
      writeKnowledgeFile('high');
      writeReadsLog([
        { timestamp: new Date().toISOString(), domains_injected: ['high'] },
        { timestamp: new Date().toISOString(), domains_injected: ['high'] },
        { timestamp: new Date().toISOString(), domains_injected: ['high'] },
        { timestamp: new Date().toISOString(), domains_injected: ['low'] },
      ]);
      const report = analyzeHealth();
      expect(report.domains[0].domain).toBe('high');
    });

    it('calculates telemetry span in days', async () => {
      const { analyzeHealth } = await health();
      writeKnowledgeFile('x');
      const day1 = '2026-04-01T00:00:00Z';
      const day10 = '2026-04-10T00:00:00Z';
      writeReadsLog([
        { timestamp: day1, domains_injected: ['x'] },
        { timestamp: day10, domains_injected: ['x'] },
      ]);
      const report = analyzeHealth();
      expect(report.telemetrySpanDays).toBe(9);
    });
  });

  describe('performance', () => {
    it('handles 10,000 telemetry lines in under 1 second', async () => {
      const { analyzeHealth } = await health();
      writeKnowledgeFile('perf-domain');
      const entries = [];
      for (let i = 0; i < 10000; i++) {
        const ts = new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000).toISOString();
        entries.push({ timestamp: ts, domains_injected: ['perf-domain'] });
      }
      writeReadsLog(entries);

      const start = performance.now();
      const report = analyzeHealth();
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(1000);
      expect(report.totalReads).toBe(10000);
    });
  });

  describe('formatHealthReport', () => {
    it('includes table headers', async () => {
      const { analyzeHealth, formatHealthReport } = await health();
      writeKnowledgeFile('test');
      const report = analyzeHealth();
      const formatted = formatHealthReport(report);
      expect(formatted).toContain('Domain');
      expect(formatted).toContain('Last Referenced');
      expect(formatted).toContain('Status');
    });

    it('shows dormant warning when domains are dormant', async () => {
      const { formatHealthReport } = await health();
      const report = {
        domains: [{ domain: 'old', lastReferenced: null, count30d: 0, count90d: 0, countTotal: 0, status: 'NEVER' as const }],
        totalReads: 0,
        telemetrySpanDays: 0,
        generatedAt: new Date().toISOString(),
      };
      const formatted = formatHealthReport(report);
      expect(formatted).toContain('dormant/never referenced');
    });
  });
});
