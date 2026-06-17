---
name: Copy
description: Copy the last substantive output (draft, code block, snippet) to the system clipboard via pbcopy. USE WHEN copy, clipboard, copy that, grab that.
version: 1.0.0
---

# Copy — Clipboard Skill

When invoked, identify the most recent substantive content from the conversation (email draft, code block, config snippet, command, etc.) and pipe it to `pbcopy`.

## Rules

1. Identify the last meaningful output — prefer the most recent draft, code fence, or structured content the user would want on their clipboard.
2. Use `printf '%s' '...' | pbcopy` to avoid trailing newlines from echo.
3. Escape single quotes in content with `'\''`.
4. Confirm with a one-liner: "Copied to clipboard."
5. If ambiguous what to copy, ask the user.

## Platform

- macOS: `pbcopy`
- Linux: `xclip -selection clipboard` (fallback)
