#!/bin/bash
# run-hook.sh — Universal hook wrapper with timeout enforcement
#
# Claude Code treats stderr output from hooks as error conditions.
# This wrapper redirects stderr to a per-hook log file so:
# 1. Diagnostic logging is preserved (readable at /tmp/pai-hooks/)
# 2. Claude Code doesn't display "hook error" for normal logging
# 3. Enforces per-hook timeouts to prevent hung hooks from blocking sessions
#
# Usage in settings.json:
#   "command": "${PAI_DIR}/hooks/lib/run-hook.sh HookName.hook.ts"
#
# Timeout override (env var): PAI_HOOK_TIMEOUT_HookName=60 (seconds)
# Global override:             PAI_HOOK_TIMEOUT=30

HOOK_NAME="${1:?Usage: run-hook.sh <HookName.hook.ts>}"
HOOK_PATH="${PAI_DIR:-$HOME/.claude}/hooks/${HOOK_NAME}"
LOG_DIR="/tmp/pai-hooks"
mkdir -p "$LOG_DIR"
# Strip path prefixes for clean log filenames (handlers/Foo.ts → Foo.log)
LOG_BASE="$(basename "${HOOK_NAME}" .hook.ts)"
LOG_BASE="${LOG_BASE%.ts}"
LOG_FILE="${LOG_DIR}/${LOG_BASE}.log"

# ── Timeout selection (per-hook → global env → hardcoded default) ──
# Known slow hooks get longer timeouts. All others: 30s default.
case "$LOG_BASE" in
  KnowledgeSync)             DEFAULT_TIMEOUT=180 ;;  # Full harvest: 7 domains × ~25s each
  SessionSummary)            DEFAULT_TIMEOUT=60  ;;  # LLM summarization
  WorkCompletionLearning)    DEFAULT_TIMEOUT=60  ;;  # LLM learning capture
  InsightExtractor)          DEFAULT_TIMEOUT=90  ;;  # Haiku inference (CLI cold start) + file writes
  RelationshipMemory)        DEFAULT_TIMEOUT=45  ;;  # LLM relationship note
  RatingCapture)             DEFAULT_TIMEOUT=30  ;;  # Haiku inference
  *)                         DEFAULT_TIMEOUT=30  ;;  # All others: 30s
esac

# Per-hook env override: PAI_HOOK_TIMEOUT_KnowledgeSync=300
HOOK_ENV_VAR="PAI_HOOK_TIMEOUT_${LOG_BASE//-/_}"
TIMEOUT="${!HOOK_ENV_VAR:-${PAI_HOOK_TIMEOUT:-$DEFAULT_TIMEOUT}}"

# Log timeout to hook log
echo "[$(date -u +%H:%M:%S)] run-hook.sh: $LOG_BASE (timeout: ${TIMEOUT}s)" >> "$LOG_FILE"

# Execute with timeout — exits 124 on timeout (logged, not fatal)
# macOS doesn't ship GNU timeout; try gtimeout (brew install coreutils), else run without timeout
if command -v timeout &>/dev/null; then
  exec timeout "$TIMEOUT" bun "$HOOK_PATH" 2>>"$LOG_FILE"
elif command -v gtimeout &>/dev/null; then
  exec gtimeout "$TIMEOUT" bun "$HOOK_PATH" 2>>"$LOG_FILE"
else
  exec bun "$HOOK_PATH" 2>>"$LOG_FILE"
fi
