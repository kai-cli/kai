import { test, expect, describe } from 'bun:test';
import { StallDetector } from '../scripts/lib/stall-detector';

describe('StallDetector', () => {
  test('not stalled immediately after creation', () => {
    const detector = new StallDetector();
    expect(detector.isStalled()).toBe(false);
    expect(detector.isBlocked()).toBe(false);
  });

  test('meaningful output resets timer', () => {
    const detector = new StallDetector({
      stallThresholdMs: 100,
      blockThresholdMs: 200,
      minBytesPerWindow: 50,
    });
    // Feed enough data to reset
    detector.onData(Buffer.alloc(100));
    expect(detector.isStalled()).toBe(false);
  });

  test('stalled after threshold with no output', () => {
    const detector = new StallDetector({
      stallThresholdMs: 10,
      blockThresholdMs: 50,
      minBytesPerWindow: 100,
    });
    // Manually set lastOutputTime in the past
    (detector as any).lastOutputTime = Date.now() - 20;
    expect(detector.isStalled()).toBe(true);
    expect(detector.isBlocked()).toBe(false);
  });

  test('blocked after block threshold', () => {
    const detector = new StallDetector({
      stallThresholdMs: 10,
      blockThresholdMs: 50,
      minBytesPerWindow: 100,
    });
    (detector as any).lastOutputTime = Date.now() - 60;
    expect(detector.isStalled()).toBe(true);
    expect(detector.isBlocked()).toBe(true);
  });

  test('small chunks below minBytes do not reset timer', () => {
    const detector = new StallDetector({
      stallThresholdMs: 10,
      blockThresholdMs: 50,
      minBytesPerWindow: 100,
    });
    (detector as any).lastOutputTime = Date.now() - 20;
    // Feed small chunk (below minBytes threshold)
    detector.onData(Buffer.alloc(10));
    expect(detector.isStalled()).toBe(true);
  });

  test('accumulated small chunks reaching minBytes resets timer', () => {
    const detector = new StallDetector({
      stallThresholdMs: 1000,
      blockThresholdMs: 2000,
      minBytesPerWindow: 50,
    });
    // Feed multiple small chunks adding up to threshold
    detector.onData(Buffer.alloc(30));
    detector.onData(Buffer.alloc(30));
    expect(detector.isStalled()).toBe(false);
  });

  test('reset clears state', () => {
    const detector = new StallDetector({
      stallThresholdMs: 10,
      blockThresholdMs: 50,
      minBytesPerWindow: 100,
    });
    (detector as any).lastOutputTime = Date.now() - 60;
    expect(detector.isBlocked()).toBe(true);
    detector.reset();
    expect(detector.isBlocked()).toBe(false);
    expect(detector.isStalled()).toBe(false);
  });

  test('getLastOutputAge returns milliseconds since last output', () => {
    const detector = new StallDetector();
    const age = detector.getLastOutputAge();
    expect(age).toBeGreaterThanOrEqual(0);
    expect(age).toBeLessThan(100); // Should be very recent
  });
});
