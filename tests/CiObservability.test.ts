import { describe, expect, test } from 'bun:test';
import {
  analyzeCiOutput,
  classifyFailure,
  countTimeouts,
  formatObservation,
  parseTimedEntries,
} from '../scripts/ci-observability';

describe('ci-observability', () => {
  test('parses and sorts Bun test durations', () => {
    const entries = parseTimedEntries([
      '(pass) fast test [0.20ms]',
      '(pass) slow test [1.50s]',
      '(fail) medium test [250.00ms]',
    ].join('\n'));

    expect(entries.map(e => e.name)).toEqual(['slow test', 'medium test', 'fast test']);
    expect(entries[0].ms).toBe(1500);
    expect(entries[1].ms).toBe(250);
  });

  test('counts timeout signals case-insensitively', () => {
    expect(countTimeouts('Timeout after 12000ms\nETIMEDOUT\nnot a timeout?')).toBe(3);
  });

  test('classifies network/infra failures without code signals', () => {
    const result = classifyFailure('Failed to fetch package\nETIMEDOUT while downloading');

    expect(result.classification).toBe('infra/network');
    expect(result.signals).toContain('network/transport signal');
  });

  test('classifies assertion/test failures as code even with mixed signals', () => {
    const result = classifyFailure('error: expect(received).toBe(expected)\n1 fail\nTimeout after teardown');

    expect(result.classification).toBe('code');
    expect(result.signals).toContain('test failure count');
  });

  test('analyzes slowest entries with limit', () => {
    const obs = analyzeCiOutput([
      '(pass) a [1ms]',
      '(pass) b [3ms]',
      '(pass) c [2ms]',
    ].join('\n'), 2);

    expect(obs.slowest.map(e => e.name)).toEqual(['b', 'c']);
    expect(obs.timeout_count).toBe(0);
  });

  test('formats a compact markdown summary', () => {
    const text = formatObservation({
      slowest: [{ name: 'slow test', ms: 123.4 }],
      timeout_count: 1,
      classification: 'code',
      signals: ['test failure count'],
    });

    expect(text).toContain('## CI observability');
    expect(text).toContain('Failure classification: code');
    expect(text).toContain('123 ms — slow test');
  });
});
