/**
 * classify.ts — Deterministic mode classification logic
 *
 * Extracted from ModeClassifier.hook.ts so both the hook and tests
 * import the same function — no logic drift between hook and test suite.
 *
 * MODES:
 * - MINIMAL:     greetings, ratings (1-10), short acknowledgments
 * - INVESTIGATE: investigation verbs + technical object (produces findings, not artifacts)
 * - ALGORITHM:   build/change verbs + technical object (produces artifacts)
 * - NATIVE:      everything else
 */

export type Mode = 'MINIMAL' | 'INVESTIGATE' | 'ALGORITHM' | 'NATIVE';

export function classify(prompt: string): Mode {
  const trimmed = prompt.trim();

  // Minimal: greetings, ratings (1-10), short acknowledgments
  const isMinimal = /^(hi|hello|hey|thanks|thank you|ok|okay|done|got it|sure|yes|no|yep|nope|\d+[\s\-:]*)$/i.test(trimmed);
  if (isMinimal) return 'MINIMAL';
  if (!trimmed || trimmed.length < 2) return 'NATIVE';

  const words = trimmed.split(/\s+/);

  // INVESTIGATE: verbs that produce findings/analysis, not code changes
  // These are "read the world and report" verbs — they never commit code
  const hasInvestigateVerb = /\b(review|investigate|research|validate|assess|examine|inspect|trace|diagnose|troubleshoot|evaluate|compare|analyze|audit|check|verify|explain|understand|explore|look\s+at|look\s+into|what\s+is|how\s+does|why\s+does|tell\s+me\s+about)\b/i.test(trimmed);

  // Strong investigate intent — always INVESTIGATE regardless of Gate 2
  const hasStrongInvestigateVerb = words.length >= 2 &&
    /\b(investigate|research|review|validate|diagnose|troubleshoot|trace|examine|assess|audit)\b/i.test(trimmed);

  // Explicit build intent overrides investigate classification
  // "review and fix" or "investigate then implement" → ALGORITHM
  const hasBuildIntent = /\b(fix|implement|build|create|write|refactor|add|remove|update|deploy|configure|install|generate|scaffold|set\s+up|wire\s+up|clean\s+up)\b/i.test(trimmed);

  // Gate 2: technical object present OR multi-step complexity
  const hasTechnicalObject = /\b(codes?|files?|functions?|class(es)?|methods?|api|endpoints?|databases?|schemas?|configs?|hooks?|scripts?|tests?|builds?|deploys?|servers?|components?|modules?|services?|bugs?|errors?|features?|algorithms?|quer(y|ies)|migrations?|routes?|middleware|models?|controllers?|templates?|pipelines?|workflows?|repo|branch(es)?|commits?|containers?|packages?|dependenc(y|ies)|types?|interfaces?|structs?|system|apps?|application|auth|authentication|authorization|modes?|themes?|styles?|layouts?|pages?|views?|screens?|forms?|buttons?|widgets?|dashboards?|animations?|logic|data|state|cach(e|es)|logs?|performance|security|permissions?|roles?|users?|sessions?|tokens?|keys?|certs?|env|variables?|settings?|options?|flags?|cli|upgrade|memory|leak|integration|architecture|codebase|infrastructure|plans?|patterns?|implementations?|designs?|gaps?|weaknesses?|PRs?|pull\s+requests?|issues?|diffs?)\b/i.test(trimmed);

  const isComplex = words.length > 30 || /\b(and then|also|step|first|second|finally)\b|\d+\)/i.test(trimmed);

  // INVESTIGATE wins when: investigate verb + technical object, BUT no build intent
  // "review this PR" → INVESTIGATE
  // "review this PR and fix it" → ALGORITHM (build intent overrides)
  if ((hasStrongInvestigateVerb || (hasInvestigateVerb && (hasTechnicalObject || isComplex))) && !hasBuildIntent) {
    return 'INVESTIGATE';
  }

  // ALGORITHM: build/change verbs that produce artifacts
  const hasActionVerb = /\b(build|create|implement|fix|debug|refactor|write|design|plan|add|update|remove|set|migrate|convert|optimize|develop|configure|deploy|install|test|generate|scaffold|integrate|setup|set\s+up|run|clone)\b/i.test(trimmed);

  // Strong dev-intent verbs that always imply multi-step artifact production
  const hasStrongDevVerb = words.length >= 2 &&
    /\b(fix|debug|refactor|migrate|clean\s+up|wire\s+up|set\s+up|implement|build)\b/i.test(trimmed);

  const isAlgorithm = hasStrongDevVerb ||
    (hasActionVerb && (hasTechnicalObject || isComplex));

  return isAlgorithm ? 'ALGORITHM' : 'NATIVE';
}
