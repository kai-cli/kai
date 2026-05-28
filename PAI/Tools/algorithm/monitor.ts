/**
 * algorithm/monitor.ts - Meta-cognitive monitor for Algorithm output
 *
 * A post-generation linter that checks Algorithm output against policies
 * extracted from user feedback memories. Each policy is a testable check
 * function with low false-positive rates.
 *
 * Design Principles:
 * - Policies have LOW false-positive rates (better to miss than annoy)
 * - Each check is independently testable with known-bad inputs
 * - The monitor is advisory (returns violations but doesn't block)
 * - Context matters - some checks only apply in certain modes
 */

export interface PolicyCheck {
  id: string;
  name: string;
  description: string;
  check: (output: string, context: MonitorContext) => PolicyViolation | null;
}

export interface PolicyViolation {
  policyId: string;
  severity: 'warning' | 'error';
  message: string;
  suggestion: string;
}

export interface MonitorContext {
  sessionMessages: number;
  hasToolCalls: boolean;
  hasTests: boolean;
  mode: 'native' | 'algorithm' | 'minimal';
}

// ─── Policy Checks ───────────────────────────────────────────────────────────

const policies: PolicyCheck[] = [
  {
    id: 'no-trailing-summary',
    name: 'No trailing summary paragraphs',
    description: 'Output should not end with summary paragraphs restating what was done',
    check: (output: string, context: MonitorContext) => {
      // Look for trailing summary patterns at the end of output
      const lines = output.trim().split('\n');
      const lastLines = lines.slice(-5).join('\n').toLowerCase();

      // Common summary phrases that often appear as unnecessary recaps
      const summaryPatterns = [
        /in summary,?/i,
        /to summarize,?/i,
        /in conclusion,?/i,
        /this completes the/i,
        /we have successfully/i,
        /the changes include:/i,
        /these changes ensure/i,
      ];

      // Only flag if we have a substantial output and it ends with summary language
      if (lines.length > 10 && summaryPatterns.some(p => p.test(lastLines))) {
        return {
          policyId: 'no-trailing-summary',
          severity: 'warning',
          message: 'Output appears to end with a summary paragraph',
          suggestion: 'Users read diffs; avoid restating what changed. End with status or next steps instead.',
        };
      }
      return null;
    },
  },

  {
    id: 'verify-by-running',
    name: 'Verification requires executable evidence',
    description: 'Claims of "verified" or "confirmed" must include evidence from running commands',
    check: (output: string, context: MonitorContext) => {
      // Look for verification claims
      const verificationClaims = [
        /✅\s*VERIFY/i,
        /verified that/i,
        /confirmed that/i,
        /validation complete/i,
        /all checks pass/i,
      ];

      const hasVerificationClaim = verificationClaims.some(p => p.test(output));
      if (!hasVerificationClaim) return null;

      // Look for evidence of running commands
      const executionEvidence = [
        /test.*pass(ed|ing)/i,
        /\d+\/\d+/i,  // Test ratios
        /\d+\s*tests?\s*pass/i,
        /grep.*found/i,
        /grep.*\d+\s*match/i,
        /no matches/i,
        /0\s*(results?|matches?|occurrences?)/i,
        /exit code/i,
        /✓.*tests?/i,
        /\$ /,  // Shell prompt
        />>/,   // Command output
      ];

      const hasEvidence = executionEvidence.some(p => p.test(output));

      if (!hasEvidence) {
        return {
          policyId: 'verify-by-running',
          severity: 'error',
          message: 'Verification claim without executable evidence',
          suggestion: 'Include output from tests, grep sweeps, or other mechanical checks. Reading is not verification.',
        };
      }
      return null;
    },
  },

  {
    id: 'sweep-not-spot-fix',
    name: 'Renames require tree-wide sweep evidence',
    description: 'After renames/removals, must show grep evidence of full tree sweep',
    check: (output: string, context: MonitorContext) => {
      // Look for significant rename/removal language (functions, classes, files)
      // Avoid flagging minor config changes or algorithm version numbers
      const renamePatterns = [
        /renamed?\s+(?!OBSERVE|ORIENT|DECIDE|ACT|VERIFY)[A-Z]\w+\s+to\s+\w+/i,
        /removed?\s+(?!examples?|tokens?)\w+\s+(function|class|file|module)/i,
        /deleted?\s+\w+\.(ts|js|tsx|jsx|md)/i,
        /replaced?\s+\w+Function\s+with\s+\w+/i,
      ];

      const hasRename = renamePatterns.some(p => p.test(output));
      if (!hasRename) return null;

      // Look for tree-wide sweep evidence
      const sweepEvidence = [
        /grep.*-r/i,
        /find.*-name/i,
        /searched? (the )?entire/i,
        /no remaining/i,
        /0 occurrences?/i,
        /no matches in/i,
        /swept (the )?tree/i,
        /\d+\s+match(es)?/i,
      ];

      const hasSwept = sweepEvidence.some(p => p.test(output));

      if (!hasSwept) {
        return {
          policyId: 'sweep-not-spot-fix',
          severity: 'error',
          message: 'Rename/removal without tree-wide sweep evidence',
          suggestion: 'After any rename or removal, grep the full tree for old values. Show zero remaining matches.',
        };
      }
      return null;
    },
  },

  {
    id: 'describe-before-acting',
    name: 'Review input requires description before action',
    description: 'Reviews/critiques should describe intent and wait for explicit authorization',
    check: (output: string, context: MonitorContext) => {
      // This is hard to detect post-hoc since we're looking at output.
      // Better checked at input processing time, but we can flag if output
      // shows immediate action on what looks like review language.

      // Look for review-like phrases followed immediately by action
      const reviewTriggers = [
        /required edits/i,
        /before approval/i,
        /needs? changes?/i,
        /must fix/i,
      ];

      const actionIndicators = [
        /\[Edit\]/i,
        /\[Write\]/i,
        /modified:/i,
        /changed:/i,
        /updated? file/i,
      ];

      const hasReviewLanguage = reviewTriggers.some(p => p.test(output));
      const hasImmediateAction = actionIndicators.some(p => p.test(output));

      // Only flag if both present and no "Here's what I'd change" bridge
      if (hasReviewLanguage && hasImmediateAction && !/here's what i('d| would)/i.test(output)) {
        return {
          policyId: 'describe-before-acting',
          severity: 'error',
          message: 'Appears to act on review input without describing intent first',
          suggestion: 'When input looks like a review, respond with "Here\'s what I\'d change: [summary]. Want me to go ahead?"',
        };
      }
      return null;
    },
  },

  {
    id: 'simple-commands',
    name: 'Prefer simple commands over compound pipelines',
    description: 'Avoid long compound bash pipelines when simple commands suffice',
    check: (output: string, context: MonitorContext) => {
      if (!context.hasToolCalls) return null;

      // Look for long compound commands (3+ pipes or 3+ && chains)
      const commandPatterns = [
        /\|\s*[^|]+\|\s*[^|]+\|/,  // 3+ pipes
        /&&\s*[^&]+&&\s*[^&]+&&/,   // 3+ && chains
      ];

      // Check for these in what looks like bash command context
      if (commandPatterns.some(p => p.test(output))) {
        return {
          policyId: 'simple-commands',
          severity: 'warning',
          message: 'Output contains compound bash pipelines',
          suggestion: 'Use simple, single-purpose commands. If commands are independent, use parallel Bash calls.',
        };
      }
      return null;
    },
  },

  {
    id: 'no-over-asking',
    name: 'Don\'t ask permission for obvious next steps',
    description: 'When intent is clear, proceed without asking (unless risky operation)',
    check: (output: string, context: MonitorContext) => {
      // Look for unnecessary permission requests
      const unnecessaryQuestions = [
        /should i commit/i,
        /want me to commit/i,
        /should i push/i,
        /want me to push/i,
        /ok to commit/i,
      ];

      // Exception: these are legitimately risky or asking questions is appropriate
      const riskyOperations = [
        /force.*push/i,
        /push.*main/i,
        /push.*master/i,
        /delete.*branch/i,
      ];

      const appropriateQuestions = [
        /ready to/i,  // "Ready to commit?" is a status check, not over-asking
      ];

      const hasUnnecessaryQuestion = unnecessaryQuestions.some(p => p.test(output));
      const hasRiskyOp = riskyOperations.some(p => p.test(output));
      const isAppropriate = appropriateQuestions.some(p => p.test(output));

      // Only flag if asking about routine ops, not risky ones or appropriate contexts
      if (hasUnnecessaryQuestion && !hasRiskyOp && !isAppropriate) {
        return {
          policyId: 'no-over-asking',
          severity: 'warning',
          message: 'Asking permission for obvious next step',
          suggestion: 'If user would be surprised you DIDN\'T do it, just do it. Reserve confirmation for risky operations.',
        };
      }
      return null;
    },
  },

  {
    id: 'signal-verification-phases',
    name: 'Announce verification phase transitions',
    description: 'When switching from editing to verifying, explicitly state it',
    check: (output: string, context: MonitorContext) => {
      // Only check in algorithm mode
      if (context.mode !== 'algorithm') return null;

      // Look for verification activities without signaling
      // Must have both VERIFY section AND evidence of editing before it
      const hasVerifySection = /✅\s*VERIFY/i.test(output);
      if (!hasVerifySection) return null;

      const hasEditing = /🔧\s*CHANGE/i.test(output) || /\[Edit\]/i.test(output) || /\[Write\]/i.test(output);
      if (!hasEditing) return null; // No editing before verify, so no transition to signal

      const phaseSignals = [
        /verifying now/i,
        /verification phase/i,
        /now verifying/i,
        /starting verification/i,
        /edits done.*verif/i,
      ];

      const hasSignal = phaseSignals.some(p => p.test(output));

      // Only flag if we edited AND verified without signaling the transition
      if (!hasSignal) {
        return {
          policyId: 'signal-verification-phases',
          severity: 'warning',
          message: 'Verification activity without phase transition signal',
          suggestion: 'After finishing edits, say "Edits done. Verifying..." before starting verification.',
        };
      }
      return null;
    },
  },

  {
    id: 'gates-must-fail',
    name: 'Test that verification gates actually fail',
    description: 'When implementing gates/checks, must test that they catch failures',
    check: (output: string, context: MonitorContext) => {
      // Look for gate/check implementation
      const gateImplementation = [
        /verification gate/i,
        /added.*check/i,
        /created.*check/i,
        /implemented.*gate/i,
        /new.*validation/i,
      ];

      const hasGateImpl = gateImplementation.some(p => p.test(output));
      if (!hasGateImpl) return null;

      // Look for evidence of testing the gate with failure case
      const failureTest = [
        /deliberately (broke|break|trigger)/i,
        /test.*fail/i,
        /confirmed.*catches?/i,
        /verified.*detects?/i,
        /gate.*fails? when/i,
      ];

      const hasFailureTest = failureTest.some(p => p.test(output));

      if (!hasFailureTest) {
        return {
          policyId: 'gates-must-fail',
          severity: 'error',
          message: 'Implemented gate without testing failure case',
          suggestion: 'After creating any check/gate, deliberately break the condition and confirm it fails.',
        };
      }
      return null;
    },
  },

  {
    id: 'diagnose-before-pushing',
    name: 'Diagnose failures before suggesting push',
    description: 'Should not suggest pushing if there are unresolved failures',
    check: (output: string, context: MonitorContext) => {
      // Look for push suggestions
      const pushSuggestions = [
        /ready to push/i,
        /should.*push/i,
        /can.*push/i,
        /let's push/i,
        /pushing to/i,
      ];

      const hasPushSuggestion = pushSuggestions.some(p => p.test(output));
      if (!hasPushSuggestion) return null;

      // Look for unresolved failures
      const failureIndicators = [
        /failed/i,
        /error:/i,
        /\d+ failing/i,
        /test.*fail/i,
        /ci.*fail/i,
      ];

      const hasFailure = failureIndicators.some(p => p.test(output));

      if (hasFailure) {
        return {
          policyId: 'diagnose-before-pushing',
          severity: 'error',
          message: 'Suggesting push while failures are present',
          suggestion: 'Diagnose and fix failures locally before pushing. Never push speculative fixes.',
        };
      }
      return null;
    },
  },

  {
    id: 'no-empty-verify',
    name: 'Verify sections must contain specific evidence',
    description: 'VERIFY sections should show concrete evidence, not generic claims',
    check: (output: string, context: MonitorContext) => {
      // Look for VERIFY sections
      const verifyMatch = output.match(/✅\s*VERIFY:?\s*(.*?)(?=\n[🔧📍🗣️]|$)/is);
      if (!verifyMatch) return null;

      const verifySection = verifyMatch[1];

      // Check if it's too generic (short and no specifics)
      const hasSpecifics = [
        /\d+\s*(test|match|occurrence|file)/i,  // Specific counts
        /\d+\/\d+/,  // Ratios like 1398/1398
        /pass(ed|ing)/i,
        /fail(ed|ing)/i,
        /found/i,
        /output:/i,
        />>/,
        /\$ /,
        /grep/i,
      ];

      const isEmpty = verifySection.trim().length < 15;
      const lacksSpecifics = !hasSpecifics.some(p => p.test(verifySection));

      // Only flag if really empty OR lacks any specifics whatsoever
      if (isEmpty || (verifySection.trim().length < 40 && lacksSpecifics)) {
        return {
          policyId: 'no-empty-verify',
          severity: 'warning',
          message: 'VERIFY section lacks specific evidence',
          suggestion: 'Include concrete details: test counts, grep results, command output. Avoid generic "looks good".',
        };
      }
      return null;
    },
  },

  {
    id: 'quality-over-tokens',
    name: 'Algorithm changes must demonstrate improvement',
    description: 'When proposing Algorithm changes, must show improved results not just token savings',
    check: (output: string, context: MonitorContext) => {
      // Look for Algorithm change proposals
      const algorithmChange = [
        /algorithm.*change/i,
        /improve.*algorithm/i,
        /update.*algorithm/i,
        /algorithm.*v\d+/i,
      ];

      const hasAlgorithmChange = algorithmChange.some(p => p.test(output));
      if (!hasAlgorithmChange) return null;

      // Look for token-focused justification
      const tokenFocus = [
        /save\s+\d+\s+tokens?/i,
        /reduce\s+tokens?/i,
        /token\s+economy/i,
        /fewer\s+tokens?/i,
      ];

      const hasTokenFocus = tokenFocus.some(p => p.test(output));

      // Look for quality justification
      const qualityFocus = [
        /better results?/i,
        /improved? outcomes?/i,
        /cleaner output/i,
        /more accurate/i,
        /reduces? errors?/i,
      ];

      const hasQualityFocus = qualityFocus.some(p => p.test(output));

      if (hasTokenFocus && !hasQualityFocus) {
        return {
          policyId: 'quality-over-tokens',
          severity: 'error',
          message: 'Algorithm change justified by token savings instead of quality',
          suggestion: 'Lead with "this produces better results because..." not "this saves N tokens".',
        };
      }
      return null;
    },
  },

  {
    id: 'test-hooks-actually-run',
    name: 'Modified hooks must be smoke-tested',
    description: 'When modifying hooks, must run them to verify (not just read code)',
    check: (output: string, context: MonitorContext) => {
      // Look for hook modifications
      const hookMod = [
        /modified.*hook/i,
        /updated.*hook/i,
        /restored.*hook/i,
        /created.*hook/i,
        /hooks?\/\w+\.hook\.ts/,
      ];

      const hasHookMod = hookMod.some(p => p.test(output));
      if (!hasHookMod) return null;

      // Look for evidence of running the hook
      const hookTest = [
        /bun hooks?\//i,
        /ran.*hook/i,
        /smoke test/i,
        /verified.*runs?/i,
        /no import errors?/i,
      ];

      const hasTest = hookTest.some(p => p.test(output));

      if (!hasTest) {
        return {
          policyId: 'test-hooks-actually-run',
          severity: 'error',
          message: 'Modified hook without running smoke test',
          suggestion: 'Run `bun hooks/HookName.hook.ts < /dev/null` to verify no import errors before committing.',
        };
      }
      return null;
    },
  },
];

// ─── Monitor API ─────────────────────────────────────────────────────────────

/**
 * Run all policy checks against the output.
 * Returns array of violations (empty if all policies pass).
 */
export function runMonitor(output: string, context: MonitorContext): PolicyViolation[] {
  const violations: PolicyViolation[] = [];

  for (const policy of policies) {
    const violation = policy.check(output, context);
    if (violation) {
      violations.push(violation);
    }
  }

  return violations;
}

/**
 * Get all available policy checks (useful for documentation/introspection).
 */
export function getPolicies(): PolicyCheck[] {
  return [...policies];
}

/**
 * Get a specific policy by ID.
 */
export function getPolicy(id: string): PolicyCheck | undefined {
  return policies.find(p => p.id === id);
}

/**
 * Format violations as human-readable text.
 */
export function formatViolations(violations: PolicyViolation[]): string {
  if (violations.length === 0) {
    return '✓ All policy checks passed';
  }

  const lines: string[] = [
    `⚠️  ${violations.length} policy violation${violations.length > 1 ? 's' : ''} detected:\n`,
  ];

  for (const v of violations) {
    const icon = v.severity === 'error' ? '❌' : '⚠️';
    lines.push(`${icon} [${v.policyId}] ${v.message}`);
    lines.push(`   → ${v.suggestion}\n`);
  }

  return lines.join('\n');
}
