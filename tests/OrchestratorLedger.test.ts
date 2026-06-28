import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  ledgerPaths,
  loadWorkItem,
  readArtifact,
  readLedgerEvents,
  saveWorkItem,
  writeArtifact,
} from '../PAI/Tools/orchestrator/ledger';

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'pai-orchestrator-ledger-'));
}

function fixtureWorkItem(): any {
  return JSON.parse(readFileSync(join(process.cwd(), 'fixtures', 'orchestrator', 'pr-review.json'), 'utf-8'));
}

describe('orchestrator ledger', () => {
  test('saves and loads a valid work item atomically', () => {
    const root = tempRoot();
    try {
      const item = fixtureWorkItem();
      saveWorkItem(root, item);
      const loaded = loadWorkItem(root, item.id);
      expect(loaded?.id).toBe(item.id);
      expect(loaded?.type).toBe('pr-review');
      expect(existsSync(ledgerPaths(root, item.id).workItemPath)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('writes artifacts and appends ledger events', () => {
    const root = tempRoot();
    try {
      const item = fixtureWorkItem();
      saveWorkItem(root, item);
      const artifact = writeArtifact(root, item.id, {
        id: 'packet-1',
        type: 'packet',
        source: 'orchestrator',
        content: 'fixture packet',
      });
      expect(artifact.path).toBe('artifacts/packet-1.json');
      expect(artifact.createdAt).toBeTruthy();
      expect(readArtifact(root, item.id, 'packet-1')?.content).toBe('fixture packet');

      const events = readLedgerEvents(root, item.id);
      expect(events.map((event) => event.type)).toContain('work-item-saved');
      expect(events.map((event) => event.type)).toContain('artifact-written');
      expect(events.some((event) => event.artifactId === 'packet-1')).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('dot-only work item ids cannot escape the ledger root', () => {
    const root = tempRoot();
    try {
      expect(ledgerPaths(root, '..').workDir).toBe(join(root, 'item'));
      expect(ledgerPaths(root, '.').workDir).toBe(join(root, 'item'));
      expect(ledgerPaths(root, '...').workDir).toBe(join(root, 'item'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('sanitized work item ids include a hash when normalization would collide', () => {
    const root = tempRoot();
    try {
      expect(ledgerPaths(root, 'a/b').workDir).not.toBe(ledgerPaths(root, 'a-b').workDir);
      expect(ledgerPaths(root, 'a/b').workDir).toContain('a-b-');
      expect(ledgerPaths(root, 'a-b').workDir).toBe(join(root, 'a-b'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('dot-only artifact ids cannot escape the artifacts directory', () => {
    const root = tempRoot();
    try {
      const item = fixtureWorkItem();
      saveWorkItem(root, item);
      const artifact = writeArtifact(root, item.id, {
        id: '..',
        type: 'packet',
        source: 'orchestrator',
        content: 'safe packet',
      });
      const paths = ledgerPaths(root, item.id);

      expect(artifact.path).toBe('artifacts/item.json');
      expect(existsSync(join(paths.artifactsDir, 'item.json'))).toBe(true);
      expect(existsSync(join(paths.workDir, 'item.json'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('sanitized artifact ids include a hash when normalization would collide', () => {
    const root = tempRoot();
    try {
      const item = fixtureWorkItem();
      saveWorkItem(root, item);
      const slashArtifact = writeArtifact(root, item.id, {
        id: 'a/b',
        type: 'packet',
        source: 'orchestrator',
        content: 'slash',
      });
      const dashArtifact = writeArtifact(root, item.id, {
        id: 'a-b',
        type: 'packet',
        source: 'orchestrator',
        content: 'dash',
      });

      expect(slashArtifact.path).not.toBe(dashArtifact.path);
      expect(slashArtifact.path).toContain('artifacts/a-b-');
      expect(dashArtifact.path).toBe('artifacts/a-b.json');
      expect(readArtifact(root, item.id, 'a/b')?.content).toBe('slash');
      expect(readArtifact(root, item.id, 'a-b')?.content).toBe('dash');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('resume can reload an in-progress work item from persisted state', () => {
    const root = tempRoot();
    try {
      const item = fixtureWorkItem();
      item.status = 'running';
      saveWorkItem(root, item);

      const resumed = loadWorkItem(root, item.id);
      expect(resumed?.status).toBe('running');
      expect(resumed?.roles[0].engine).toBe('claude-local');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('invalid stored work item fails loudly instead of resuming corrupt state', () => {
    const root = tempRoot();
    try {
      const item = fixtureWorkItem();
      saveWorkItem(root, item);
      const paths = ledgerPaths(root, item.id);
      writeFileSync(paths.workItemPath, '{ "id": "" }');
      expect(() => loadWorkItem(root, item.id)).toThrow('Stored work item is invalid');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('ledger event ids are collision-resistant for rapid same-type appends', () => {
    const root = tempRoot();
    try {
      const item = fixtureWorkItem();
      saveWorkItem(root, item);
      writeArtifact(root, item.id, {
        id: 'packet-1',
        type: 'packet',
        source: 'orchestrator',
        content: 'first',
      });
      writeArtifact(root, item.id, {
        id: 'packet-2',
        type: 'packet',
        source: 'orchestrator',
        content: 'second',
      });

      const events = readLedgerEvents(root, item.id);
      expect(new Set(events.map(event => event.id)).size).toBe(events.length);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('corrupt JSONL lines do not prevent reading later valid ledger events', () => {
    const root = tempRoot();
    try {
      const item = fixtureWorkItem();
      saveWorkItem(root, item);
      const paths = ledgerPaths(root, item.id);
      const validEvent = {
        id: 'manual-event',
        workItemId: item.id,
        type: 'status-changed',
        timestamp: '2026-06-27T00:00:00.000Z',
        message: 'Manual event after corruption',
      };
      writeFileSync(paths.eventsPath, `${readFileSync(paths.eventsPath, 'utf-8')}not-json\n${JSON.stringify(validEvent)}\n`);

      const events = readLedgerEvents(root, item.id);
      expect(events.map(event => event.id)).toContain('manual-event');
      expect(events.some(event => event.message === 'Manual event after corruption')).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
