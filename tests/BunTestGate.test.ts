import { describe, expect, test } from 'bun:test';
import { parseBunTestOutput, validateBunTestOutput } from '../scripts/bun-test-gate';

const passingOutput = `bun test v1.3.14

tests/example.test.ts:
(pass) example > passes

 1 pass
 0 fail
 1 expect() calls
Ran 1 tests across 1 file. [12.00ms]
`;

describe('bun-test-gate', () => {
  test('parses a complete passing Bun summary', () => {
    expect(parseBunTestOutput(passingOutput)).toEqual({
      pass: 1,
      skip: 0,
      fail: 0,
      expectCalls: 1,
      testsRun: 1,
      filesRun: 1,
    });
  });

  test('accepts passing output with zero exit status', () => {
    expect(validateBunTestOutput(passingOutput, 0).ok).toBe(true);
  });

  test('fails closed on a missing run summary', () => {
    const result = validateBunTestOutput('1 pass\n0 fail\n', 0);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('complete "Ran N tests across M files" summary');
  });

  test('fails on non-zero fail counts', () => {
    const result = validateBunTestOutput(passingOutput.replace('0 fail', '2 fail'), 0);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Bun reported 2 failing test(s).');
  });

  test('fails on zero tests', () => {
    const result = validateBunTestOutput(passingOutput.replace('Ran 1 tests across 1 file', 'Ran 0 tests across 0 files'), 0);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Bun reported zero tests run.');
    expect(result.errors).toContain('Bun reported zero test files run.');
  });

  test('fails on non-zero process exit even with a good summary', () => {
    const result = validateBunTestOutput(passingOutput, 134);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Bun exited non-zero (134).');
  });

  test('fails on runtime crash signatures', () => {
    const result = validateBunTestOutput(`${passingOutput}\nSIGABRT`, 0);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes('crash signature'))).toBe(true);
  });

  test('does not fail on benign crash wording in passing test output', () => {
    const result = validateBunTestOutput(`${passingOutput}\n(pass) gate > mentions crash signature text in a test name`, 0);
    expect(result.ok).toBe(true);
  });
});
