#!/usr/bin/env bun
/**
 * settings-validate.ts — Validate settings.json against the canonical schema
 *
 * Usage:
 *   bun scripts/settings-validate.ts                   Validate ~/.claude/settings.json
 *   bun scripts/settings-validate.ts --path <file>     Validate a specific file
 *   bun scripts/settings-validate.ts --json            Output result as JSON
 *
 * Exit codes: 0 = valid, 1 = invalid or not found
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { SETTINGS_SCHEMA } from './settings-schema';

// ── Types ──────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ── Lightweight structural validator ─────────────────────────
// Validates a subset of JSON Schema draft 2020-12:
// type, enum, properties, additionalProperties, propertyNames, required, items, $ref

type Schema = Record<string, unknown>;
type Defs = Record<string, Schema>;

function resolveRef(ref: string, defs: Defs): Schema | null {
  const match = ref.match(/^#\/\$defs\/(.+)$/);
  if (!match) return null;
  return defs[match[1]] ?? null;
}

function validateValue(
  value: unknown,
  schema: Schema,
  defs: Defs,
  path: string,
  errors: string[],
  warnings: string[]
): void {
  if ('$ref' in schema) {
    const resolved = resolveRef(schema['$ref'] as string, defs);
    if (resolved) {
      validateValue(value, resolved, defs, path, errors, warnings);
    }
    return;
  }

  const schemaType = schema['type'] as string | undefined;

  // type check
  if (schemaType) {
    const actualType = Array.isArray(value) ? 'array' : typeof value === 'object' && value !== null ? 'object' : typeof value;
    if (actualType !== schemaType) {
      errors.push(`${path}: expected ${schemaType}, got ${actualType}`);
      return;
    }
  }

  // enum check
  if ('enum' in schema) {
    const allowed = schema['enum'] as unknown[];
    if (!allowed.includes(value)) {
      errors.push(`${path}: value ${JSON.stringify(value)} not in enum [${allowed.map(v => JSON.stringify(v)).join(', ')}]`);
    }
    return;
  }

  if (schemaType === 'object' && value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const props = (schema['properties'] as Record<string, Schema>) ?? {};
    const additionalProps = schema['additionalProperties'];
    const required = (schema['required'] as string[]) ?? [];
    const propertyNames = schema['propertyNames'] as Schema | undefined;

    // required fields
    for (const req of required) {
      if (!(req in obj)) {
        errors.push(`${path}: missing required field '${req}'`);
      }
    }

    // validate known properties
    for (const [key, val] of Object.entries(obj)) {
      const subPath = `${path}.${key}`;

      if (propertyNames && 'enum' in propertyNames) {
        const allowed = propertyNames['enum'] as string[];
        if (!allowed.includes(key)) {
          warnings.push(`${path}: unknown key '${key}' (not in propertyNames enum)`);
        }
      }

      if (key in props) {
        validateValue(val, props[key], defs, subPath, errors, warnings);
      } else if (additionalProps === false) {
        errors.push(`${path}: additional property '${key}' not allowed`);
      } else if (additionalProps && typeof additionalProps === 'object') {
        validateValue(val, additionalProps as Schema, defs, subPath, errors, warnings);
      }
    }
  }

  if (schemaType === 'array' && Array.isArray(value)) {
    const itemSchema = schema['items'] as Schema | undefined;
    if (itemSchema) {
      for (let i = 0; i < value.length; i++) {
        validateValue(value[i], itemSchema, defs, `${path}[${i}]`, errors, warnings);
      }
    }
  }
}

export function validateSettings(settingsObj: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const schema = SETTINGS_SCHEMA as unknown as Schema;
  const defs = (schema['$defs'] as Defs) ?? {};

  validateValue(settingsObj, schema, defs, 'settings', errors, warnings);

  return { valid: errors.length === 0, errors, warnings };
}

export function validateSettingsFile(filePath: string): ValidationResult {
  if (!existsSync(filePath)) {
    return { valid: false, errors: [`File not found: ${filePath}`], warnings: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (e) {
    return { valid: false, errors: [`Invalid JSON: ${(e as Error).message}`], warnings: [] };
  }

  return validateSettings(parsed);
}

// ── CLI entry point ───────────────────────────────────────────

if (import.meta.main) {
  const args = process.argv.slice(2);
  const pathIdx = args.indexOf('--path');
  const jsonMode = args.includes('--json');

  const defaultPath = join(homedir(), '.claude', 'settings.json');
  const targetPath = pathIdx !== -1 ? args[pathIdx + 1] : defaultPath;

  if (!targetPath) {
    console.error('Usage: bun scripts/settings-validate.ts [--path <file>] [--json]');
    process.exit(1);
  }

  const result = validateSettingsFile(targetPath);

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.valid) {
    console.log(`OK — ${targetPath} is valid (${result.warnings.length} warnings)`);
    if (result.warnings.length > 0) {
      for (const w of result.warnings) {
        console.log(`  WARN: ${w}`);
      }
    }
  } else {
    console.error(`INVALID — ${targetPath} has ${result.errors.length} error(s):`);
    for (const e of result.errors) {
      console.error(`  ERROR: ${e}`);
    }
    if (result.warnings.length > 0) {
      for (const w of result.warnings) {
        console.log(`  WARN: ${w}`);
      }
    }
  }

  process.exit(result.valid ? 0 : 1);
}
