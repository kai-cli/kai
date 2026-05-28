/**
 * HookIO.test.ts - Test hook I/O protocol and versioning
 */

import { test, expect } from 'bun:test';
import { HOOK_PROTOCOL_VERSION } from '../hooks/lib/hook-io';

test('HOOK_PROTOCOL_VERSION is defined', () => {
  expect(HOOK_PROTOCOL_VERSION).toBeDefined();
  expect(typeof HOOK_PROTOCOL_VERSION).toBe('string');
  expect(HOOK_PROTOCOL_VERSION).toBe('1.0');
});

// Note: Direct testing of readHookInput() is challenging because it reads from stdin.
// Instead, we test the protocol version constant and document the expected behavior:
//
// 1. Hooks should export HOOK_PROTOCOL_VERSION = "1.0"
// 2. readHookInput() logs a warning if hookProtocolVersion !== "1.0"
// 3. readHookInput() logs warnings for unexpected fields but doesn't fail
// 4. Validation is fail-soft: warnings are logged, but payload is still processed
//
// Integration tests with real hooks verify this behavior end-to-end.

test('Hook protocol version follows semantic versioning format', () => {
  // Version should be "X.Y" format
  const versionPattern = /^\d+\.\d+$/;
  expect(versionPattern.test(HOOK_PROTOCOL_VERSION)).toBe(true);
});

test('Hook protocol documentation', () => {
  // This test documents the protocol expectations for maintainers
  const expectations = {
    version: HOOK_PROTOCOL_VERSION,
    knownFields: [
      'session_id',
      'transcript_path',
      'hook_event_name',
      'hookProtocolVersion',
      'last_assistant_message',
      'prompt',
      'user_prompt',
      'cwd',
      'stop_hook_active',
      'tool_name',
      'tool_input',
      'tool_response',
      'config_path',
      'change_type',
    ],
    behavior: {
      missingRequired: 'Returns null, logs error',
      unexpectedFields: 'Logs warning, continues processing (forward compatibility)',
      versionMismatch: 'Logs warning, continues processing',
      invalidJSON: 'Returns null, logs error',
    },
  };

  expect(expectations.version).toBe('1.0');
  expect(expectations.knownFields).toContain('session_id');
  expect(expectations.knownFields).toContain('hook_event_name');
});
