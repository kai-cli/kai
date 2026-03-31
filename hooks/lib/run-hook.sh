#!/bin/bash
# run-hook.sh — Universal hook wrapper
#
# Claude Code treats stderr output from hooks as error conditions.
# This wrapper redirects stderr to a per-hook log file so:
# 1. Diagnostic logging is preserved (readable at /tmp/pai-hooks/)
# 2. Claude Code doesn't display "hook error" for normal logging
#
# Usage in settings.json:
#   "command": "${PAI_DIR}/hooks/lib/run-hook.sh HookName.hook.ts"

HOOK_NAME="${1:?Usage: run-hook.sh <HookName.hook.ts>}"
HOOK_PATH="${PAI_DIR:-$HOME/.claude}/hooks/${HOOK_NAME}"
LOG_DIR="/tmp/pai-hooks"
mkdir -p "$LOG_DIR"
# Strip path prefixes for clean log filenames (handlers/Foo.ts → Foo.log)
LOG_BASE="$(basename "${HOOK_NAME}" .hook.ts)"
LOG_BASE="${LOG_BASE%.ts}"
LOG_FILE="${LOG_DIR}/${LOG_BASE}.log"

exec bun "$HOOK_PATH" 2>>"$LOG_FILE"
