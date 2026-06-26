#!/usr/bin/env bun
/**
 * prompt-latency-report.ts — read-only Claude turn latency reconstruction.
 *
 * Parses raw Claude JSONL transcripts and separates the observable parts of a turn:
 * user timestamp, queue operations, first assistant output, hook duration totals,
 * tool duration totals, and total turn duration when Claude records it.
 *
 * This deliberately does NOT run as a hook. It is an offline diagnostic so it adds
 * no latency to the prompt path.
 *
 * Usage:
 *   bun scripts/prompt-latency-report.ts --path ~/.claude/projects --limit 20
 *   bun scripts/prompt-latency-report.ts --summary --limit 500
 *   bun scripts/prompt-latency-report.ts --path /path/session.jsonl --json
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { readTelemetry, type MemoryTelemetryEvent } from '../hooks/lib/memory-telemetry';

export interface TranscriptEvent {
  ts?: number;
  type?: string;
  raw: Record<string, unknown>;
}

export interface AssistantSummary {
  model?: string;
  stop_reason?: string;
  content_types: string[];
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  output_tokens?: number;
  service_tier?: string;
  speed?: string;
}

export interface TurnLatency {
  file: string;
  user_ts: number;
  prompt_source: 'user' | 'queued_command';
  hook_telemetry_expected: boolean;
  hook_telemetry_note?: string;
  prompt_preview: string;
  transcript_chars_before_first_assistant: number;
  queue_enqueue_ts?: number;
  queue_dequeue_ts?: number;
  first_assistant_ts?: number;
  first_assistant?: AssistantSummary;
  pre_response_ms?: number;
  queue_wait_ms?: number;
  pre_response_hook_duration_ms: number;
  pre_response_hook_count: number;
  pre_response_slowest_hook?: { name: string; ms: number };
  first_pre_response_hook_ts?: number;
  last_pre_response_hook_ts?: number;
  after_last_pre_response_hook_ms?: number;
  hook_duration_ms: number;
  hook_count: number;
  slowest_hook?: { name: string; ms: number };
  tool_duration_ms: number;
  tool_count: number;
  turn_duration_ms?: number;
  agent_returns_since_last_prompt: AgentReturnPressure;
}

export interface AgentReturnPressure {
  count: number;
  checkpoints: number;
  total_chars: number;
  max_chars: number;
  largest?: { ts: string; project: string; agent_type: string; description: string; result_chars: number };
}

function usage(): never {
  console.error('Usage: bun scripts/prompt-latency-report.ts [--path <file-or-dir>] [--limit N|--recent N] [--summary] [--trace-slowest N] [--json]');
  process.exit(1);
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function parseTime(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 10_000_000_000 ? value : value * 1000;
  if (typeof value === 'string') {
    const asNum = Number(value);
    if (Number.isFinite(asNum)) return asNum > 10_000_000_000 ? asNum : asNum * 1000;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function eventTime(raw: Record<string, unknown>): number | undefined {
  return parseTime(raw.timestamp)
    ?? parseTime(raw.created_at)
    ?? parseTime(raw.createdAt)
    ?? parseTime(raw.ts)
    ?? parseTime(raw.time)
    ?? parseTime((raw.attachment as Record<string, unknown> | undefined)?.timestamp);
}

function nestedString(raw: Record<string, unknown>, path: string[]): string | undefined {
  let cur: unknown = raw;
  for (const key of path) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === 'string' ? cur : undefined;
}

function eventText(raw: Record<string, unknown>): string {
  const direct = typeof raw.text === 'string' ? raw.text : undefined;
  const rawContent = typeof raw.content === 'string' ? raw.content : undefined;
  const content = nestedString(raw, ['message', 'content']);
  const messageTextContent = textFromMessageContent(asRecord(raw.message)?.content);
  const display = typeof raw.display === 'string' ? raw.display : undefined;
  const attachmentPrompt = nestedString(raw, ['attachment', 'prompt']);
  const candidate = direct ?? rawContent ?? content ?? messageTextContent ?? display ?? attachmentPrompt ?? '';
  return candidate.replace(/\s+/g, ' ').trim();
}

function textFromMessageContent(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map(item => stringValue(asRecord(item)?.text) ?? stringValue(asRecord(item)?.content))
    .filter(Boolean)
    .join(' ');
  return text || undefined;
}

function eventChars(e: TranscriptEvent): number {
  try {
    return JSON.stringify(e.raw).length;
  } catch {
    return 0;
  }
}

function eventType(raw: Record<string, unknown>): string {
  return String(raw.type ?? raw.event ?? raw.event_type ?? raw.kind ?? nestedString(raw, ['attachment', 'type']) ?? '');
}

function durationMs(raw: Record<string, unknown>): number | undefined {
  const attachment = raw.attachment as Record<string, unknown> | undefined;
  const n = Number(raw.durationMs ?? raw.duration_ms ?? raw.duration ?? attachment?.durationMs ?? attachment?.duration_ms);
  return Number.isFinite(n) ? n : undefined;
}

function percentile(xs: number[], p: number): number | undefined {
  const sorted = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return undefined;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p / 100) - 1));
  return sorted[idx];
}

function mean(xs: number[]): number | undefined {
  const clean = xs.filter(Number.isFinite);
  if (clean.length === 0) return undefined;
  return clean.reduce((sum, x) => sum + x, 0) / clean.length;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function contentTypes(content: unknown): string[] {
  if (typeof content === 'string') return content.trim() ? ['text'] : [];
  const items = Array.isArray(content) ? content : [content];
  const types = items
    .map(item => stringValue(asRecord(item)?.type))
    .filter((type): type is string => Boolean(type));
  return [...new Set(types)];
}

function assistantSummary(raw: Record<string, unknown>): AssistantSummary {
  const message = asRecord(raw.message) ?? {};
  const usage = asRecord(message.usage) ?? {};
  return {
    model: stringValue(message.model) ?? stringValue(raw.model),
    stop_reason: stringValue(message.stop_reason) ?? stringValue(raw.stop_reason),
    content_types: contentTypes(message.content),
    input_tokens: finiteNumber(usage.input_tokens),
    cache_read_input_tokens: finiteNumber(usage.cache_read_input_tokens),
    cache_creation_input_tokens: finiteNumber(usage.cache_creation_input_tokens),
    output_tokens: finiteNumber(usage.output_tokens),
    service_tier: stringValue(usage.service_tier),
    speed: stringValue(usage.speed),
  };
}

function hookName(raw: Record<string, unknown>): string | undefined {
  const attachment = raw.attachment as Record<string, unknown> | undefined;
  const name = raw.hook_name ?? raw.hookName ?? raw.hook_event_name ?? raw.eventName ?? attachment?.hookName;
  return typeof name === 'string' && name.trim() ? name.trim() : undefined;
}

function isQueuedCommandEvent(raw: Record<string, unknown>, type?: string): boolean {
  return type === 'queued_command' || nestedString(raw, ['attachment', 'type']) === 'queued_command';
}

function isHumanQueuedCommandEvent(raw: Record<string, unknown>, type?: string): boolean {
  if (!isQueuedCommandEvent(raw, type)) return false;
  const attachment = asRecord(raw.attachment);
  const originKind = stringValue(asRecord(raw.origin)?.kind) ?? stringValue(asRecord(attachment?.origin)?.kind);
  const commandMode = stringValue(raw.commandMode) ?? stringValue(attachment?.commandMode);
  const promptSource = stringValue(raw.promptSource) ?? stringValue(attachment?.promptSource);
  const userType = stringValue(raw.userType) ?? stringValue(attachment?.userType);
  if (originKind === 'task-notification' || promptSource === 'system') return false;
  return originKind === 'human' || commandMode === 'prompt' || promptSource === 'user' || userType === 'external';
}

function isUserEvent(e: TranscriptEvent): boolean {
  if (isToolResultUserEvent(e.raw) || isSystemInjectedUserEvent(e.raw)) return false;
  if (isHumanQueuedCommandEvent(e.raw, e.type)) return true;
  return e.type === 'user' || e.type === 'user-message' || Boolean(nestedString(e.raw, ['message', 'role']) === 'user');
}

function isToolResultUserEvent(raw: Record<string, unknown>): boolean {
  const content = asRecord(raw.message)?.content;
  const hasToolResultContent = Array.isArray(content) && content.some(item =>
    item && typeof item === 'object' && (item as Record<string, unknown>).type === 'tool_result'
  );
  return hasToolResultContent || Boolean(raw.toolUseResult || raw.sourceToolAssistantUUID);
}

function isSystemInjectedUserEvent(raw: Record<string, unknown>): boolean {
  const originKind = stringValue(asRecord(raw.origin)?.kind);
  const promptSource = stringValue(raw.promptSource);
  const text = eventText(raw).trim();
  return originKind === 'task-notification'
    || promptSource === 'system'
    || /^<local-command-/i.test(text)
    || /^<command-name>/i.test(text)
    || /^<command-message>/i.test(text)
    || /^Base directory for this skill:/i.test(text)
    || /^# .{1,80}\bSkill\b/i.test(text)
    || /^<task-notification>/i.test(text)
    || /^<system-reminder>/i.test(text)
    || /^This session is being continued from a previous conversation/i.test(text)
    || /^Please continue the conversation/i.test(text);
}

function isAssistantEvent(e: TranscriptEvent): boolean {
  return e.type === 'assistant' || e.type === 'assistant-message' || Boolean(nestedString(e.raw, ['message', 'role']) === 'assistant');
}

function isQueueEvent(e: TranscriptEvent, op: 'enqueue' | 'dequeue'): boolean {
  const t = e.type?.toLowerCase() ?? '';
  const rawOp = String(e.raw.operation ?? e.raw.op ?? e.raw.action ?? '').toLowerCase();
  return (t.includes('queue') && rawOp === op) || t === `queue-operation:${op}`;
}

function isHookEvent(e: TranscriptEvent): boolean {
  const t = e.type?.toLowerCase() ?? '';
  const attachmentType = nestedString(e.raw, ['attachment', 'type'])?.toLowerCase() ?? '';
  if (attachmentType === 'async_hook_response') return false;
  return t.includes('hook') || attachmentType.includes('hook') || hookName(e.raw) !== undefined;
}

function isToolEvent(e: TranscriptEvent): boolean {
  const t = e.type?.toLowerCase() ?? '';
  return t.includes('tool') && !isHookEvent(e);
}

function projectFromFile(file: string): string {
  const parts = file.split('/');
  const projectsIdx = parts.lastIndexOf('projects');
  const encoded = projectsIdx >= 0 ? parts[projectsIdx + 1] : undefined;
  if (!encoded) return 'unknown';
  return encoded.replace(/^-Users-your-name-Projects-/, '').replace(/-/g, '_');
}

function projectAliases(project: string): Set<string> {
  return new Set([project, project.replace(/_/g, '-'), project.replace(/-/g, '_')]);
}

function sessionIdFromEvents(events: TranscriptEvent[]): string | undefined {
  for (const e of events) {
    const id = stringValue(e.raw.session_id)
      ?? stringValue(e.raw.sessionId)
      ?? stringValue(e.raw.sessionUUID)
      ?? stringValue(e.raw.uuid);
    if (id) return id;
  }
  return undefined;
}

function telemetryEventMs(e: MemoryTelemetryEvent): number | undefined {
  return parseTime(e.ts);
}

function agentReturnPressure(
  telemetry: MemoryTelemetryEvent[],
  opts: { sinceTs: number; untilTs: number; project: string; sessionId?: string },
): AgentReturnPressure {
  const projects = projectAliases(opts.project);
  const inWindow = telemetry.filter(e => {
    const ts = telemetryEventMs(e);
    if (ts === undefined || ts <= opts.sinceTs || ts > opts.untilTs) return false;
    const telemetrySessionId = typeof e.session_id === 'string' && e.session_id.trim() ? e.session_id.trim() : undefined;
    if (opts.sessionId && telemetrySessionId && telemetrySessionId !== opts.sessionId) return false;
    const project = typeof e.project === 'string' && e.project.trim() ? e.project.trim() : undefined;
    if (project) return projects.has(project);
    return Boolean(opts.sessionId && telemetrySessionId === opts.sessionId);
  });
  const returns = inWindow.filter(e => e.type === 'agent.return');
  const checkpoints = inWindow.filter(e => e.type === 'agent.checkpoint').length;
  const rows = returns.map(e => ({
    ts: String(e.ts ?? ''),
    project: String(e.project ?? opts.project),
    agent_type: String(e.agent_type ?? ''),
    description: String(e.description ?? ''),
    result_chars: Number(e.result_chars) || 0,
  }));
  const largest = rows.sort((a, b) => b.result_chars - a.result_chars)[0];
  return {
    count: returns.length,
    checkpoints,
    total_chars: rows.reduce((n, r) => n + r.result_chars, 0),
    max_chars: largest?.result_chars ?? 0,
    ...(largest ? { largest } : {}),
  };
}

export function parseTranscriptFile(file: string): TranscriptEvent[] {
  const lines = readFileSync(file, 'utf-8').split(/\r?\n/).filter(Boolean);
  const events: TranscriptEvent[] = [];
  for (const line of lines) {
    try {
      const raw = JSON.parse(line) as Record<string, unknown>;
      events.push({ ts: eventTime(raw), type: eventType(raw), raw });
    } catch {
      // Skip malformed transcript lines. Claude transcripts can be append-only while read.
    }
  }
  return events.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
}

export function analyzeTranscriptFile(file: string, telemetry: MemoryTelemetryEvent[] = []): TurnLatency[] {
  const events = parseTranscriptFile(file).filter(e => e.ts !== undefined);
  const users = events.filter(isUserEvent);
  const turns: TurnLatency[] = [];
  const project = projectFromFile(file);
  const sessionId = sessionIdFromEvents(events);
  const transcriptStartTs = events[0]?.ts ?? 0;
  let eventIdx = 0;
  let transcriptCharsThroughEvent = 0;

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    const userTs = user.ts!;
    const previousUserTs = users[i - 1]?.ts ?? transcriptStartTs;
    const nextUserTs = users[i + 1]?.ts ?? Infinity;
    const window = events.filter(e => e.ts! >= userTs && e.ts! < nextUserTs);
    const firstAssistant = window.find(e => e.ts! > userTs && isAssistantEvent(e));
    const transcriptCharsCutoff = firstAssistant?.ts ?? userTs;
    while (eventIdx < events.length && events[eventIdx].ts! <= transcriptCharsCutoff) {
      transcriptCharsThroughEvent += eventChars(events[eventIdx]);
      eventIdx++;
    }
    const enqueue = window.find(e => isQueueEvent(e, 'enqueue'));
    const dequeue = window.find(e => isQueueEvent(e, 'dequeue'));
    const hooks = window.filter(isHookEvent);
    const preResponseHooks = firstAssistant
      ? hooks.filter(e => e.ts! <= firstAssistant.ts!)
      : hooks;
    const tools = window.filter(isToolEvent);
    const hookDurations = hooks.map(e => ({ name: hookName(e.raw) ?? e.type ?? 'hook', ms: durationMs(e.raw) ?? 0, ts: e.ts! }));
    const preResponseHookDurations = preResponseHooks.map(e => ({ name: hookName(e.raw) ?? e.type ?? 'hook', ms: durationMs(e.raw) ?? 0, ts: e.ts! }));
    const toolDurations = tools.map(e => durationMs(e.raw) ?? 0);
    const turnDuration = window.map(e => Number(e.raw.turn_duration ?? e.raw.turnDuration)).find(Number.isFinite);
    const slowestHook = [...hookDurations].sort((a, b) => b.ms - a.ms)[0];
    const slowestPreResponseHook = [...preResponseHookDurations].sort((a, b) => b.ms - a.ms)[0];
    const preResponseHookTs = preResponseHookDurations.map(h => h.ts).filter(Number.isFinite);
    const firstPreResponseHookTs = preResponseHookTs.length > 0 ? Math.min(...preResponseHookTs) : undefined;
    const lastPreResponseHookTs = preResponseHookTs.length > 0 ? Math.max(...preResponseHookTs) : undefined;

    turns.push({
      file,
      user_ts: userTs,
      prompt_source: isHumanQueuedCommandEvent(user.raw, user.type) ? 'queued_command' : 'user',
      hook_telemetry_expected: !isHumanQueuedCommandEvent(user.raw, user.type),
      hook_telemetry_note: isHumanQueuedCommandEvent(user.raw, user.type)
        ? 'queued human command is transcript-visible, but may not emit UserPromptSubmit/TurnTelemetry'
        : undefined,
      prompt_preview: eventText(user.raw).slice(0, 120),
      transcript_chars_before_first_assistant: transcriptCharsThroughEvent,
      queue_enqueue_ts: enqueue?.ts,
      queue_dequeue_ts: dequeue?.ts,
      first_assistant_ts: firstAssistant?.ts,
      first_assistant: firstAssistant ? assistantSummary(firstAssistant.raw) : undefined,
      pre_response_ms: firstAssistant ? firstAssistant.ts! - userTs : undefined,
      queue_wait_ms: enqueue?.ts && dequeue?.ts ? dequeue.ts - enqueue.ts : undefined,
      pre_response_hook_duration_ms: preResponseHookDurations.reduce((sum, h) => sum + h.ms, 0),
      pre_response_hook_count: preResponseHooks.length,
      pre_response_slowest_hook: slowestPreResponseHook && slowestPreResponseHook.ms > 0 ? slowestPreResponseHook : undefined,
      first_pre_response_hook_ts: firstPreResponseHookTs,
      last_pre_response_hook_ts: lastPreResponseHookTs,
      after_last_pre_response_hook_ms: firstAssistant?.ts && lastPreResponseHookTs ? firstAssistant.ts - lastPreResponseHookTs : undefined,
      hook_duration_ms: hookDurations.reduce((sum, h) => sum + h.ms, 0),
      hook_count: hooks.length,
      slowest_hook: slowestHook && slowestHook.ms > 0 ? slowestHook : undefined,
      tool_duration_ms: toolDurations.reduce((sum, ms) => sum + ms, 0),
      tool_count: tools.length,
      turn_duration_ms: Number.isFinite(turnDuration) ? Number(turnDuration) : undefined,
      agent_returns_since_last_prompt: agentReturnPressure(telemetry, {
        sinceTs: previousUserTs,
        untilTs: userTs,
        project,
        sessionId,
      }),
    });
  }

  return turns;
}

function collectJsonl(path: string): string[] {
  if (!existsSync(path)) return [];
  const st = statSync(path);
  if (st.isFile()) return path.endsWith('.jsonl') ? [path] : [];
  const files: string[] = [];
  for (const entry of readdirSync(path)) {
    const full = join(path, entry);
    try {
      const s = statSync(full);
      if (s.isDirectory()) files.push(...collectJsonl(full));
      else if (full.endsWith('.jsonl')) files.push(full);
    } catch {
      // Skip unreadable entries.
    }
  }
  return files;
}

function fmtMs(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function fmtPct(ms: number | undefined, total: number | undefined): string {
  if (ms === undefined || total === undefined || !Number.isFinite(ms) || !Number.isFinite(total) || total <= 0) return '—';
  return `${(ms / total * 100).toFixed(1)}%`;
}

function fmtTokens(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function fmtChars(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function fmtAssistant(a: AssistantSummary | undefined): string {
  if (!a) return 'assistant=—';
  const parts = [
    a.model,
    a.content_types.length ? `blocks=${a.content_types.join(',')}` : undefined,
    a.stop_reason ? `stop=${a.stop_reason}` : undefined,
    a.output_tokens !== undefined ? `out=${a.output_tokens}` : undefined,
    a.cache_read_input_tokens !== undefined ? `cache_read=${a.cache_read_input_tokens}` : undefined,
    a.cache_creation_input_tokens !== undefined ? `cache_create=${a.cache_creation_input_tokens}` : undefined,
    a.speed ? `speed=${a.speed}` : undefined,
    a.service_tier ? `tier=${a.service_tier}` : undefined,
  ].filter(Boolean);
  return `assistant=${parts.join(' ') || 'observed'}`;
}

function nextUserTs(events: TranscriptEvent[], userTs: number): number {
  return events.find(e => e.ts !== undefined && e.ts > userTs && isUserEvent(e))?.ts ?? Infinity;
}

function describeEvent(e: TranscriptEvent, userTs: number): string {
  const offset = fmtMs(e.ts === undefined ? undefined : e.ts - userTs).padStart(6);
  const message = asRecord(e.raw.message);
  const role = stringValue(message?.role);
  const type = e.type || role || 'event';
  const op = stringValue(e.raw.operation) ?? stringValue(e.raw.op) ?? stringValue(e.raw.action);
  const attachment = asRecord(e.raw.attachment);
  const attachmentType = stringValue(attachment?.type);

  if (isUserEvent(e)) return `${offset} ${isHumanQueuedCommandEvent(e.raw, e.type) ? 'queued-user' : 'user'}`;
  if (isAssistantEvent(e)) return `${offset} assistant ${fmtAssistant(assistantSummary(e.raw)).replace(/^assistant=/, '')}`;
  if (isQueueEvent(e, 'enqueue') || isQueueEvent(e, 'dequeue')) return `${offset} queue ${op ?? type}`;
  if (isHookEvent(e)) return `${offset} hook ${hookName(e.raw) ?? type} duration=${fmtMs(durationMs(e.raw))}`;
  if (attachmentType === 'async_hook_response') {
    return `${offset} async-hook-response ${hookName(e.raw) ?? 'hook'} duration=${fmtMs(durationMs(e.raw))}`;
  }
  if (isToolEvent(e)) return `${offset} tool ${type} duration=${fmtMs(durationMs(e.raw))}`;
  if (type === 'user' || role === 'user') {
    const source = isSystemInjectedUserEvent(e.raw) ? 'system' : isToolResultUserEvent(e.raw) ? 'tool-result' : 'internal';
    return `${offset} internal-user source=${source}`;
  }
  return `${offset} ${type}${op ? ` op=${op}` : ''}`;
}

function printCollapsedTimeline(events: TranscriptEvent[], userTs: number): void {
  let last = '';
  let count = 0;
  const flush = () => {
    if (!last) return;
    console.log(`    ${last}${count > 1 ? ` x${count}` : ''}`);
  };

  for (const event of events) {
    const line = describeEvent(event, userTs);
    if (line === last) {
      count++;
      continue;
    }
    flush();
    last = line;
    count = 1;
  }
  flush();
}

function printTrace(turns: TurnLatency[], count: number): void {
  const selected = turns
    .filter(t => Number.isFinite(t.pre_response_ms))
    .sort((a, b) => (b.pre_response_ms ?? 0) - (a.pre_response_ms ?? 0))
    .slice(0, Math.max(1, count));

  console.log('\n  PROMPT LATENCY TRACE');
  console.log('  ─────────────────────────────────────────────');
  for (const t of selected) {
    const events = parseTranscriptFile(t.file).filter(e => e.ts !== undefined);
    const cutoff = Math.min(
      nextUserTs(events, t.user_ts),
      (t.first_assistant_ts ?? t.user_ts) + 5_000,
    );
    const window = events.filter(e => e.ts! >= t.user_ts && e.ts! <= cutoff);
    const when = new Date(t.user_ts).toISOString();
    console.log(`\n  ${fmtMs(t.pre_response_ms)} ${projectFromFile(t.file)} ${when}`);
    console.log(`    source=${t.prompt_source} pre-hooks=${fmtMs(t.pre_response_hook_duration_ms)} count=${t.pre_response_hook_count} turn-hooks=${fmtMs(t.hook_duration_ms)} after-last-pre-hook=${fmtMs(t.after_last_pre_response_hook_ms)}`);
    console.log(`    context_chars_before_first_assistant=${fmtChars(t.transcript_chars_before_first_assistant)} agent_return_since_last_prompt=${fmtChars(t.agent_returns_since_last_prompt.total_chars)} max=${fmtChars(t.agent_returns_since_last_prompt.max_chars)} checkpoints=${t.agent_returns_since_last_prompt.checkpoints}`);
    console.log(`    ${fmtAssistant(t.first_assistant)}`);
    console.log(`    prompt: ${t.prompt_preview || '(empty prompt)'}`);
    printCollapsedTimeline(window, t.user_ts);
  }
  console.log('');
}

function printSummary(turns: TurnLatency[], files: number, root: string): void {
  const measured = turns.filter(t => Number.isFinite(t.pre_response_ms));
  const pre = measured.map(t => t.pre_response_ms!).sort((a, b) => a - b);
  const hookBeforeAssistant = measured.map(t => t.pre_response_hook_duration_ms);
  const afterHooks = measured.map(t => t.after_last_pre_response_hook_ms).filter(Number.isFinite) as number[];
  const buckets: Record<string, number> = {
    '<2s': 0,
    '2-5s': 0,
    '5-10s': 0,
    '10-20s': 0,
    '20-40s': 0,
    '>40s': 0,
  };
  for (const ms of pre) {
    if (ms < 2_000) buckets['<2s']++;
    else if (ms < 5_000) buckets['2-5s']++;
    else if (ms < 10_000) buckets['5-10s']++;
    else if (ms < 20_000) buckets['10-20s']++;
    else if (ms < 40_000) buckets['20-40s']++;
    else buckets['>40s']++;
  }
  const slowest = measured
    .sort((a, b) => (b.pre_response_ms ?? 0) - (a.pre_response_ms ?? 0))
    .slice(0, 10);
  const byModel = new Map<string, TurnLatency[]>();
  for (const t of measured) {
    const model = t.first_assistant?.model ?? 'unknown';
    byModel.set(model, [...(byModel.get(model) ?? []), t]);
  }
  const cacheReadBuckets: Array<[string, (t: TurnLatency) => boolean]> = [
    ['cache_read <50k', t => (t.first_assistant?.cache_read_input_tokens ?? 0) < 50_000],
    ['cache_read 50-200k', t => {
      const n = t.first_assistant?.cache_read_input_tokens ?? 0;
      return n >= 50_000 && n < 200_000;
    }],
    ['cache_read >200k', t => (t.first_assistant?.cache_read_input_tokens ?? 0) >= 200_000],
  ];
  const queuedHuman = turns.filter(t => t.prompt_source === 'queued_command').length;
  const agentPressure = measured.filter(t => t.agent_returns_since_last_prompt.count > 0);

  console.log('\n  PROMPT LATENCY SUMMARY');
  console.log('  ─────────────────────────────────────────────');
  console.log(`  Path: ${root}`);
  console.log(`  Transcript files: ${files}`);
  console.log(`  Turns measured: ${measured.length}`);
  if (queuedHuman > 0) {
    console.log(`  Queued human prompts: ${queuedHuman} (transcript-visible; UserPromptSubmit telemetry may be absent)`);
  }
  console.log('\n  Pre-response distribution:');
  console.log(`    p50/p75/p90/p95/p99 : ${fmtMs(percentile(pre, 50))} / ${fmtMs(percentile(pre, 75))} / ${fmtMs(percentile(pre, 90))} / ${fmtMs(percentile(pre, 95))} / ${fmtMs(percentile(pre, 99))}`);
  console.log(`    max                 : ${fmtMs(pre.at(-1))}`);
  for (const [bucket, count] of Object.entries(buckets)) {
    console.log(`    ${bucket.padEnd(7)}             : ${count}`);
  }
  console.log('\n  Hook timing before first assistant:');
  console.log(`    pre-hook p50/p95    : ${fmtMs(percentile(hookBeforeAssistant, 50))} / ${fmtMs(percentile(hookBeforeAssistant, 95))}`);
  console.log(`    post-hook gap p50/p95: ${fmtMs(percentile(afterHooks, 50))} / ${fmtMs(percentile(afterHooks, 95))}`);
  console.log('\n  Assistant workload correlation:');
  for (const [model, group] of [...byModel.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const preMs = group.map(t => t.pre_response_ms!).filter(Number.isFinite);
    const cacheRead = group.map(t => t.first_assistant?.cache_read_input_tokens).filter(Number.isFinite) as number[];
    const out = group.map(t => t.first_assistant?.output_tokens).filter(Number.isFinite) as number[];
    console.log(`    ${model.padEnd(32)} n=${String(group.length).padStart(3)} p50/p95=${fmtMs(percentile(preMs, 50))}/${fmtMs(percentile(preMs, 95))} avg_cache_read=${fmtTokens(mean(cacheRead))} avg_out=${fmtTokens(mean(out))}`);
  }
  for (const [label, pred] of cacheReadBuckets) {
    const group = measured.filter(pred);
    const preMs = group.map(t => t.pre_response_ms!).filter(Number.isFinite);
    console.log(`    ${label.padEnd(32)} n=${String(group.length).padStart(3)} p50/p95=${fmtMs(percentile(preMs, 50))}/${fmtMs(percentile(preMs, 95))}`);
  }
  console.log('\n  Agent-return pressure before prompt:');
  if (agentPressure.length === 0) {
    console.log('    (no agent.return telemetry before measured prompts)');
  } else {
    const preMs = agentPressure.map(t => t.pre_response_ms!).filter(Number.isFinite);
    const totalChars = agentPressure.map(t => t.agent_returns_since_last_prompt.total_chars).filter(Number.isFinite);
    const maxChars = agentPressure.map(t => t.agent_returns_since_last_prompt.max_chars).filter(Number.isFinite);
    console.log(`    turns with prior returns       n=${String(agentPressure.length).padStart(3)} p50/p95=${fmtMs(percentile(preMs, 50))}/${fmtMs(percentile(preMs, 95))}`);
    console.log(`    prior return chars avg/max     ${fmtChars(mean(totalChars))} / ${fmtChars(Math.max(...totalChars))}`);
    console.log(`    largest single prior return    ${fmtChars(Math.max(...maxChars))}`);
  }
  console.log('\n  Slowest measured turns:');
  for (const t of slowest) {
    const hookPct = fmtPct(t.pre_response_hook_duration_ms, t.pre_response_ms);
    const when = new Date(t.user_ts).toISOString();
    console.log(`    ${fmtMs(t.pre_response_ms).padStart(6)} ${projectFromFile(t.file)} ${when}`);
    console.log(`           source=${t.prompt_source} pre-hooks=${fmtMs(t.pre_response_hook_duration_ms)} (${hookPct}) count=${t.pre_response_hook_count} after-last-pre-hook=${fmtMs(t.after_last_pre_response_hook_ms)}`);
    console.log(`           context_chars_before_first_assistant=${fmtChars(t.transcript_chars_before_first_assistant)} agent_return_since_last_prompt=${fmtChars(t.agent_returns_since_last_prompt.total_chars)} max=${fmtChars(t.agent_returns_since_last_prompt.max_chars)} checkpoints=${t.agent_returns_since_last_prompt.checkpoints}`);
    if (t.pre_response_slowest_hook) {
      console.log(`           slowest pre-hook: ${t.pre_response_slowest_hook.name} ${fmtMs(t.pre_response_slowest_hook.ms)}`);
    }
    console.log(`           ${fmtAssistant(t.first_assistant)}`);
    console.log(`           ${t.prompt_preview || '(empty prompt)'}`);
  }
  console.log('');
}

function main(): void {
  if (process.argv.includes('--help')) usage();
  const asJson = process.argv.includes('--json');
  const summary = process.argv.includes('--summary');
  const traceSlowestArg = argValue('--trace-slowest');
  const traceSlowest = traceSlowestArg !== undefined ? Number(traceSlowestArg) : undefined;
  const root = argValue('--path') ?? join(homedir(), '.claude', 'projects');
  const limit = Number(argValue('--limit') ?? argValue('--recent') ?? (summary ? 500 : 20));
  const files = collectJsonl(root);
  const telemetry = readTelemetry();
  const turns = files.flatMap(file => analyzeTranscriptFile(file, telemetry))
    .sort((a, b) => b.user_ts - a.user_ts)
    .slice(0, Number.isFinite(limit) ? limit : 20);

  if (asJson) {
    console.log(JSON.stringify({ path: root, files: files.length, turns }, null, 2));
    return;
  }

  if (traceSlowest !== undefined) {
    printTrace(turns, Number.isFinite(traceSlowest) ? traceSlowest : 5);
    return;
  }

  if (summary) {
    printSummary(turns, files.length, root);
    return;
  }

  console.log('\n  PROMPT LATENCY REPORT');
  console.log('  ─────────────────────────────────────────────');
  console.log(`  Path: ${root}`);
  console.log(`  Transcript files: ${files.length}`);
  console.log(`  Turns shown: ${turns.length}\n`);
  for (const t of turns) {
    const when = new Date(t.user_ts).toISOString();
    console.log(`  ${when}  source=${t.prompt_source} pre-response=${fmtMs(t.pre_response_ms)} queue=${fmtMs(t.queue_wait_ms)} pre-hooks=${fmtMs(t.pre_response_hook_duration_ms)} turn-hooks=${fmtMs(t.hook_duration_ms)} tools=${fmtMs(t.tool_duration_ms)} turn=${fmtMs(t.turn_duration_ms)}`);
    if (t.pre_response_slowest_hook) console.log(`    slowest pre-response hook: ${t.pre_response_slowest_hook.name} ${fmtMs(t.pre_response_slowest_hook.ms)}`);
    if (t.after_last_pre_response_hook_ms !== undefined) console.log(`    first assistant after last pre-response hook: ${fmtMs(t.after_last_pre_response_hook_ms)}`);
    if (t.hook_telemetry_note) console.log(`    note: ${t.hook_telemetry_note}`);
    console.log(`    context_chars_before_first_assistant=${fmtChars(t.transcript_chars_before_first_assistant)} agent_return_since_last_prompt=${fmtChars(t.agent_returns_since_last_prompt.total_chars)} max=${fmtChars(t.agent_returns_since_last_prompt.max_chars)} checkpoints=${t.agent_returns_since_last_prompt.checkpoints}`);
    console.log(`    ${fmtAssistant(t.first_assistant)}`);
    console.log(`    ${t.prompt_preview || '(empty prompt)'}`);
  }
  console.log('');
}

if (import.meta.main) main();
