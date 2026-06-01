---
name: End
description: Graceful session close with structured summary of work done, memory captured, and pending items.
triggers:
  - /end
  - end session
  - session end
  - wrap up session
  - close session
---

# End Session

Produces a structured session close summary before you exit. Unlike `/exit` (which closes immediately), `/end` reviews what happened this session and surfaces anything worth noting before you leave.

## When Triggered

Execute the workflow in `Workflows/SessionClose.md`.
