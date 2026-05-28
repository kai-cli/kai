/**
 * CredentialValidator.test.ts - Test generalized credential validation system
 */

import { test, expect, beforeAll, afterAll } from 'bun:test';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  validateCredentials,
  loadCredentialSpecs,
  formatValidationResult,
  type CredentialSpec,
} from '../hooks/lib/credential-validator';

const TEST_DIR = join(tmpdir(), `credential-validator-test-${Date.now()}`);

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

test('validateCredentials detects missing required credentials', () => {
  const specs: CredentialSpec[] = [
    { name: 'REQUIRED_VAR', required: true, description: 'A required variable' },
    { name: 'OPTIONAL_VAR', required: false, description: 'An optional variable' },
  ];

  // Clear env vars to ensure they're missing
  delete process.env.REQUIRED_VAR;
  delete process.env.OPTIONAL_VAR;

  const result = validateCredentials(specs);

  expect(result.valid).toBe(false);
  expect(result.missing.length).toBe(1);
  expect(result.missing[0]).toContain('REQUIRED_VAR');
  expect(result.warnings.length).toBe(1);
  expect(result.warnings[0]).toContain('OPTIONAL_VAR');
});

test('validateCredentials succeeds when all required credentials present', () => {
  const specs: CredentialSpec[] = [
    { name: 'PRESENT_VAR', required: true, description: 'A present variable' },
  ];

  process.env.PRESENT_VAR = 'test-value';

  const result = validateCredentials(specs);

  expect(result.valid).toBe(true);
  expect(result.missing.length).toBe(0);

  delete process.env.PRESENT_VAR;
});

test('validateCredentials warns on missing optional credentials', () => {
  const specs: CredentialSpec[] = [
    { name: 'OPTIONAL_VAR_1', required: false, description: 'Optional 1' },
    { name: 'OPTIONAL_VAR_2', required: false, description: 'Optional 2' },
  ];

  delete process.env.OPTIONAL_VAR_1;
  delete process.env.OPTIONAL_VAR_2;

  const result = validateCredentials(specs);

  expect(result.valid).toBe(true); // Still valid if only optional missing
  expect(result.missing.length).toBe(0);
  expect(result.warnings.length).toBe(2);
});

test('validateCredentials runs verification command when present', () => {
  const specs: CredentialSpec[] = [
    {
      name: 'VERIFIED_VAR',
      required: true,
      description: 'Variable with verification',
      check: 'echo "test"', // Simple command that always succeeds
    },
  ];

  process.env.VERIFIED_VAR = 'test-value';

  const result = validateCredentials(specs);

  expect(result.valid).toBe(true);
  expect(result.missing.length).toBe(0);

  delete process.env.VERIFIED_VAR;
});

test('validateCredentials detects verification command failure', () => {
  const specs: CredentialSpec[] = [
    {
      name: 'FAILING_VAR',
      required: true,
      description: 'Variable with failing check',
      check: 'exit 1', // Command that always fails
    },
  ];

  process.env.FAILING_VAR = 'test-value';

  const result = validateCredentials(specs);

  expect(result.valid).toBe(false);
  expect(result.missing.length).toBe(1);
  expect(result.missing[0]).toContain('verification failed');

  delete process.env.FAILING_VAR;
});

test('loadCredentialSpecs parses valid YAML', () => {
  const yamlPath = join(TEST_DIR, 'test-credentials.yaml');
  const yamlContent = `
credentials:
  - name: TEST_VAR_1
    required: true
    description: First test variable
  - name: TEST_VAR_2
    required: false
    description: Second test variable
    check: echo "test"
`;

  writeFileSync(yamlPath, yamlContent);

  const specs = loadCredentialSpecs(yamlPath);

  expect(specs.length).toBe(2);
  expect(specs[0].name).toBe('TEST_VAR_1');
  expect(specs[0].required).toBe(true);
  expect(specs[1].name).toBe('TEST_VAR_2');
  expect(specs[1].required).toBe(false);
  expect(specs[1].check).toBe('echo "test"');
});

test('loadCredentialSpecs throws on missing file', () => {
  const missingPath = join(TEST_DIR, 'nonexistent.yaml');

  expect(() => loadCredentialSpecs(missingPath)).toThrow('not found');
});

test('loadCredentialSpecs throws on invalid YAML structure', () => {
  const yamlPath = join(TEST_DIR, 'invalid-credentials.yaml');
  const yamlContent = `
# Missing credentials array
invalid_key: value
`;

  writeFileSync(yamlPath, yamlContent);

  expect(() => loadCredentialSpecs(yamlPath)).toThrow('missing or invalid');
});

test('formatValidationResult produces readable output', () => {
  const result = {
    valid: false,
    missing: ['REQUIRED_VAR: This is required', 'ANOTHER_VAR: Also required'],
    warnings: ['OPTIONAL_VAR: This is optional'],
  };

  const formatted = formatValidationResult(result);

  expect(formatted).toContain('Missing required credentials:');
  expect(formatted).toContain('REQUIRED_VAR');
  expect(formatted).toContain('ANOTHER_VAR');
  expect(formatted).toContain('Optional credentials not configured');
  expect(formatted).toContain('OPTIONAL_VAR');
});

test('DevTeam credentials.yaml has valid structure', () => {
  const credentialsPath = join(process.cwd(), 'skills', 'DevTeam', 'credentials.yaml');

  // This test verifies the actual DevTeam credentials file is valid
  expect(() => loadCredentialSpecs(credentialsPath)).not.toThrow();

  const specs = loadCredentialSpecs(credentialsPath);
  expect(specs.length).toBeGreaterThan(0);

  // Verify AWS_PROFILE is included
  const awsSpec = specs.find(s => s.name === 'AWS_PROFILE');
  expect(awsSpec).toBeDefined();
  expect(awsSpec?.required).toBe(false); // AWS_PROFILE is optional (falls back to adversarial)
});
