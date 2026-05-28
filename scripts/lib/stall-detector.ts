/**
 * Stall Detector — Blocked Agent Detection
 *
 * Monitors stdout during agent execution to detect stalls (60s no output)
 * and blocks (120s no output).
 */

export interface StallConfig {
  stallThresholdMs: number;   // default 60000 (60s)
  blockThresholdMs: number;   // default 120000 (120s)
  minBytesPerWindow: number;  // default 100
}

export class StallDetector {
  private config: StallConfig;
  private lastOutputTime: number;
  private windowBytes: number;
  private windowStartTime: number;

  constructor(config?: Partial<StallConfig>) {
    this.config = {
      stallThresholdMs: config?.stallThresholdMs ?? 60_000,
      blockThresholdMs: config?.blockThresholdMs ?? 120_000,
      minBytesPerWindow: config?.minBytesPerWindow ?? 100,
    };
    this.lastOutputTime = Date.now();
    this.windowBytes = 0;
    this.windowStartTime = Date.now();
  }

  /**
   * Called when stdout produces data.
   * Resets the stall timer if meaningful output is detected.
   */
  onData(chunk: Buffer): void {
    const now = Date.now();
    const bytes = chunk.length;

    // Accumulate bytes in the current window
    this.windowBytes += bytes;

    // Check if we've accumulated enough bytes to consider it meaningful output
    if (this.windowBytes >= this.config.minBytesPerWindow) {
      this.lastOutputTime = now;
      this.windowBytes = 0;
      this.windowStartTime = now;
    } else {
      // If the window has been open for too long without hitting the threshold,
      // reset it to avoid infinite accumulation of tiny chunks
      const windowAge = now - this.windowStartTime;
      if (windowAge > 10_000) {
        // Reset window after 10s if we haven't hit the byte threshold
        this.windowBytes = 0;
        this.windowStartTime = now;
      }
    }
  }

  /**
   * Check if the agent is stalled (over stallThresholdMs since last meaningful output).
   */
  isStalled(): boolean {
    return this.getLastOutputAge() > this.config.stallThresholdMs;
  }

  /**
   * Check if the agent is blocked (over blockThresholdMs since last meaningful output).
   */
  isBlocked(): boolean {
    return this.getLastOutputAge() > this.config.blockThresholdMs;
  }

  /**
   * Get milliseconds since last meaningful output.
   */
  getLastOutputAge(): number {
    return Date.now() - this.lastOutputTime;
  }

  /**
   * Reset the detector (e.g., at the start of a new phase).
   */
  reset(): void {
    this.lastOutputTime = Date.now();
    this.windowBytes = 0;
    this.windowStartTime = Date.now();
  }
}
