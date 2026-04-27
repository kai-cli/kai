#!/usr/bin/env bash
# Symlink tracked git hooks from scripts/hooks/ into .git/hooks/.
# Safe to run repeatedly — overwrites existing hooks with symlinks.
# Usage: bash scripts/install-hooks.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOKS_SRC="$SCRIPT_DIR/hooks"
HOOKS_DST="$REPO_ROOT/.git/hooks"

if [[ ! -d "$HOOKS_SRC" ]]; then
  echo "Error: $HOOKS_SRC not found."
  exit 1
fi

if [[ ! -d "$HOOKS_DST" ]]; then
  mkdir -p "$HOOKS_DST"
fi

INSTALLED=0
for hook in "$HOOKS_SRC"/*; do
  [[ -f "$hook" ]] || continue
  NAME="$(basename "$hook")"
  TARGET="$HOOKS_DST/$NAME"

  # Remove existing hook (file or symlink) before creating new symlink
  if [[ -e "$TARGET" || -L "$TARGET" ]]; then
    rm "$TARGET"
  fi

  ln -s "$hook" "$TARGET"
  chmod +x "$hook"
  echo "  ✓ Installed $NAME → .git/hooks/$NAME"
  INSTALLED=$((INSTALLED + 1))
done

if [[ $INSTALLED -eq 0 ]]; then
  echo "  No hooks found in $HOOKS_SRC"
else
  echo "  $INSTALLED hook(s) installed."
fi
