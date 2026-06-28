#!/usr/bin/env bash
# KAI Release Gate — refuses to tag unless every check passes.
# Usage: bash scripts/release.sh <version>
#   e.g. bash scripts/release.sh v5.1.0
set -euo pipefail

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  echo "Usage: bash scripts/release.sh <version>"
  echo "  e.g. bash scripts/release.sh v5.1.0"
  exit 1
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
GATE_FAIL=0

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

gate_pass() { echo -e "  ${GREEN}GATE PASS${NC} $1"; }
gate_fail() { echo -e "  ${RED}GATE FAIL${NC} $1"; GATE_FAIL=1; }
gate_skip() { echo -e "  ${YELLOW}GATE SKIP${NC} $1"; }

echo "═══════════════════════════════════════════"
echo "  KAI Release Gate — $VERSION"
echo "═══════════════════════════════════════════"
echo ""

# ── Gate 1: Clean working tree ───────────────────────────────
echo "── Gate 1: Working tree ──"
if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
  gate_fail "Working tree is dirty — commit or stash changes first"
  git status --short
else
  gate_pass "Working tree clean"
fi

# ── Gate 2: Identity check ───────────────────────────────────
echo ""
echo "── Gate 2: Git identity ──"
ACTUAL_EMAIL="$(git config user.email 2>/dev/null || echo '')"
EXPECTED_EMAIL="maintainer@kai-cli.com"
if [[ "$ACTUAL_EMAIL" != "$EXPECTED_EMAIL" ]]; then
  gate_fail "user.email is '$ACTUAL_EMAIL', expected '$EXPECTED_EMAIL'"
else
  gate_pass "user.email = $EXPECTED_EMAIL"
fi

# ── Gate 3: verify-release.sh ────────────────────────────────
# SF-15/18 fix: leak/brand checks must run against the SCRUBBED public artifact, not the private
# kai tree (where PII/brand strings live by design). verify-release.sh now splits checks into
# STRUCTURAL (run on this repo), ARTIFACT/leak-brand (run on --target), and SECRETS (run on both).
#
# Gate 4 builds a scrubbed temp KAI artifact and runs the public-boundary checks before this script can
# tag. Gate 3 still runs the source-tree structural/secrets checks directly against kai.
echo ""
echo "── Gate 3: Release verification (structural + secrets) ──"
if bash "$REPO_ROOT/scripts/verify-release.sh" 2>&1; then
  gate_pass "verify-release.sh passed"
else
  gate_fail "verify-release.sh failed — see output above"
fi

# ── Gate 4: Temp KAI artifact boundary ───────────────────────
echo ""
echo "── Gate 4: Temp KAI artifact boundary ──"
if bun "$REPO_ROOT/scripts/kai-temp-release-gate.ts" 2>&1; then
  gate_pass "Temp KAI artifact gate passed"
else
  gate_fail "Temp KAI artifact gate failed — release artifact is not safe to tag"
fi

# ── Gate 5: Test suite ───────────────────────────────────────
# Parse Bun's summary instead of grepping one substring. Retry once for the same subprocess-spawn
# flakiness this gate has historically tolerated, then fail closed on missing summaries, failures,
# crashes, or non-zero exits.
echo ""
echo "── Gate 5: Test suite ──"
TEST_OUTPUT=$(bun test 2>&1)
TEST_STATUS=$?
if ! printf '%s\n' "$TEST_OUTPUT" | bun "$REPO_ROOT/scripts/bun-test-gate.ts" --exit-code "$TEST_STATUS" --label "release bun test"; then
  echo "  Test run had failures — retrying once (subprocess spawn flakiness)..."
  TEST_OUTPUT=$(bun test 2>&1)
  TEST_STATUS=$?
  if ! printf '%s\n' "$TEST_OUTPUT" | bun "$REPO_ROOT/scripts/bun-test-gate.ts" --exit-code "$TEST_STATUS" --label "release bun test retry"; then
    gate_fail "Test suite has failures (failed on retry too) — run 'bun test' for details"
  else
    gate_pass "All tests pass (retry)"
  fi
else
  gate_pass "All tests pass"
fi

# ── Gate 6: BuildDocs freshness ──────────────────────────────
echo ""
echo "── Gate 6: BuildDocs freshness ──"
if [[ -f "$REPO_ROOT/PAI/Tools/BuildDocs.ts" ]]; then
  if bun "$REPO_ROOT/PAI/Tools/BuildDocs.ts" --check 2>&1; then
    gate_pass "All marker regions are fresh"
  else
    gate_fail "Stale marker regions — run: bun PAI/Tools/BuildDocs.ts"
  fi
else
  # Phase 2 not yet landed
  gate_skip "BuildDocs.ts not found — skipping (Phase 2 prerequisite)"
fi

# ── Gate 7: RELEASE-BLOCKERS.md ──────────────────────────────
echo ""
echo "── Gate 7: Release blockers ──"
BLOCKERS_FILE="$REPO_ROOT/docs/planning/RELEASE-BLOCKERS.md"
if [[ -f "$BLOCKERS_FILE" ]]; then
  # grep exits 1 on no-match. Under `set -euo pipefail` that 1 propagates through the pipe and kills
  # the whole script (Gate 6 dies silently before tagging). Neutralize grep's exit with `|| true`
  # INSIDE the command substitution so a zero-blocker count is a clean pass, not a fatal pipe failure.
  OPEN_BLOCKERS=$( { grep '^\- \[ \]' "$BLOCKERS_FILE" 2>/dev/null || true; } | wc -l | tr -d ' ')
  if [[ "$OPEN_BLOCKERS" -gt 0 ]]; then
    gate_fail "$OPEN_BLOCKERS open blocker(s) in RELEASE-BLOCKERS.md:"
    grep '^\- \[ \]' "$BLOCKERS_FILE" | while read -r line; do echo "    $line"; done
  else
    gate_pass "All release blockers resolved"
  fi
else
  gate_skip "RELEASE-BLOCKERS.md not found — skipping (Phase 3 prerequisite)"
fi

# ── Summary & Tag ────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════"
if [[ $GATE_FAIL -eq 1 ]]; then
  echo -e "  ${RED}RELEASE BLOCKED${NC} — fix the failures above"
  exit 1
fi

echo -e "  ${GREEN}ALL GATES PASSED${NC}"
echo ""

git tag -a "$VERSION" -m "Release $VERSION"
echo -e "  ${GREEN}Tagged: $VERSION${NC}"
echo ""
echo "  Next steps:"
echo "    git push origin $VERSION"
echo "    git push origin main"
echo ""
