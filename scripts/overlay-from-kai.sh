#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  overlay-from-kai.sh — Pull KAI (public) into pai-config (private)
#
#  New sync direction (v7.1+):
#    KAI (develop publicly) → pai-config (private overlay on top)
#
#  This script runs FROM pai-config and:
#    1. Pulls latest from the KAI repo
#    2. Copies public files into pai-config (respecting private exclusions)
#    3. Applies KAI→PAI brand renames where needed
#    4. Preserves all private files untouched
#
#  Usage:
#    bash scripts/overlay-from-kai.sh              # dry-run (default)
#    bash scripts/overlay-from-kai.sh --apply      # actually sync
#    bash scripts/overlay-from-kai.sh --pull       # git pull KAI first, then sync
#
#  Prerequisites:
#    - ~/Projects/pai-config is this repo (symlinked as ~/.claude)
#    - ~/Projects/kai is the public KAI repo
#
#  The mental model:
#    pai-config = KAI + private overlay
#    "private overlay" = identity, credentials, private skills, internal docs
#    Everything else comes FROM KAI unchanged (or with KAI→PAI brand swap)
# ═══════════════════════════════════════════════════════════════
set -uo pipefail

PAI_DIR="$(cd "$(dirname "$0")/.." && pwd)"
KAI_DIR="${KAI_DIR:-$HOME/Projects/kai}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()    { echo -e "  ${BLUE}→${NC} $1"; }
pass()    { echo -e "  ${GREEN}✓${NC} $1"; }
warn()    { echo -e "  ${YELLOW}!${NC} $1"; }
fail()    { echo -e "  ${RED}✗${NC} $1"; }

MODE="dry-run"
[[ "${1:-}" == "--dry-run" ]] && MODE="dry-run"
[[ "${1:-}" == "--apply" ]] && MODE="apply"
[[ "${1:-}" == "--pull" ]] && MODE="pull"

# ── Validate ─────────────────────────────────────────────────
[[ -d "$PAI_DIR/.git" ]] || { fail "Not a git repo: $PAI_DIR"; exit 1; }
[[ -d "$KAI_DIR/.git" ]] || { fail "KAI repo not found at $KAI_DIR"; exit 1; }

echo ""
echo "=== overlay-from-kai ($MODE) ==="
echo "  Source (KAI): $KAI_DIR"
echo "  Target (PAI): $PAI_DIR"
echo ""

# ── Private files — NEVER overwritten by KAI ─────────────────
# These files exist only in pai-config. If KAI sync tries to delete
# or overwrite them, it's blocked.
PRIVATE_PATHS=(
  # Identity & credentials
  CLAUDE.md
  VERSION
  config/identity.jsonc
  devices.json
  settings.json
  USER/
  .claude/

  # Internal planning & docs
  Plans/
  History/
  specs/
  docs/planning/GIT-HISTORY-REWRITE.md
  docs/planning/PAI-5.0.0-PLAN.md
  docs/planning/RELEASE-BLOCKERS.md
  docs/planning/v5.3.0-PLAN.md
  docs/planning/v5.4.0-PLAN.md
  docs/planning/v5.5.0-PLAN.md
  docs/planning/v5.6.0-PLAN.md
  docs/planning/v6.0.0-PLAN.md
  docs/planning/v6.4-review-remediations.md
  docs/planning/knowledge-cascade-design.md
  docs/v46-staging/
  docs/VERSIONING.md
  docs/RELEASE-CHECKLIST.md

  # Private skills
  skills/LinksysDev/
  skills/Utilities/PAIUpgrade/
  skills/DevTeam/Context/LinksysResources.md

  # Maintainer tooling
  scripts/sync-to-kai.sh
  scripts/verify-release.sh
  scripts/kai-release-audit.ts
  scripts/pii-patterns.json
  scripts/board-config.json
  scripts/overlay-from-kai.sh
  scripts/MAINTENANCE.md
  scripts/README.md
  scripts/migrate-knowledge-frontmatter.ts

  # Runtime state (not in git but protect from accidents)
  projects/
  sessions/
  tasks/
  backups/
  cache/
  teams/
  telemetry/
  plugins/
  daemon/
  jobs/
  node_modules/

  # Generated/local
  TOOLS.md
  TOOLS-FULL.md
  CAPABILITIES.md
  MEMORY/CAPABILITIES/
  policy-limits.json
  hooks/archive/

  # Memory (private content)
  MEMORY/KNOWLEDGE/
  MEMORY/STAGING/.staging-state.json
  "MEMORY/STAGING/2026-*"
  "MEMORY/WISDOM/FRAMES/*.md"

  # PAI-specific examples (KAI has its own)
  PAI/AISTEERINGRULES-EXAMPLES.md
  PAI/Tools/bump-version.ts
)

# ── KAI-only files — exist in KAI but NOT synced to pai-config ──
# These are public-repo scaffolding that pai-config doesn't need.
KAI_ONLY_FILES=(
  .github/workflows/test.yml
  CHANGELOG.md
  CONTRIBUTING.md
  LICENSE
  LICENSE-UPSTREAM
  get-kai.sh
  config/identity.jsonc.template
  config/user-hooks.jsonc.example
  docs/CUSTOMIZATION.md
  docs/WHATS-DIFFERENT.md
  docs/architecture/archive/
  docs/planning/deliberate-research-mode.md
  PAI/CONTEXT_ROUTING.md
  hooks/user/
  MEMORY/KNOWLEDGE/.gitkeep
  MEMORY/LEARNING/.gitkeep
  MEMORY/RELATIONSHIP/.gitkeep
  MEMORY/SECURITY/.gitkeep
  MEMORY/STAGING/.gitkeep
  MEMORY/STATE/.gitkeep
  MEMORY/WORK/.gitkeep
  tests/ConfigLoader.test.ts
  tests/Installer.test.ts
  tests/OncePerSession.test.ts
)

# ── Step 1: Optionally pull KAI ──────────────────────────────
if [[ "$MODE" == "pull" ]]; then
  echo "── Pulling KAI ──"
  if (cd "$KAI_DIR" && git pull --ff-only origin main 2>&1); then
    pass "KAI pulled successfully"
  else
    fail "Failed to pull KAI — resolve manually"
    exit 1
  fi
  MODE="apply"  # Continue with apply after pull
  echo ""
fi

# ── Step 2: Get file list from KAI ───────────────────────────
echo "── Scanning KAI files ──"
KAI_FILES=$(cd "$KAI_DIR" && git ls-files)
KAI_COUNT=$(echo "$KAI_FILES" | wc -l | tr -d ' ')
info "KAI has $KAI_COUNT tracked files"

# ── Helper: check if path matches private/kai-only ───────────
matches_pattern() {
  local filepath="$1"
  shift
  for pattern in "$@"; do
    # Directory pattern (ends with /)
    if [[ "$pattern" == */ ]]; then
      [[ "$filepath" == "$pattern"* ]] && return 0
    # Glob pattern
    elif [[ "$pattern" == *"*"* ]]; then
      # shellcheck disable=SC2053
      [[ "$filepath" == $pattern ]] && return 0
    # Exact match or prefix
    else
      [[ "$filepath" == "$pattern" || "$filepath" == "$pattern/"* ]] && return 0
    fi
  done
  return 1
}

# ── Step 3: Classify and sync ─────────────────────────────────
echo "── Classifying files ──"
SYNC_COUNT=0
SKIP_PRIVATE=0
SKIP_KAI_ONLY=0
WOULD_SYNC=()

while IFS= read -r file; do
  [[ -z "$file" ]] && continue

  # Skip KAI-only files (they don't belong in pai-config)
  if matches_pattern "$file" "${KAI_ONLY_FILES[@]}"; then
    SKIP_KAI_ONLY=$((SKIP_KAI_ONLY + 1))
    continue
  fi

  # Skip private files (pai-config's own, never overwritten)
  if matches_pattern "$file" "${PRIVATE_PATHS[@]}"; then
    SKIP_PRIVATE=$((SKIP_PRIVATE + 1))
    continue
  fi

  # This file should sync from KAI → pai-config
  WOULD_SYNC+=("$file")
  SYNC_COUNT=$((SYNC_COUNT + 1))
done <<< "$KAI_FILES"

info "Will sync: $SYNC_COUNT files"
info "Skipped (private): $SKIP_PRIVATE"
info "Skipped (KAI-only): $SKIP_KAI_ONLY"

# ── Step 4: Detect changes ────────────────────────────────────
echo ""
echo "── Detecting changes ──"
CHANGED=()
NEW=()
UNCHANGED=0

for file in "${WOULD_SYNC[@]}"; do
  KAI_PATH="$KAI_DIR/$file"
  PAI_PATH="$PAI_DIR/$file"

  if [[ ! -f "$PAI_PATH" ]]; then
    NEW+=("$file")
  elif ! diff -q "$KAI_PATH" "$PAI_PATH" > /dev/null 2>&1; then
    CHANGED+=("$file")
  else
    UNCHANGED=$((UNCHANGED + 1))
  fi
done

info "New files: ${#NEW[@]}"
info "Changed files: ${#CHANGED[@]}"
info "Unchanged: $UNCHANGED"

if [[ ${#NEW[@]} -gt 0 ]]; then
  echo ""
  echo "  New:"
  for f in "${NEW[@]:0:15}"; do
    echo "    + $f"
  done
  [[ ${#NEW[@]} -gt 15 ]] && echo "    ... and $((${#NEW[@]} - 15)) more"
fi

if [[ ${#CHANGED[@]} -gt 0 ]]; then
  echo ""
  echo "  Changed:"
  for f in "${CHANGED[@]:0:15}"; do
    echo "    ~ $f"
  done
  [[ ${#CHANGED[@]} -gt 15 ]] && echo "    ... and $((${#CHANGED[@]} - 15)) more"
fi

# ── Step 5: Apply (if not dry-run) ───────────────────────────
if [[ "$MODE" == "dry-run" ]]; then
  echo ""
  warn "Dry-run mode — no files changed"
  info "Run with --apply or --pull to sync"
  echo ""
  exit 0
fi

echo ""
echo "── Applying changes ──"
APPLIED=0

for file in "${NEW[@]}" "${CHANGED[@]}"; do
  KAI_PATH="$KAI_DIR/$file"
  PAI_PATH="$PAI_DIR/$file"

  # Create parent directory if needed
  mkdir -p "$(dirname "$PAI_PATH")"

  # Copy file
  cp "$KAI_PATH" "$PAI_PATH"
  APPLIED=$((APPLIED + 1))
done

pass "Applied $APPLIED file changes"

# ── Step 6: KAI→PAI brand swap (minimal) ─────────────────────
# Only needed for user-facing strings where "KAI" should say "PAI" in your
# private installation. Most code is brand-neutral already.
echo ""
echo "── Brand adjustment (KAI → PAI in private install) ──"
BRAND_COUNT=0

for file in "${CHANGED[@]}" "${NEW[@]}"; do
  PAI_PATH="$PAI_DIR/$file"
  [[ -f "$PAI_PATH" ]] || continue

  # Only text files
  if [[ "$file" =~ \.(ts|md|json|jsonc|sh|html)$ ]]; then
    # Swap product-name references (not path components)
    if grep -q '\bKAI system\b\|KAI session\|\bthe KAI\b\|with KAI\|use KAI\|run KAI\|start KAI' "$PAI_PATH" 2>/dev/null; then
      sed -i '' 's/\bKAI system\b/PAI system/g' "$PAI_PATH"
      sed -i '' 's/KAI session/PAI session/g' "$PAI_PATH"
      sed -i '' 's/ the KAI\./ the PAI./g' "$PAI_PATH"
      sed -i '' 's/ the KAI / the PAI /g' "$PAI_PATH"
      sed -i '' 's/with KAI/with PAI/g' "$PAI_PATH"
      sed -i '' 's/use KAI/use PAI/g' "$PAI_PATH"
      sed -i '' 's/run KAI/run PAI/g' "$PAI_PATH"
      sed -i '' 's/start KAI/start PAI/g' "$PAI_PATH"
      BRAND_COUNT=$((BRAND_COUNT + 1))
    fi
  fi
done

info "Brand adjusted in $BRAND_COUNT files"

# ── Step 7: Record sync state ─────────────────────────────────
KAI_COMMIT=$(cd "$KAI_DIR" && git rev-parse HEAD)
echo "$KAI_COMMIT" > "$PAI_DIR/.kai-upstream"
pass "Recorded KAI commit: ${KAI_COMMIT:0:8}"

# ── Summary ───────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════"
echo -e "  ${GREEN}overlay-from-kai complete${NC}"
echo "  Files synced: $APPLIED"
echo "  Brand adjustments: $BRAND_COUNT"
echo "  KAI commit: ${KAI_COMMIT:0:8}"
echo ""
echo "  Next steps:"
echo "    cd $PAI_DIR"
echo "    git diff --stat   # review changes"
echo "    git add -A && git commit -m 'sync: pull from KAI ${KAI_COMMIT:0:8}'"
echo ""
