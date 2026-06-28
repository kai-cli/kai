import { createHash, randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { atomicWriteJSON, atomicWriteText } from '../../../hooks/lib/atomic';
import {
  type WorkArtifact,
  type WorkItem,
  validateArtifact,
  validateWorkItem,
} from './schema';

export interface LedgerEvent {
  id: string;
  workItemId: string;
  type: 'work-item-saved' | 'artifact-written' | 'status-changed';
  timestamp: string;
  message: string;
  artifactId?: string;
  metadata?: Record<string, unknown>;
}

export interface LedgerPaths {
  root: string;
  workDir: string;
  workItemPath: string;
  eventsPath: string;
  artifactsDir: string;
}

function safeSegment(value: string): string {
  const segment = value.replace(/[^A-Za-z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!segment || /^\.+$/.test(segment)) return 'item';
  return segment === value ? segment : `${segment}-${hashSegment(value)}`;
}

function hashSegment(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 10);
}

function nowIso(): string {
  return new Date().toISOString();
}

function eventId(type: string): string {
  return `${Date.now()}-${process.pid}-${type}-${randomUUID()}`;
}

function appendJsonLine(path: string, line: string): void {
  const existing = existsSync(path) ? readFileSync(path, 'utf-8') : '';
  const prefix = existing && !existing.endsWith('\n') ? `${existing}\n` : existing;
  atomicWriteText(path, `${prefix}${line}\n`);
}

function isLedgerEvent(value: unknown): value is LedgerEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<LedgerEvent>;
  return (
    typeof event.id === 'string' &&
    typeof event.workItemId === 'string' &&
    typeof event.timestamp === 'string' &&
    typeof event.message === 'string' &&
    (event.type === 'work-item-saved' || event.type === 'artifact-written' || event.type === 'status-changed')
  );
}

export function ledgerPaths(root: string, workItemId: string): LedgerPaths {
  const workDir = join(root, safeSegment(workItemId));
  return {
    root,
    workDir,
    workItemPath: join(workDir, 'work-item.json'),
    eventsPath: join(workDir, 'events.jsonl'),
    artifactsDir: join(workDir, 'artifacts'),
  };
}

export function ensureLedger(root: string, workItemId: string): LedgerPaths {
  const paths = ledgerPaths(root, workItemId);
  mkdirSync(paths.artifactsDir, { recursive: true });
  return paths;
}

export function appendLedgerEvent(root: string, event: Omit<LedgerEvent, 'id' | 'timestamp'>): LedgerEvent {
  const paths = ensureLedger(root, event.workItemId);
  const fullEvent: LedgerEvent = {
    ...event,
    id: eventId(event.type),
    timestamp: nowIso(),
  };
  appendJsonLine(paths.eventsPath, JSON.stringify(fullEvent));
  return fullEvent;
}

export function readLedgerEvents(root: string, workItemId: string): LedgerEvent[] {
  const paths = ledgerPaths(root, workItemId);
  if (!existsSync(paths.eventsPath)) return [];
  const events: LedgerEvent[] = [];
  for (const line of readFileSync(paths.eventsPath, 'utf-8').split('\n').filter(Boolean)) {
    try {
      const parsed = JSON.parse(line);
      if (isLedgerEvent(parsed)) events.push(parsed);
    } catch {
      // Preserve readable history even if one JSONL line is corrupt.
    }
  }
  return events;
}

export function saveWorkItem(root: string, workItem: WorkItem): WorkItem {
  const validation = validateWorkItem(workItem);
  if (!validation.value) {
    throw new Error(`Invalid work item: ${validation.errors.join('; ')}`);
  }
  const paths = ensureLedger(root, workItem.id);
  atomicWriteJSON(paths.workItemPath, validation.value);
  appendLedgerEvent(root, {
    workItemId: workItem.id,
    type: 'work-item-saved',
    message: `Saved work item ${workItem.id}`,
    metadata: { status: workItem.status, type: workItem.type },
  });
  return validation.value;
}

export function loadWorkItem(root: string, workItemId: string): WorkItem | null {
  const paths = ledgerPaths(root, workItemId);
  if (!existsSync(paths.workItemPath)) return null;
  const parsed = JSON.parse(readFileSync(paths.workItemPath, 'utf-8'));
  const validation = validateWorkItem(parsed);
  if (!validation.value) {
    throw new Error(`Stored work item is invalid: ${validation.errors.join('; ')}`);
  }
  return validation.value;
}

export function writeArtifact(root: string, workItemId: string, artifact: WorkArtifact): WorkArtifact {
  const validation = validateArtifact(artifact);
  if (!validation.value) {
    throw new Error(`Invalid artifact: ${validation.errors.join('; ')}`);
  }
  const paths = ensureLedger(root, workItemId);
  const artifactPath = join(paths.artifactsDir, `${safeSegment(artifact.id)}.json`);
  const artifactWithPath: WorkArtifact = {
    ...validation.value,
    createdAt: validation.value.createdAt ?? nowIso(),
    path: validation.value.path ?? relative(paths.workDir, artifactPath),
  };
  atomicWriteJSON(artifactPath, artifactWithPath);
  appendLedgerEvent(root, {
    workItemId,
    type: 'artifact-written',
    message: `Wrote artifact ${artifact.id}`,
    artifactId: artifact.id,
    metadata: { artifactType: artifact.type, source: artifact.source },
  });
  return artifactWithPath;
}

export function readArtifact(root: string, workItemId: string, artifactId: string): WorkArtifact | null {
  const paths = ledgerPaths(root, workItemId);
  const artifactPath = join(paths.artifactsDir, `${safeSegment(artifactId)}.json`);
  if (!existsSync(artifactPath)) return null;
  const parsed = JSON.parse(readFileSync(artifactPath, 'utf-8'));
  const validation = validateArtifact(parsed);
  if (!validation.value) {
    throw new Error(`Stored artifact is invalid: ${validation.errors.join('; ')}`);
  }
  return validation.value;
}
