/**
 * secret-patterns.ts — Shared secret-detection patterns (single source).
 *
 * The UNION of what SecretScanner (UserPromptSubmit, scans user prompts) and SecretOutputDetector
 * (PostToolUse, scans tool output) each used to hardcode separately. Consolidated 2026-06-08 so the two
 * detectors can never drift apart (the SF-10/SF-28 anti-drift principle, applied to secret shapes).
 *
 * These are SECRET SHAPES (api keys, tokens, private keys) — distinct from identity-PII, which lives in
 * scripts/pii-patterns.json. Patterns are intentionally broad; detection is warn-only, so false positives
 * are acceptable.
 *
 * Both consumers import SECRET_PATTERNS from here. SecretOutputDetector re-exports it (+ scanForSecrets)
 * for its existing test + the SecurityAuditLoop log contract.
 */

export interface SecretPattern {
  name: string;
  pattern: RegExp;
}

export const SECRET_PATTERNS: SecretPattern[] = [
  // API Keys (generic)
  { name: 'API key (generic)', pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"]?[A-Za-z0-9_\-]{20,}['"]?/i },

  // AWS
  { name: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'AWS Secret Key', pattern: /(?:aws[_-]?secret|secret[_-]?access[_-]?key)\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/i },
  { name: 'AWS Account ID (in AWS_PROFILE context)', pattern: /(?:Account|account_id|AccountId)\s*[:=]\s*['"]?\d{12}['"]?/i },
  { name: 'AWS Profile name (personal)', pattern: /AWS_PROFILE\s*[:=]\s*['"]?[A-Za-z][A-Za-z0-9_.-]{4,}['"]?/i },

  // Anthropic / OpenAI
  { name: 'Anthropic API Key', pattern: /sk-ant-[A-Za-z0-9_\-]{40,}/ },
  { name: 'OpenAI API Key', pattern: /sk-[A-Za-z0-9]{40,}/ },

  // GitHub
  { name: 'GitHub Token', pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/ },
  { name: 'GitHub Classic Token', pattern: /ghp_[A-Za-z0-9]{36}/ },

  // Generic tokens / auth
  { name: 'Bearer token', pattern: /[Bb]earer\s+[A-Za-z0-9_\-\.]{20,}/ },
  { name: 'Authorization header', pattern: /[Aa]uthorization\s*[:=]\s*['"]?(?:Bearer|Basic|Token)\s+[A-Za-z0-9_\-\.+=]{10,}['"]?/i },

  // Passwords
  { name: 'Password assignment', pattern: /(?:password|passwd|pass)\s*[:=]\s*['"][^'"]{8,}['"]/i },
  { name: 'Password in env/config', pattern: /(?:PASSWORD|PASSWD|SECRET)\s*=\s*['"]?[^\s'"]{8,}['"]?/ },
  { name: 'Connection string with password', pattern: /(?:mongodb|postgres|mysql|redis):\/\/[^:]+:[^@]{8,}@/i },

  // Private keys — both names kept so neither consumer's existing contract breaks. The header form is
  // Scanner's (broader: RSA/EC/DSA/OPENSSH); the block form is Detector's (its test asserts this name).
  { name: 'Private key header', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'Private key block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },

  // Slack
  { name: 'Slack token', pattern: /xox[bpras]-[0-9]{10,}-[A-Za-z0-9]{10,}/ },

  // Generic secret/token assignment
  { name: 'Secret assignment', pattern: /(?:secret|token|credential)\s*[:=]\s*['"]?[A-Za-z0-9_\-]{20,}['"]?/i },
];
