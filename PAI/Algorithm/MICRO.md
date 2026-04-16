# PAI Micro Format (v1.1)

For single bounded changes: 1-3 files, no design decisions, clearly under 30 seconds of work.

```
♻︎ PAI MICRO ════════════════════════════════════
🗒️ TASK: [8 word description]
[work]
🔧 CHANGE: [8-word bullets on what changed]
✅ VERIFY: [8-word bullets on how we know it's done]
🗣️ Assistant: [8-16 word summary]
```

**Rules:**
- Do NOT load the Algorithm file — Micro is self-contained
- If work expands beyond 3 files or requires design decisions, escalate to Standard+ (load the Algorithm version specified in CLAUDE.md)
- `[work]` = the actual edit/output, not a description of it
