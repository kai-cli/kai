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

QUICK=0
if [[ "${1:-}" == "--quick" ]]; then
  QUICK=1
fi

pass() { echo -e "  ${GREEN}PASS${NC} $1"; PASS=$((PASS + 1)); }
fail() { echo -e "  ${RED}FAIL${NC} $1"; FAIL=$((FAIL + 1)); }
warn() { echo -e "  ${YELLOW}WARN${NC} $1"; WARN=$((WARN + 1)); }

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [[ $QUICK -eq 1 ]]; then
  echo "=== KAI Release Verification (quick) ==="
else
  echo "=== KAI Release Verification ==="
fi
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
  'friendlylab'
  '10\.94\.107'
  '10\.18\.3\.'
  '@linksys\.com'
  '799870512242'
  '\bDeven_Ducommun\b'
)

if [[ "${PII_PATTERNS[0]}" == *"YOUR_"* ]]; then
  warn "PII patterns not configured — edit scripts/verify-release.sh to add real patterns"
else
  PII_FOUND=0
  TRACKED_TEXT=$(git ls-files -- '*.ts' '*.md' '*.json' '*.jsonc' '*.yaml' '*.yml' '*.sh' '*.html' 2>/dev/null | grep -v verify-release.sh || true)
  for pattern in "${PII_PATTERNS[@]}"; do
    MATCHES=$(echo "$TRACKED_TEXT" | xargs grep -l -i -E "$pattern" 2>/dev/null || true)
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

# ── 4. Ground Truth Counts (skipped in --quick) ──────────────
if [[ $QUICK -eq 0 ]]; then
  echo ""
  echo "── Ground Truth Counts ──"

  ACTUAL_SKILLS=$(find skills/ -name 'SKILL.md' 2>/dev/null | wc -l | tr -d ' ')
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
  # Version consistency — manifest.json is canonical SoT; all others must match
  # Uses existing fail helper. manifest.json version must equal preferences.jsonc,
  # VERSION file, and install.sh banner (major.minor match for install.sh).
  MANIFEST_VER=$(grep -E '"version"\s*:' manifest.json 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  if [[ -n "$MANIFEST_VER" ]]; then
    PREFS_VER=$(grep -E '"version"\s*:' config/preferences.jsonc 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
    FILE_VER=$(cat VERSION 2>/dev/null | tr -d '[:space:]')
    INSTALL_VER=$(grep "Installer v" install.sh 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+' | head -1)

    if [[ -n "$PREFS_VER" && "$PREFS_VER" != "$MANIFEST_VER" ]]; then
      fail "preferences.jsonc version ($PREFS_VER) != manifest.json version ($MANIFEST_VER) — run BuildManifest.ts"
    fi
    if [[ -n "$FILE_VER" && "$FILE_VER" != "$MANIFEST_VER" ]]; then
      fail "VERSION file ($FILE_VER) != manifest.json version ($MANIFEST_VER)"
    fi
    if [[ -n "$INSTALL_VER" && "$INSTALL_VER" != "${MANIFEST_VER%.*}" && "$INSTALL_VER" != "$MANIFEST_VER" ]]; then
      fail "install.sh banner version ($INSTALL_VER) != manifest.json version ($MANIFEST_VER)"
    fi
  fi

  pass "Count verification complete"
fi

# ── 5. Required Files ─────────────────────────────────────────
echo ""
echo "── Required Files ──"

REQUIRED_FILES=(LICENSE README.md CHANGELOG.md CONTRIBUTING.md .gitignore hooks/lib/github-approve.ts)
for f in "${REQUIRED_FILES[@]}"; do
  if [[ -f "$f" ]]; then
    pass "$f exists"
  else
    fail "$f missing"
  fi
done

# ── 6. Brand Consistency (skipped in --quick) ────────────────
if [[ $QUICK -eq 0 ]]; then
  echo ""
  echo "── Brand Consistency ──"

  OLD_BRAND_PATTERNS=('pai-config' 'PAI Board' 'PAI Installer' 'PAI Environment')
  for pattern in "${OLD_BRAND_PATTERNS[@]}"; do
    MATCHES=$(grep -r -l "$pattern" --include='*.ts' --include='*.md' --include='*.json' --include='*.jsonc' --include='*.sh' --include='*.html' . 2>/dev/null | grep -v node_modules | grep -v .git | grep -v verify-release.sh | grep -v 'projects/' | grep -v 'file-history/' || true)
    if [[ -n "$MATCHES" ]]; then
      fail "Old brand '$pattern' found in: $(echo "$MATCHES" | tr '\n' ' ')"
    fi
  done
  pass "Brand consistency check complete"
fi

# ── 7. Gitignored Secrets ─────────────────────────────────────
echo ""
echo "── Secrets Check ──"

SECRET_PATTERNS=('ANTHROPIC_API_KEY=sk-ant-[a-zA-Z0-9]{20}' 'GITHUB_TOKEN=ghp_[a-zA-Z0-9]{36}' 'OPENAI_API_KEY=sk-[a-zA-Z0-9]{40}' 'AWS_SECRET_ACCESS_KEY=[a-zA-Z0-9/+]{40}')
SECRETS_FOUND=0
for pattern in "${SECRET_PATTERNS[@]}"; do
  MATCHES=$(grep -r -l -E "$pattern" . 2>/dev/null | grep -v node_modules | grep -v .git | grep -v .env.example | grep -v verify-release.sh | grep -v 'integration.test.ts' | grep -v 'file-history/' | grep -v 'projects/' || true)
  if [[ -n "$MATCHES" ]]; then
    fail "Real secret matching '$pattern' found in: $MATCHES"
    SECRETS_FOUND=1
  fi
done
if [[ $SECRETS_FOUND -eq 0 ]]; then
  pass "No exposed secrets"
fi

# ── 8. Dangling Hook References (skipped in --quick) ────────
if [[ $QUICK -eq 0 ]]; then
  echo ""
  echo "── Dangling Hook References ──"

  HOOK_REF_FOUND=0
  # Extract hook names from docs/code (FooBar.hook.ts pattern), check each exists
  # Uses \.hook\.ts to avoid false positives like SYM.hooks (property access)
  # Allowlist: example/template hook names used in documentation
  HOOK_EXAMPLES="ExampleHook\|MyHook\|YourHook\|PlanApprovalGuard\|SessionCloseGuard"

  HOOK_REFS=$(grep -rhoE '[A-Z][A-Za-z]+\.hook\.ts' \
    --include='*.md' --include='*.ts' --include='*.sh' --include='*.jsonc' \
    . 2>/dev/null \
    | grep -v node_modules \
    | grep -v "$HOOK_EXAMPLES" \
    | sed 's/\.ts$//' \
    | sort -u || true)

  for ref in $HOOK_REFS; do
    HOOK_FILE="hooks/${ref}.ts"
    if [[ ! -f "$HOOK_FILE" ]]; then
      # Check if references exist outside allowed locations
      REAL_REFS=$(grep -rn "${ref}.ts" --include='*.md' --include='*.ts' --include='*.sh' --include='*.jsonc' . 2>/dev/null \
        | grep -v node_modules \
        | grep -v '.git/' \
        | grep -v 'verify-release.sh' \
        | grep -v 'archive/' \
        | grep -v 'hooks/lib/' \
        | grep -v 'PAI/Algorithm/v[0-9]' \
        | grep -v 'docs/architecture/' \
        | grep -v 'PAI/dev/' \
        | grep -v 'MEMORY-CHANGELOG' \
        | grep -v "hooks/${ref}.ts" || true)
      if [[ -n "$REAL_REFS" ]]; then
        fail "Dangling hook reference: ${ref}.ts (no hooks/${ref}.ts). Referenced in:"
        echo "$REAL_REFS" | head -5 | while read -r line; do echo "    $line"; done
        HOOK_REF_FOUND=1
      fi
    fi
  done
  if [[ $HOOK_REF_FOUND -eq 0 ]]; then
    pass "No dangling hook references"
  fi
fi

# ── 9. Narrowed Brand Sweep (skipped in --quick) ────────────
if [[ $QUICK -eq 0 ]]; then
  echo ""
  echo "── Brand Sweep (user-facing docs) ──"

  USER_FACING_DOCS=(
    README.md
    CHANGELOG.md
    CONTRIBUTING.md
    docs/QUICKSTART.md
    docs/CUSTOMIZATION.md
    docs/WHATS-DIFFERENT.md
    docs/releases/README.md
  )

  # Allowlist patterns — legitimate PAI references in user-facing docs
  BRAND_ALLOWLIST='PAI_DIR\|PAI/\|PAI-Install\|PAISECURITYSYSTEM\|MEMORY/STAGING\|PAI/Tools\|PAI/Algorithm\|PAI/USER\|\.pai\b\|pai-config\|Miessler.*PAI\|PAI system\|PAI infrastructure'

  BRAND_FOUND=0
  for doc in "${USER_FACING_DOCS[@]}"; do
    [[ -f "$doc" ]] || continue
    MATCHES=$(grep -nE '\bPAI\b' "$doc" 2>/dev/null | grep -v "$BRAND_ALLOWLIST" || true)
    if [[ -n "$MATCHES" ]]; then
      fail "Unallowed PAI reference in $doc:"
      echo "$MATCHES" | head -5 | while read -r line; do echo "    $line"; done
      BRAND_FOUND=1
    fi
  done
  if [[ $BRAND_FOUND -eq 0 ]]; then
    pass "No unallowed PAI references in user-facing docs"
  fi
fi

# ── 10. Feature-Claim Verifier (skipped in --quick) ─────────
if [[ $QUICK -eq 0 ]]; then
  echo ""
  echo "── Feature-Claim Verifier ──"

  if [[ -f "CHANGELOG.md" ]]; then
    CLAIM_FAIL=0
    # Extract hook names from CHANGELOG.md — pattern: word ending with hook-like suffix
    # or explicit "HookName" in context of hooks/features
    CLAIMED_HOOKS=$(grep -oE '[A-Z][A-Za-z]+\.hook' CHANGELOG.md 2>/dev/null | sort -u || true)
    # Also match "**HookName**" patterns that reference hooks
    CLAIMED_HOOKS2=$(grep -oE '\*\*[A-Z][A-Za-z]+\*\*' CHANGELOG.md 2>/dev/null \
      | tr -d '*' \
      | while read -r name; do
          [[ -f "hooks/${name}.hook.ts" ]] || echo "$name"
        done || true)

    for hook in $CLAIMED_HOOKS; do
      if [[ ! -f "hooks/${hook}.ts" ]]; then
        fail "CHANGELOG.md claims '$hook' but hooks/${hook}.ts does not exist"
        CLAIM_FAIL=1
      fi
    done
    if [[ $CLAIM_FAIL -eq 0 ]]; then
      pass "All hook claims in CHANGELOG.md verified"
    fi
  else
    pass "No CHANGELOG.md — feature-claim check skipped (kai-only file)"
  fi
fi

# ── 11. Fix-Class Regression Gate (skipped in --quick) ───────
if [[ $QUICK -eq 0 ]]; then
  echo ""
  echo "── Fix-Class Regression Gate ──"

  # Check commits on current branch: if any contain "fix:" or "regression",
  # the same diff must also touch a test, verify-release.sh, or hook script.
  MAIN_BRANCH=$(git rev-parse --verify main 2>/dev/null || git rev-parse --verify master 2>/dev/null || echo "")
  if [[ -n "$MAIN_BRANCH" ]]; then
    FIX_COMMITS=$(git log "${MAIN_BRANCH}..HEAD" --oneline --grep='fix:' --grep='regression' --all-match 2>/dev/null || true)
    # Also check case-insensitive "fix:" at start of message (conventional commits)
    FIX_COMMITS2=$(git log "${MAIN_BRANCH}..HEAD" --oneline 2>/dev/null | grep -iE '^[0-9a-f]+ fix[:(]' || true)
    ALL_FIX_COMMITS=$(echo -e "${FIX_COMMITS}\n${FIX_COMMITS2}" | sort -u | sed '/^$/d')

    if [[ -n "$ALL_FIX_COMMITS" ]]; then
      FIX_GATE_FAIL=0
      while IFS= read -r commit_line; do
        COMMIT_SHA=$(echo "$commit_line" | awk '{print $1}')
        CHANGED_FILES=$(git diff-tree --no-commit-id --name-only -r "$COMMIT_SHA" 2>/dev/null || true)
        HAS_GUARD=$(echo "$CHANGED_FILES" | grep -cE 'scripts/verify-release\.sh|tests/.*\.test\.ts|scripts/hooks/' || echo "0")
        if [[ "$HAS_GUARD" -eq 0 ]]; then
          fail "Fix commit $commit_line has no regression guard (no test/verify/hook change)"
          FIX_GATE_FAIL=1
        fi
      done <<< "$ALL_FIX_COMMITS"
      if [[ $FIX_GATE_FAIL -eq 0 ]]; then
        pass "All fix-class commits include regression guards"
      fi
    else
      pass "No fix-class commits on this branch"
    fi
  else
    pass "No main branch found — fix-class check skipped"
  fi
fi

# ── 12. PAI/ vs skills/PAI/ Divergence Guard (skipped in --quick) ──
if [[ $QUICK -eq 0 ]]; then
  echo ""
  echo "── PAI/ vs skills/PAI/ Divergence ──"

  # Allowlist: files that are intentionally in only one directory.
  # Seed from codebase state at v5.1.0 (2026-04-29). Add new entries here
  # when adding a file that is legitimately asymmetric.
  PAI_ONLY_ALLOWLIST=(
    AISTEERINGRULES-EXAMPLES.md
    CONTEXT_ROUTING.md
    MEMORY-CHANGELOG.md
    PRDFORMAT.md
  )
  SKILLS_PAI_ONLY_ALLOWLIST=(
    ARBOLSYSTEM.md
    BROWSERAUTOMATION.md
    DEPLOYMENT.md
    FEEDSYSTEM.md
    TERMINALTABS.md
  )

  # Build sorted basename lists
  PAI_BASES=$(find PAI/ -maxdepth 1 -name '*.md' 2>/dev/null | xargs -I{} basename {} | sort)
  SKILLS_BASES=$(find skills/PAI/ -maxdepth 1 -name '*.md' 2>/dev/null | xargs -I{} basename {} | sort)

  PAI_ONLY=$(comm -23 <(echo "$PAI_BASES") <(echo "$SKILLS_BASES"))
  SKILLS_ONLY=$(comm -13 <(echo "$PAI_BASES") <(echo "$SKILLS_BASES"))

  DIVERGE_FAIL=0

  # Check PAI-only files not in allowlist
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    ALLOWED=0
    for a in "${PAI_ONLY_ALLOWLIST[@]}"; do [[ "$f" == "$a" ]] && ALLOWED=1 && break; done
    if [[ $ALLOWED -eq 0 ]]; then
      fail "PAI/$f exists but not in skills/PAI/ — add to allowlist if intentional"
      DIVERGE_FAIL=1
    fi
  done <<< "$PAI_ONLY"

  # Check skills/PAI-only files not in allowlist
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    ALLOWED=0
    for a in "${SKILLS_PAI_ONLY_ALLOWLIST[@]}"; do [[ "$f" == "$a" ]] && ALLOWED=1 && break; done
    if [[ $ALLOWED -eq 0 ]]; then
      fail "skills/PAI/$f exists but not in PAI/ — add to allowlist if intentional"
      DIVERGE_FAIL=1
    fi
  done <<< "$SKILLS_ONLY"

  if [[ $DIVERGE_FAIL -eq 0 ]]; then
    PAI_COUNT=$(echo "$PAI_BASES" | wc -l | tr -d ' ')
    SKILLS_COUNT=$(echo "$SKILLS_BASES" | wc -l | tr -d ' ')
    pass "PAI/ vs skills/PAI/ divergence within allowlist ($PAI_COUNT vs $SKILLS_COUNT .md files)"
  fi
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
