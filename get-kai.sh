#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  KAI — Remote Installer (curl-pipe entry point)
#
#  Usage:
#    curl -fsSL https://raw.githubusercontent.com/kai-cli/kai/main/get-kai.sh | bash
#    curl -fsSL ... | KAI_HOME=~/my-kai bash
#
#  Handles three cases:
#    A) ~/.claude does not exist (fresh machine)
#    B) ~/.claude is a regular directory (existing Claude Code user)
#    C) ~/.claude is already a symlink
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

REPO="https://github.com/kai-cli/kai.git"
KAI_HOME="${KAI_HOME:-$HOME/kai}"
CLAUDE_DIR="$HOME/.claude"

BLUE='\033[38;2;59;130;246m'
GREEN='\033[38;2;34;197;94m'
YELLOW='\033[38;2;234;179;8m'
RED='\033[38;2;239;68;68m'
GRAY='\033[38;2;100;116;139m'
RESET='\033[0m'

info()    { echo -e "  ${BLUE}ℹ${RESET} $1"; }
success() { echo -e "  ${GREEN}✓${RESET} $1"; }
warn()    { echo -e "  ${YELLOW}⚠${RESET} $1"; }
error()   { echo -e "  ${RED}✗${RESET} $1"; exit 1; }

# ─── Preflight ────────────────────────────────────────────
command -v git &>/dev/null || error "git is required. Install it first."
command -v curl &>/dev/null || error "curl is required. Install it first."

# ─── Handle ~/.claude ─────────────────────────────────────

if [ -L "$CLAUDE_DIR" ]; then
  # Case C: already a symlink
  EXISTING=$(readlink "$CLAUDE_DIR")
  if [ -d "$EXISTING" ] && [ -f "$EXISTING/install.sh" ]; then
    info "KAI already installed at $EXISTING"
    info "To update, run: cd $EXISTING && git pull && bash install.sh"
    exit 0
  else
    error "~/.claude is a symlink to $EXISTING (not a KAI install). Move it manually or set KAI_HOME."
  fi

elif [ -d "$CLAUDE_DIR" ]; then
  # Case B: existing Claude Code directory
  BACKUP="$HOME/.claude.pre-kai.backup"
  if [ -d "$BACKUP" ]; then
    error "Backup already exists at $BACKUP — remove or rename it before reinstalling."
  fi
  warn "Existing ~/.claude directory found."
  info "Backing up to $BACKUP"
  mv "$CLAUDE_DIR" "$BACKUP"
  success "Backup created at $BACKUP"
  info "To revert: rm ~/.claude && mv $BACKUP ~/.claude"
fi

# Case A or B (after backup): clone or update
if [ -d "$KAI_HOME/.git" ]; then
  info "$KAI_HOME already exists — pulling latest..."
  git -C "$KAI_HOME" pull --ff-only 2>/dev/null && success "Updated $KAI_HOME" \
    || warn "Pull failed — you may have local changes. Run 'cd $KAI_HOME && git pull' manually."
elif [ -d "$KAI_HOME" ]; then
  error "$KAI_HOME exists but is not a git repo. Remove it or set KAI_HOME to a different path."
else
  info "Cloning KAI to $KAI_HOME..."
  git clone "$REPO" "$KAI_HOME"
  success "Cloned to $KAI_HOME"
fi

if [ ! -L "$CLAUDE_DIR" ]; then
  ln -s "$KAI_HOME" "$CLAUDE_DIR"
  success "Symlinked ~/.claude → $KAI_HOME"
fi

# Migrate reusable files from backup
if [ -d "${BACKUP:-}" ]; then
  info "Migrating reusable data from backup..."
  for item in projects sessions history.jsonl; do
    if [ -e "$BACKUP/$item" ]; then
      cp -r "$BACKUP/$item" "$KAI_HOME/" 2>/dev/null && success "Migrated $item" || true
    fi
  done
fi

# ─── Run post-clone installer ─────────────────────────────
info "Running KAI setup..."
echo ""
bash "$KAI_HOME/install.sh"
