#!/usr/bin/env bash
set -uo pipefail

# KAI Release Verification Script
# Run before any public release to catch mechanical issues.
# Usage: bash scripts/verify-release.sh

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
PASS=0
FAIL=0
WARN=0

pass() { echo -e "  ${GREEN}PASS${NC} $1"; PASS=$((PASS + 1)); }
fail() { echo -e "  ${RED}FAIL${NC} $1"; FAIL=$((FAIL + 1)); }
warn() { echo -e "  ${YELLOW}WARN${NC} $1"; WARN=$((WARN + 1)); }

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "=== KAI Release Verification ==="
echo "Repo: $REPO_ROOT"
echo ""

# ── 1. Test Suite ──────────────────────────────────────────────
echo "── Test Suite ──"
TEST_OUTPUT=$(bun test 2>&1)
if echo "$TEST_OUTPUT" | grep -q '0 fail'; then
  TEST_COUNT=$(echo "$TEST_OUTPUT" | grep -oE '[0-9]+ pass' | grep -oE '[0-9]+' || echo "?")
  pass "All tests pass ($TEST_COUNT)"
else
  fail "Test suite has failures — run 'bun test' for details"
fi

# ── 2. PII Scan ───────────────────────────────────────────────
echo ""
echo "── PII Scan (tracked files) ──"

# PII patterns — personal identifiers that must not appear in tracked files.
# These match against file contents only (not commit messages — history scrub
# commits legitimately reference what was removed).
PII_PATTERNS=(
  '\bDeven\b'
  '\bDucommun\b'
  '\bdducommun\b'
  '\bLinksys\b'
  '\bEITC\b'
  'du\.ae'
  'yourlab'
  '10\.94\.107'
  '10\.18\.3\.'
  '@linksys\.com'
)

if [[ "${PII_PATTERNS[0]}" == *"YOUR_"* ]]; then
  warn "PII patterns not configured — edit scripts/verify-release.sh to add real patterns"
else
  PII_FOUND=0
  for pattern in "${PII_PATTERNS[@]}"; do
    MATCHES=$(grep -r -l -i -E "$pattern" --include='*.ts' --include='*.md' --include='*.json' --include='*.jsonc' --include='*.yaml' --include='*.yml' --include='*.sh' --include='*.html' . 2>/dev/null | grep -v node_modules | grep -v .git | grep -v verify-release.sh || true)
    if [[ -n "$MATCHES" ]]; then
      fail "PII pattern '$pattern' found in: $MATCHES"
      PII_FOUND=1
    fi
  done
  if [[ $PII_FOUND -eq 0 ]]; then
    pass "No PII found in tracked files"
  fi
fi

# ── 3. Git History PII ────────────────────────────────────────
echo ""
echo "── Git History ──"

AUTHOR_COUNT=$(git log --all --format='%an <%ae>' | sort -u | wc -l | tr -d ' ')
AUTHORS=$(git log --all --format='%an <%ae>' | sort -u)
if [[ $AUTHOR_COUNT -eq 1 ]]; then
  pass "Single author in history: $AUTHORS"
else
  warn "Multiple authors in history ($AUTHOR_COUNT):"
  echo "$AUTHORS" | while read -r line; do echo "    $line"; done
fi

  # Note: commit message scan skipped — scrub history commits legitimately reference
  # removed PII terms. Git author WARN above covers real exposure in history.

# ── 4. Ground Truth Counts ────────────────────────────────────
echo ""
echo "── Ground Truth Counts ──"

ACTUAL_SKILLS=$(find skills/ -name 'SKILL.md' -maxdepth 2 2>/dev/null | wc -l | tr -d ' ')
ACTUAL_HOOKS=$(find hooks/ -name '*.hook.ts' -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')
ACTUAL_AGENTS=$(find agents/ -name '*.md' -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')

echo "  Filesystem: $ACTUAL_SKILLS skills, $ACTUAL_HOOKS hooks, $ACTUAL_AGENTS agents"

for DOC in README.md docs/WHATS-DIFFERENT.md docs/QUICKSTART.md CHANGELOG.md; do
  if [[ -f "$DOC" ]]; then
    DOC_SKILLS=$(grep -oE '[0-9]+ skill' "$DOC" | grep -oE '[0-9]+' | head -1 || true)
    if [[ -n "$DOC_SKILLS" && "$DOC_SKILLS" != "$ACTUAL_SKILLS" ]]; then
      fail "$DOC claims $DOC_SKILLS skills but filesystem has $ACTUAL_SKILLS"
    fi
    DOC_HOOKS=$(grep -oE '[0-9]+ hook' "$DOC" | grep -oE '[0-9]+' | head -1 || true)
    if [[ -n "$DOC_HOOKS" && "$DOC_HOOKS" != "$ACTUAL_HOOKS" ]]; then
      fail "$DOC claims $DOC_HOOKS hooks but filesystem has $ACTUAL_HOOKS"
    fi
  fi
done
pass "Count verification complete"

# ── 5. Required Files ─────────────────────────────────────────
echo ""
echo "── Required Files ──"

REQUIRED_FILES=(LICENSE README.md CHANGELOG.md CONTRIBUTING.md .gitignore)
for f in "${REQUIRED_FILES[@]}"; do
  if [[ -f "$f" ]]; then
    pass "$f exists"
  else
    fail "$f missing"
  fi
done

# ── 6. Brand Consistency ──────────────────────────────────────
echo ""
echo "── Brand Consistency ──"

OLD_BRAND_PATTERNS=('pai-config' 'PAI Board' 'PAI Installer' 'PAI Environment')
for pattern in "${OLD_BRAND_PATTERNS[@]}"; do
  MATCHES=$(grep -r -l "$pattern" --include='*.ts' --include='*.md' --include='*.json' --include='*.jsonc' --include='*.sh' --include='*.html' . 2>/dev/null | grep -v node_modules | grep -v .git | grep -v verify-release.sh || true)
  if [[ -n "$MATCHES" ]]; then
    fail "Old brand '$pattern' found in: $(echo "$MATCHES" | tr '\n' ' ')"
  fi
done
pass "Brand consistency check complete"

# ── 7. Gitignored Secrets ─────────────────────────────────────
echo ""
echo "── Secrets Check ──"

SECRET_PATTERNS=('ANTHROPIC_API_KEY=sk-ant-[a-zA-Z0-9]{20}' 'GITHUB_TOKEN=ghp_[a-zA-Z0-9]{36}' 'OPENAI_API_KEY=sk-[a-zA-Z0-9]{40}' 'AWS_SECRET_ACCESS_KEY=[a-zA-Z0-9/+]{40}')
SECRETS_FOUND=0
for pattern in "${SECRET_PATTERNS[@]}"; do
  MATCHES=$(grep -r -l -E "$pattern" . 2>/dev/null | grep -v node_modules | grep -v .git | grep -v .env.example | grep -v verify-release.sh || true)
  if [[ -n "$MATCHES" ]]; then
    fail "Real secret matching '$pattern' found in: $MATCHES"
    SECRETS_FOUND=1
  fi
done
if [[ $SECRETS_FOUND -eq 0 ]]; then
  pass "No exposed secrets"
fi

# ── Summary ───────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════"
echo -e "  ${GREEN}$PASS passed${NC}  ${RED}$FAIL failed${NC}  ${YELLOW}$WARN warnings${NC}"
if [[ $FAIL -gt 0 ]]; then
  echo -e "  ${RED}NOT READY FOR RELEASE${NC}"
  exit 1
else
  echo -e "  ${GREEN}RELEASE VERIFICATION PASSED${NC}"
  exit 0
fi
