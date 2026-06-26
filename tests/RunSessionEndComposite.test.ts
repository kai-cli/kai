import { describe, expect, test } from 'bun:test';
import { buildPayload, parseArgs } from '../scripts/run-session-end-composite';

describe('run-session-end-composite helper', () => {
  test('builds a valid native SessionEnd payload for the composite hook', () => {
    expect(buildPayload('/tmp/session.jsonl', 'abc')).toEqual({
      session_id: 'abc',
      transcript_path: '/tmp/session.jsonl',
      hook_event_name: 'SessionEnd',
      hookProtocolVersion: '1.0',
    });
  });

  test('parses equals and separated argument forms', () => {
    expect(parseArgs(['--transcript-path=/tmp/a.jsonl', '--session-id', 's1'])).toEqual({
      transcriptPath: '/tmp/a.jsonl',
      sessionId: 's1',
    });
  });
});
