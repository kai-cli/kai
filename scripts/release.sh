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
echo ""
echo "── Gate 3: Release verification ──"
if bash "$REPO_ROOT/scripts/verify-release.sh" 2>&1; then
  gate_pass "verify-release.sh passed"
else
  gate_fail "verify-release.sh failed — see output above"
fi

# ── Gate 4: Test suite ───────────────────────────────────────
echo ""
echo "── Gate 4: Test suite ──"
if bun test 2>&1 | grep -q '0 fail'; then
  gate_pass "All tests pass"
else
  gate_fail "Test suite has failures — run 'bun test' for details"
fi

# ── Gate 5: BuildDocs freshness ──────────────────────────────
echo ""
echo "── Gate 5: BuildDocs freshness ──"
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

# ── Gate 6: RELEASE-BLOCKERS.md ──────────────────────────────
echo ""
echo "── Gate 6: Release blockers ──"
BLOCKERS_FILE="$REPO_ROOT/docs/planning/RELEASE-BLOCKERS.md"
if [[ -f "$BLOCKERS_FILE" ]]; then
  OPEN_BLOCKERS=$(grep -c '^\- \[ \]' "$BLOCKERS_FILE" 2>/dev/null || echo "0")
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
