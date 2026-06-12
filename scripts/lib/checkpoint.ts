import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";

export interface Checkpoint {
  phase: string;
  status: 'started' | 'completed' | 'failed';
  output?: string;
  timestamp: string;
  /** Monotonic save order — breaks timestamp ties on fast machines (two saves in the same ms). */
  seq?: number;
}

export class CheckpointManager {
  private teamDir: string;
  private checkpointsDir: string;
  /** Process-local monotonic counter so same-millisecond saves still order correctly. */
  private seqCounter = 0;

  constructor(teamDir: string) {
    this.teamDir = teamDir;
    this.checkpointsDir = join(teamDir, "checkpoints");
  }

  /**
   * Save a checkpoint for a phase
   */
  save(phase: string, status: 'started' | 'completed' | 'failed', output?: string): void {
    if (!existsSync(this.checkpointsDir)) {
      mkdirSync(this.checkpointsDir, { recursive: true });
    }

    const checkpoint: Checkpoint = {
      phase,
      status,
      output,
      timestamp: new Date().toISOString(),
      seq: ++this.seqCounter,
    };

    const checkpointPath = join(this.checkpointsDir, `${phase}.json`);
    writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));
  }

  /**
   * Get the name of the last completed phase
   * Returns null if no phases have completed
   */
  getLastCompleted(): string | null {
    if (!existsSync(this.checkpointsDir)) {
      return null;
    }

    const files = readdirSync(this.checkpointsDir).filter(f => f.endsWith('.json'));
    if (files.length === 0) return null;

    // Find all completed phases
    const completed: Array<{ phase: string; timestamp: string; seq: number }> = [];
    for (const file of files) {
      const path = join(this.checkpointsDir, file);
      try {
        const checkpoint: Checkpoint = JSON.parse(readFileSync(path, 'utf-8'));
        if (checkpoint.status === 'completed') {
          completed.push({ phase: checkpoint.phase, timestamp: checkpoint.timestamp, seq: checkpoint.seq ?? 0 });
        }
      } catch {
        // Skip malformed checkpoint files
      }
    }

    if (completed.length === 0) return null;

    // Return the most recent completed phase. Sort by timestamp, then by seq to break same-ms ties
    // (two saves in the same millisecond on fast machines would otherwise sort unstably → flaky CI).
    completed.sort((a, b) => {
      const dt = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      return dt !== 0 ? dt : b.seq - a.seq;
    });
    return completed[0].phase;
  }

  /**
   * Get the output from a completed phase
   */
  getPhaseOutput(phase: string): string | null {
    const checkpointPath = join(this.checkpointsDir, `${phase}.json`);
    if (!existsSync(checkpointPath)) {
      return null;
    }

    try {
      const checkpoint: Checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf-8'));
      return checkpoint.status === 'completed' ? (checkpoint.output || null) : null;
    } catch {
      return null;
    }
  }

  /**
   * Check if the run can be resumed
   * True if there are checkpoints but the run isn't complete
   */
  canResume(): boolean {
    if (!existsSync(this.checkpointsDir)) {
      return false;
    }

    const files = readdirSync(this.checkpointsDir).filter(f => f.endsWith('.json'));
    if (files.length === 0) return false;

    // Can resume if we have at least one checkpoint that's not a failure
    for (const file of files) {
      const path = join(this.checkpointsDir, file);
      try {
        const checkpoint: Checkpoint = JSON.parse(readFileSync(path, 'utf-8'));
        if (checkpoint.status === 'started' || checkpoint.status === 'completed') {
          return true;
        }
      } catch {
        // Skip malformed files
      }
    }

    return false;
  }

  /**
   * Remove all checkpoint files
   * Called after successful run completion
   */
  cleanup(): void {
    if (!existsSync(this.checkpointsDir)) {
      return;
    }

    const files = readdirSync(this.checkpointsDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        unlinkSync(join(this.checkpointsDir, file));
      } catch {
        // Best effort cleanup
      }
    }
  }

  /**
   * Get all checkpoints for debugging/inspection
   */
  getAllCheckpoints(): Checkpoint[] {
    if (!existsSync(this.checkpointsDir)) {
      return [];
    }

    const files = readdirSync(this.checkpointsDir).filter(f => f.endsWith('.json'));
    const checkpoints: Checkpoint[] = [];

    for (const file of files) {
      const path = join(this.checkpointsDir, file);
      try {
        const checkpoint: Checkpoint = JSON.parse(readFileSync(path, 'utf-8'));
        checkpoints.push(checkpoint);
      } catch {
        // Skip malformed files
      }
    }

    return checkpoints.sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }
}
