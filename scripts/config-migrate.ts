#!/usr/bin/env bun
/**
 * config-migrate.ts - Config migration utility for version upgrades
 *
 * PURPOSE: Apply version-specific transformations to settings.json during upgrades.
 * Handles renaming keys, adding defaults, removing deprecated fields.
 *
 * USAGE:
 *   bun scripts/config-migrate.ts --from v6.0 --to v6.1
 *   bun scripts/config-migrate.ts --from v6.1 --to v6.2 --dry-run
 *
 * DESIGN:
 * - Migration registry pattern: each version transition has a migration function
 * - Dry-run mode: shows what would change without writing
 * - Backup: creates settings.json.backup-<timestamp> before writing
 * - Idempotent: safe to run multiple times (checks if migration already applied)
 *
 * EXIT CODES:
 *   0 - Success (migration applied or no changes needed)
 *   1 - Error (invalid version, file not found, migration failed)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getPaiDir } from '../hooks/lib/paths';

type Settings = Record<string, any>;

interface Migration {
  name: string;
  description: string;
  apply: (settings: Settings) => Settings;
  check: (settings: Settings) => boolean;
}

// Migration Registry

const MIGRATIONS: Record<string, Migration> = {
  'v6.0->v6.1': {
    name: 'v6.0 → v6.1',
    description: 'Add hook performance monitoring defaults',
    check: (s) => s.hookPerformance !== undefined,
    apply: (s) => {
      if (!s.hookPerformance) {
        s.hookPerformance = {
          enabled: true,
          logPath: 'MEMORY/STATE/hook-perf.jsonl',
          warnThresholdMs: 200,
        };
      }
      return s;
    },
  },

  'v6.1->v6.2': {
    name: 'v6.1 → v6.2',
    description: 'Add state cleanup defaults',
    check: (s) => s.stateCleanup !== undefined,
    apply: (s) => {
      if (!s.stateCleanup) {
        s.stateCleanup = {
          enabled: true,
          ttlDays: 7,
          preservePinned: true,
        };
      }
      return s;
    },
  },

  'v6.2->v6.3': {
    name: 'v6.2 → v6.3',
    description: 'Add session-end tracking and sync-drift config',
    check: (s) => s.sessionEndTracking !== undefined,
    apply: (s) => {
      if (!s.sessionEndTracking) {
        s.sessionEndTracking = {
          enabled: true,
          sentinelDir: 'MEMORY/STATE/session-end',
        };
      }
      return s;
    },
  },
};

// Version chains (for multi-step migrations)
const VERSION_CHAINS: Record<string, string[]> = {
  'v6.0': ['v6.0->v6.1', 'v6.1->v6.2', 'v6.2->v6.3'],
  'v6.1': ['v6.1->v6.2', 'v6.2->v6.3'],
  'v6.2': ['v6.2->v6.3'],
};

function parseVersion(v: string): string {
  const match = v.match(/^v?(\d+)\.(\d+)/);
  if (!match) throw new Error(`Invalid version format: ${v}`);
  return `v${match[1]}.${match[2]}`;
}

function loadSettings(path: string): Settings {
  if (!existsSync(path)) {
    console.error(`Error: settings.json not found at ${path}`);
    process.exit(1);
  }

  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (err) {
    console.error(`Error parsing settings.json: ${err}`);
    process.exit(1);
  }
}

function saveSettings(path: string, settings: Settings, dryRun: boolean): void {
  if (dryRun) {
    console.log('\nDry-run mode: would write to settings.json:');
    console.log(JSON.stringify(settings, null, 2));
    return;
  }

  // Create backup
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${path}.backup-${timestamp}`;
  const original = readFileSync(path, 'utf-8');
  writeFileSync(backupPath, original, 'utf-8');
  console.log(`\nBackup created: ${backupPath}`);

  // Write updated settings
  writeFileSync(path, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  console.log(`Settings updated: ${path}`);
}

function applyMigrations(settings: Settings, migrations: Migration[]): { settings: Settings; applied: string[] } {
  let current = { ...settings };
  const applied: string[] = [];

  for (const migration of migrations) {
    if (migration.check(current)) {
      console.log(`  ⏭️  ${migration.name}: already applied (skipping)`);
      continue;
    }

    console.log(`  🔧 ${migration.name}: ${migration.description}`);
    current = migration.apply(current);
    applied.push(migration.name);
  }

  return { settings: current, applied };
}

async function main() {
  const args = process.argv.slice(2);

  const fromIdx = args.indexOf('--from');
  const toIdx = args.indexOf('--to');
  const dryRun = args.includes('--dry-run');

  if (fromIdx === -1 || toIdx === -1) {
    console.error('Usage: bun scripts/config-migrate.ts --from <version> --to <version> [--dry-run]');
    console.error('');
    console.error('Examples:');
    console.error('  bun scripts/config-migrate.ts --from v6.0 --to v6.1');
    console.error('  bun scripts/config-migrate.ts --from v6.1 --to v6.3 --dry-run');
    process.exit(1);
  }

  const fromVersion = parseVersion(args[fromIdx + 1]);
  const toVersion = parseVersion(args[toIdx + 1]);

  console.log(`\n=== Config Migration: ${fromVersion} → ${toVersion} ===\n`);

  const paiDir = getPaiDir();
  const settingsPath = join(paiDir, 'settings.json');

  const settings = loadSettings(settingsPath);

  // Find migration chain
  const chain = VERSION_CHAINS[fromVersion];
  if (!chain) {
    console.error(`Error: No migration path defined for ${fromVersion}`);
    console.error(`Available starting versions: ${Object.keys(VERSION_CHAINS).join(', ')}`);
    process.exit(1);
  }

  // Filter chain to target version
  const toMajorMinor = toVersion;
  const relevantMigrations: Migration[] = [];

  for (const key of chain) {
    const migration = MIGRATIONS[key];
    if (!migration) {
      console.error(`Error: Migration not found: ${key}`);
      process.exit(1);
    }
    relevantMigrations.push(migration);

    // Stop when we reach the target version
    const [, toVer] = key.split('->');
    if (toVer === toMajorMinor) break;
  }

  if (relevantMigrations.length === 0) {
    console.log('No migrations needed (already at target version).');
    process.exit(0);
  }

  console.log('Migrations to apply:');
  for (const m of relevantMigrations) {
    console.log(`  - ${m.name}: ${m.description}`);
  }
  console.log('');

  // Apply migrations
  const { settings: updated, applied } = applyMigrations(settings, relevantMigrations);

  if (applied.length === 0) {
    console.log('No changes needed (all migrations already applied).');
    process.exit(0);
  }

  console.log(`\n${applied.length} migration(s) applied.`);

  // Save
  saveSettings(settingsPath, updated, dryRun);

  if (!dryRun) {
    console.log('\nMigration complete. Review settings.json and test before committing.');
  } else {
    console.log('\nDry-run complete. Run without --dry-run to apply changes.');
  }

  console.log('');
  process.exit(0);
}

if (import.meta.main) {
  main();
}
