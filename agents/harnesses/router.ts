/**
 * router.ts — Signal-based harness selection
 *
 * Selects the appropriate harness based on lightweight routing signals.
 * Signal construction is cheap: no deep task analysis needed.
 *
 * Routing priority (highest to lowest):
 *   1. Explicit preference (preferredHarness) — always wins
 *   2. Privacy constraint (sensitive → local)
 *   3. Capability match (hasImages → gemini, code-gen → codex)
 *   4. Default: claude
 */

import type { RoutingSignals, OrchestrationConfig } from './harness';
import { readFileSync } from 'fs';
import { join } from 'path';

interface HarnessConfigEntry {
  defaultModel?: string;
  executionMode: 'local' | 'remote';
}

interface RoutingConfig {
  defaultHarness: string;
  imageHarness: string;
  sensitivePrivacyHarness: string;
  codeGenHarness: string;
}

interface HarnessConfig {
  harnesses: Record<string, HarnessConfigEntry>;
  routing: RoutingConfig;
}

function loadConfig(): HarnessConfig {
  try {
    const configPath = join(import.meta.dir, 'config.json');
    return JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    // Fallback defaults if config.json is missing
    return {
      harnesses: {
        claude: { executionMode: 'remote' },
        'claude-code': { executionMode: 'local' },
        gemini: { executionMode: 'remote' },
        codex: { executionMode: 'remote' },
        local: { executionMode: 'local' },
      },
      routing: {
        defaultHarness: 'claude',
        imageHarness: 'gemini',
        sensitivePrivacyHarness: 'local',
        codeGenHarness: 'codex',
      },
    };
  }
}

export function selectHarness(signals: RoutingSignals = {}): OrchestrationConfig {
  const config = loadConfig();
  const routing = config.routing;
  const harnesses = config.harnesses;

  // Priority 1: Explicit preference always wins
  if (signals.preferredHarness) {
    const h = harnesses[signals.preferredHarness];
    return {
      harness: signals.preferredHarness,
      executionMode: h?.executionMode ?? 'remote',
      model: h?.defaultModel,
      fallback: 'claude',
    };
  }

  // Priority 2: Privacy constraint
  if (signals.privacyLevel === 'sensitive') {
    const h = harnesses[routing.sensitivePrivacyHarness];
    return {
      harness: routing.sensitivePrivacyHarness,
      executionMode: h?.executionMode ?? 'local',
      model: h?.defaultModel,
      fallback: 'claude',
    };
  }

  // Priority 3: Capability match
  if (signals.hasImages) {
    const h = harnesses[routing.imageHarness];
    return {
      harness: routing.imageHarness,
      executionMode: h?.executionMode ?? 'remote',
      model: h?.defaultModel,
      fallback: 'claude',
    };
  }

  if (signals.taskType === 'code-gen') {
    const h = harnesses[routing.codeGenHarness];
    return {
      harness: routing.codeGenHarness,
      executionMode: h?.executionMode ?? 'remote',
      model: h?.defaultModel,
      fallback: 'claude',
    };
  }

  // Priority 4: Default
  const h = harnesses[routing.defaultHarness];
  return {
    harness: routing.defaultHarness,
    executionMode: h?.executionMode ?? 'remote',
    model: h?.defaultModel,
  };
}
