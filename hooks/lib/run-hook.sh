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
  SessionEndComposite)       DEFAULT_TIMEOUT=240 ;;  # Parent fan-out wrapper; must exceed slowest child (KnowledgeSync=180s)
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

now_ms() {
  perl -MTime::HiRes=time -e 'printf "%.0f\n", time()*1000' 2>/dev/null || echo "$(($(date -u +%s) * 1000))"
}

# Log start to hook log. Use an explicit START/END pair so latency incidents can
# be attributed mechanically instead of inferred from adjacent hook starts.
START_MS="$(now_ms)"
START_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "[$(date -u +%H:%M:%S)] run-hook.sh START: $LOG_BASE (timeout: ${TIMEOUT}s, pid=$$)" >> "$LOG_FILE"

# Execute with timeout — exits 124 on timeout (logged below, not fatal)
# macOS doesn't ship GNU timeout; try gtimeout (brew install coreutils), else run without timeout
if command -v timeout &>/dev/null; then
  timeout "$TIMEOUT" bun "$HOOK_PATH" 2>>"$LOG_FILE"
  STATUS=$?
elif command -v gtimeout &>/dev/null; then
  gtimeout "$TIMEOUT" bun "$HOOK_PATH" 2>>"$LOG_FILE"
  STATUS=$?
else
  echo "[$(date -u +%H:%M:%S)] run-hook.sh WARNING: timeout command unavailable; running $LOG_BASE without wrapper timeout" >> "$LOG_FILE"
  bun "$HOOK_PATH" 2>>"$LOG_FILE"
  STATUS=$?
fi

END_MS="$(now_ms)"
END_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
DURATION_MS=$((END_MS - START_MS))
if [ "$STATUS" -eq 124 ]; then
  echo "[$(date -u +%H:%M:%S)] run-hook.sh END: $LOG_BASE status=$STATUS duration_ms=${DURATION_MS} timeout=true started_at=$START_ISO ended_at=$END_ISO" >> "$LOG_FILE"
else
  echo "[$(date -u +%H:%M:%S)] run-hook.sh END: $LOG_BASE status=$STATUS duration_ms=${DURATION_MS} timeout=false started_at=$START_ISO ended_at=$END_ISO" >> "$LOG_FILE"
fi

exit "$STATUS"
