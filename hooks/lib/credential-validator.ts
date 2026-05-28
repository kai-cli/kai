/**
 * credential-validator.ts — Generalized credential validation system
 *
 * Validates that required credentials (env vars, API keys, etc.) are present
 * before executing workflows that depend on them. Supports declarative YAML
 * specs and optional verification commands.
 *
 * Used by: DevTeam, Deliberate, and other skills that need AWS/GitHub/etc credentials.
 */

import { readFileSync, existsSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import { spawnSync } from 'child_process';

export interface CredentialSpec {
  name: string;
  required: boolean;
  description: string;
  check?: string; // Optional verification command (e.g., "aws sts get-caller-identity")
}

export interface ValidationResult {
  valid: boolean;
  missing: string[]; // Required credentials that are missing
  warnings: string[]; // Optional credentials that are missing
}

/**
 * Validate credentials against a list of specs.
 * Checks environment variables and optionally runs verification commands.
 */
export function validateCredentials(specs: CredentialSpec[]): ValidationResult {
  const missing: string[] = [];
  const warnings: string[] = [];

  for (const spec of specs) {
    const envValue = process.env[spec.name];
    const isPresent = !!envValue;

    // If credential is missing
    if (!isPresent) {
      if (spec.required) {
        missing.push(`${spec.name}: ${spec.description}`);
      } else {
        warnings.push(`${spec.name}: ${spec.description}`);
      }
      continue;
    }

    // If credential is present and has a check command, verify it works
    if (spec.check) {
      try {
        const result = spawnSync(spec.check, {
          shell: true,
          timeout: 3000,
          stdio: 'pipe',
        });

        if (result.status !== 0) {
          if (spec.required) {
            missing.push(`${spec.name}: present but verification failed (${spec.check})`);
          } else {
            warnings.push(`${spec.name}: present but verification failed (${spec.check})`);
          }
        }
      } catch (error) {
        if (spec.required) {
          missing.push(`${spec.name}: present but verification errored (${spec.check})`);
        } else {
          warnings.push(`${spec.name}: present but verification errored (${spec.check})`);
        }
      }
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    warnings,
  };
}

/**
 * Load credential specs from a YAML file.
 *
 * Expected format:
 * ```yaml
 * credentials:
 *   - name: AWS_PROFILE
 *     required: false
 *     description: AWS profile for Bedrock API access
 *     check: aws sts get-caller-identity
 *   - name: GITHUB_TOKEN
 *     required: true
 *     description: GitHub API token for PR operations
 * ```
 */
export function loadCredentialSpecs(yamlPath: string): CredentialSpec[] {
  if (!existsSync(yamlPath)) {
    throw new Error(`Credential spec file not found: ${yamlPath}`);
  }

  try {
    const content = readFileSync(yamlPath, 'utf-8');
    const parsed = parseYaml(content) as { credentials?: CredentialSpec[] };

    if (!parsed.credentials || !Array.isArray(parsed.credentials)) {
      throw new Error(`Invalid credentials YAML: missing or invalid 'credentials' array`);
    }

    // Validate each spec has required fields
    for (const spec of parsed.credentials) {
      if (!spec.name || typeof spec.required !== 'boolean' || !spec.description) {
        throw new Error(`Invalid credential spec: ${JSON.stringify(spec)}`);
      }
    }

    return parsed.credentials;
  } catch (error) {
    throw new Error(`Failed to parse credentials YAML: ${error}`);
  }
}

/**
 * Format validation result for user display.
 */
export function formatValidationResult(result: ValidationResult): string {
  const lines: string[] = [];

  if (result.missing.length > 0) {
    lines.push('Missing required credentials:');
    for (const item of result.missing) {
      lines.push(`  - ${item}`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push('');
    lines.push('Optional credentials not configured (fallback behavior will be used):');
    for (const item of result.warnings) {
      lines.push(`  - ${item}`);
    }
  }

  return lines.join('\n');
}
