#!/usr/bin/env bun
/**
 * Manual test script for SessionEndComposite hook
 *
 * Creates a mock transcript and tests the composite hook behavior
 */

import { writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';

const TEST_DIR = join(import.meta.dir, '.manual-test-composite');
const TRANSCRIPT_PATH = join(TEST_DIR, 'transcript.jsonl');
const HOOK_PATH = join(import.meta.dir, '..', 'hooks', 'SessionEndComposite.hook.ts');

// Setup test directory
if (existsSync(TEST_DIR)) {
  rmSync(TEST_DIR, { recursive: true, force: true });
}
mkdirSync(TEST_DIR, { recursive: true });

async function testTrivialSession() {
  console.log('\n=== Testing TRIVIAL session ===');

  const transcript = [
    '{"type":"user","message":{"content":"Hello PAI"}}',
    '{"type":"assistant","message":{"content":"Ready"}}',
  ].join('\n');

  writeFileSync(TRANSCRIPT_PATH, transcript);

  const input = {
    session_id: 'test-trivial-123',
    transcript_path: TRANSCRIPT_PATH,
    hook_event_name: 'SessionEnd',
  };

  return runHook(input);
}

async function testSubstantialSession() {
  console.log('\n=== Testing SUBSTANTIAL session ===');

  const longMessage = 'A'.repeat(10000);
  const transcript = [
    '{"type":"user","message":{"content":"Start work"}}',
    '{"type":"assistant","message":{"content":"OK"}}',
    '{"type":"user","message":{"content":"Do something"}}',
    `{"type":"assistant","message":{"content":"${longMessage}"}}`,
    '{"type":"user","message":{"content":"Continue"}}',
    '{"type":"assistant","message":{"content":"Done"}}',
    '{"type":"user","message":{"content":"Test it"}}',
    '{"type":"assistant","message":{"content":"Passed"}}',
    '{"type":"user","message":{"content":"Deploy"}}',
    '{"type":"assistant","message":{"content":"Deployed"}}',
  ].join('\n');

  writeFileSync(TRANSCRIPT_PATH, transcript);

  const input = {
    session_id: 'test-substantial-456',
    transcript_path: TRANSCRIPT_PATH,
    hook_event_name: 'SessionEnd',
  };

  return runHook(input);
}

async function testFeedbackSession() {
  console.log('\n=== Testing FEEDBACK session ===');

  const transcript = [
    '{"type":"user","message":{"content":"Hi"}}',
    '{"type":"assistant","message":{"content":"Hello"}}',
    '{"type":"user","message":{"content":"/feedback This is great"}}',
    '{"type":"assistant","message":{"content":"Thank you!"}}',
  ].join('\n');

  writeFileSync(TRANSCRIPT_PATH, transcript);

  const input = {
    session_id: 'test-feedback-789',
    transcript_path: TRANSCRIPT_PATH,
    hook_event_name: 'SessionEnd',
  };

  return runHook(input);
}

function runHook(input: any): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('bun', [HOOK_PATH], {
      stdio: ['pipe', 'inherit', 'inherit'],
      env: {
        ...process.env,
        PAI_DIR: join(import.meta.dir, '..'),
      },
    });

    proc.stdin.write(JSON.stringify(input));
    proc.stdin.end();

    proc.on('exit', (code) => {
      if (code === 0) {
        console.log('✓ Hook completed successfully');
        resolve();
      } else {
        console.error(`✗ Hook failed with exit code ${code}`);
        reject(new Error(`Exit code ${code}`));
      }
    });

    proc.on('error', (error) => {
      console.error(`✗ Hook error: ${error.message}`);
      reject(error);
    });
  });
}

// Run tests
(async () => {
  try {
    await testTrivialSession();
    await testSubstantialSession();
    await testFeedbackSession();

    console.log('\n✓ All manual tests passed');
  } catch (error) {
    console.error('\n✗ Test failed:', error);
    process.exit(1);
  } finally {
    // Cleanup
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  }
})();
