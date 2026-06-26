# Memory Spine Spec — observability, scope, semantic recall

**Status:** source-validated planning spec with 7.4.2 branch progress notes
**Validated:** 2026-06-26 against live source; updated for the 7.4.2 telemetry and auto-memory pass
**Owns roadmap item:** 7.4.x Memory spine: observability/telemetry §1, cross-project scope model, SF-3 embeddings-into-recall  
**Canonical relationship:** this is the implementation breakout for the memory-spine slice referenced by `ROADMAP-7.x.md` and `MEMORY-ARCHITECTURE-PLAN.md`.

This spec exists because the roadmap had the right direction but not enough implementation precision. The goal is not “more memory features”; it is to make memory behavior observable, scoped, and measurable before changing recall semantics.

## Source-validated current state

| Area | Current state | Source |
| --- | --- | --- |
| Hook runtime latency | Shipped. Every hook wrapper logs START/END, status, `duration_ms`, timeout flag. | `hooks/lib/run-hook.sh`, `tests/RunHookTiming.test.ts` |
| Memory telemetry substrate | Exists. Typed append-only events under `MEMORY/STATE/memory-telemetry.jsonl`; writes are non-blocking. | `hooks/lib/memory-telemetry.ts` |
| Telemetry report | Exists. Reports event counts, recall hit-rate, save-events per project, active projects with zero saves, latency p50/p95, agent checkpoint counts, drift count. | `scripts/memory-telemetry-report.ts` |
| Prompt latency report | Exists. Offline transcript diagnostic separates pre-response delay from hook duration, assistant model/cache metadata, queued human prompts, transcript size before first assistant, and Agent-return pressure before the next prompt. | `scripts/prompt-latency-report.ts` |
| Recall surfaced events | Partially wired. `MemoryRecall` emits `recall.surfaced` and records surfaced sources in a session ledger. | `hooks/MemoryRecall.hook.ts`, `hooks/lib/recall-hit-ledger.ts` |
| Recall hit events | Partially wired. `ReadActivity` credits `recall.hit` when a later memory read matches a surfaced source. | `hooks/ReadActivity.hook.ts`, `hooks/lib/recall-hit-ledger.ts` |
| Recall latency | Partially wired. `semantic-fallback` emits `recall.latency`; `MemRecall` emits attempt latency, including degraded no-store paths; `MemoryRecall` now emits end-to-end latency for skipped, degraded, no-match, and surfaced paths. Provider/source normalization is still incomplete across every provider. | `hooks/lib/semantic-fallback.ts`, `hooks/MemRecall.hook.ts`, `hooks/MemoryRecall.hook.ts` |
| Memory save events | Event type/report exist; 7.4.2 branch adds first memcarry/MemCapture save emitter. Broad save emitters are not yet wired. | `hooks/lib/memory-telemetry.ts`, `hooks/MemCapture.hook.ts`, `scripts/memory-telemetry-report.ts` |
| Capture latency | Event type/report exist; 7.4.2 branch adds first memcarry/MemCapture latency emitter. Other capture paths are not yet broadly timed. | `hooks/lib/memory-telemetry.ts`, `hooks/MemCapture.hook.ts`, `scripts/memory-telemetry-report.ts` |
| Native Auto Memory inbox triage | Exists. The relocated native inbox is classified read-only into project-fact, global-lesson, session-note, or manual-review lanes; promotion remains human-confirmed and no durable memory is written by the report. | `scripts/auto-memory-inbox-report.ts`, `tests/AutoMemoryInboxReport.test.ts` |
| Coherence drift | Event type exists, report supports it, but drift detection/emission is not implemented. | `hooks/lib/memory-telemetry.ts`, `scripts/memory-telemetry-report.ts` |
| Cross-project recall | Pointer-only cross-project hints are live. Body injection is deny-by-default via `crossProjectBodyInjection === true`. | `hooks/MemoryRecall.hook.ts`, `hooks/lib/config-loader.ts`, `tests/RedactAndGate.test.ts` |
| Cross-project scope model | Not implemented. Current control is a coarse global body-injection flag, not per-source/per-consumer policy. | `hooks/lib/config-loader.ts` |
| SF-3 embeddings into `MemoryRecall` | Open. `MemoryRecall` has scoring, but not the planned embedding-backed semantic scoring path. | `hooks/MemoryRecall.hook.ts`, `docs/planning/MEMORY-ARCHITECTURE-PLAN.md` |

## 2026-06-25 Live Telemetry Finding

The high-reasoning latency pass did not implicate PAI prompt-path hooks as the dominant delay. The observed
slow turns had near-zero pre-response hook cost and instead correlated with Claude-side workload signals:
Opus, large `cache_read_input_tokens`, large transcript/context size, queued prompts while another turn was
busy, and tool/planning work before the first visible assistant response.

Operational notes from the validation run:

- `/End` is the PAI checklist/manual end workflow; it performs model work and does not itself prove the native
  `SessionEnd` hook fired.
- `/exit` closes the Claude session and triggers native `SessionEnd`; that is the lifecycle path to use when
  validating `SessionEndComposite`.
- Queued human prompts can appear in transcript JSONL as `queued_command` attachments without matching
  `UserPromptSubmit`/`TurnTelemetry` hook telemetry. Reports must mark these as transcript-visible but not
  guaranteed hook-visible.
- Agent return size is a context-pressure signal, not a prompt hook. `agent.return.result_chars` should be
  read next to the following parent prompt's pre-response delay before blaming KnowledgeSync or recall hooks.

## Non-goals

- Do not make memcarry or native Auto Memory canonical in this slice.
- Do not auto-promote native Auto Memory files into durable memory; use classifier output as a review queue.
- Do not enable cross-project body injection by default.
- Do not retire memory hooks based on intuition.
- Do not add LLM inference back to the prompt hot path.
- Do not block user prompts if telemetry write/read fails.
- Do not fold unrelated §0 native-event ideas into the memory spine unless they produce memory/recall
  evidence. `PostToolBatch` and `InstructionsLoaded` remain runtime-event observability items; see
  “Adjacent §0 observability items” below.

## Workstream A — observability baseline

Purpose: make the memory system measurable before changing behavior.

### A1. Hook runtime telemetry — shipped

Accepted state:

- `run-hook.sh` logs wrapper-level START and END for every hook.
- END log includes exit status, elapsed milliseconds, timeout flag, start/end timestamps.
- Hook stdout contract is unchanged.

Status: done in PR #17.

### A2. Structured recall telemetry

Required events:

- `recall.surfaced`
  - `session_id`
  - `project`
  - `provider`: `MemoryRecall`, `MemRecall`, `LocalContextFirst`, etc.
  - `source_type`: `project-memory`, `memcarry`, `semantic-index`, `cross-project-pointer`, `cross-project-body`
  - `count`
  - `sources`
  - `token_estimate`
  - `budget`
- `recall.hit`
  - `session_id`
  - `source`
  - `basename`
  - `provider` when known
- `recall.latency`
  - `session_id`
  - `provider`
  - `path`: keyword, scorer, semantic-sqlite, semantic-jsonl, memcarry, cross-project
  - `ms`
  - `hits`
  - `degraded`: boolean
  - `reason` when degraded

Current gap:

- `MemoryRecall` emits surfaced/hit correlation and now emits end-to-end `recall.latency`, but it is still
  only one provider in the broader normalization work.
- `MemRecall` emits structured `recall.latency` and `recall.surfaced`, but the
  full provider/source schema and report breakdown still need normalization across recall providers.
- `LocalContextFirst` semantic fallback emits latency but not surfaced/hit telemetry in the same schema.
- Provider/source attribution is incomplete.
- Latency attribution should also surface the PAI-SR-032 broker question: today multiple recall providers can
  initialize or use semantic machinery independently. If telemetry shows repeated cold-start/embedder cost,
  consolidate provider orchestration/embedder reuse rather than optimizing each hook in isolation.

Acceptance criteria:

- A single prompt that triggers each recall provider produces structured telemetry showing provider, count, latency, and degradation state.
- A later `Read` of a surfaced source credits exactly one `recall.hit`.
- `scripts/memory-telemetry-report.ts --json` exposes recall hit-rate and latency by provider.
- Telemetry failure cannot change hook exit code or prompt context.

### A3. Memory save telemetry

Required event:

- `memory.save`
  - `session_id`
  - `project`
  - `path`
  - `source_hook`
  - `kind`: memory, lesson, checkpoint, native, staging
  - `bytes`
  - `status`

Current gap:

- Event type/report exist. The report can now show active projects with zero `memory.save` events, and
  MemCapture wires a first `memory.save` emitter, but save emitters are not broadly wired across
  native/project/staging memory paths.

Acceptance criteria:

- Any session that writes project memory emits at least one `memory.save`.
- Report can show save-events per project.
- A project with active work and zero saves becomes visible in the report. This is the rayhunter-class signature.

### A4. Capture latency telemetry

Required event:

- `capture.latency`
  - `session_id`
  - `source_hook`
  - `ms`
  - `status`
  - `degraded`

Current gap:

- Event type/report exist. The 7.4.2 branch wires a first memcarry/MemCapture `capture.latency` emitter,
  but capture paths are not broadly timed.

Acceptance criteria:

- Agent capture, Stop/SessionEnd capture, and memory write capture paths emit latency.
- Report shows capture p50/p95.
- Timeout or degraded capture is visible without breaking the session.

### A5. Silent-degrade visibility

Scope:

- Wire the known swallow-catch sites from the SF-9 audit to telemetry/log events.
- Prefer telemetry event when it affects memory, recall, capture, or state.
- Prefer structured hook log when it is purely local/cosmetic.

Acceptance criteria:

- Corrupt state, skipped memory, failed rotation, failed cap, lost handoff, and failed count reads are visible.
- No site changes from fail-open to fail-closed unless separately justified.

### A6. Health/readout surface

Required surfaces:

- CLI: `scripts/memory-telemetry-report.ts --json`
- Human: `/health` or board widget

Acceptance criteria:

- Shows total events, event counts by type, recall hit-rate, memory saves by project, recall/capture latency, drift count.
- Can answer: “was the last prompt slow because of a hook, recall path, capture path, or external model/API time?”

### A7. Native Auto Memory inbox triage - shipped in 7.4.2

Accepted state:

- `autoMemoryDirectory` remains outside the checkout; generated native files stay runtime inbox artifacts.
- `scripts/auto-memory-inbox-report.ts` reads the inbox without writing to PAI memory, memcarry, or project
  memory.
- Classifier lanes are explicit: project facts route to the owning project-memory review, reusable lessons
  route to memcarry `capture-lesson` preview/review, session notes stay unpromoted or expire, and ambiguous
  files require manual review.
- The flow is intentionally conservative. The 2026-06-26 live inbox pass found 5 files and left all 5 as
  manual-review because the target durable store was not unambiguous from content alone.

## Workstream B — cross-project scope model

Purpose: preserve useful transfer without leaking personal/work memory across trust domains.

### Current state

`MemoryRecall` reads the cross-project keyword index and can surface related projects. It now emits pointer-only hints by default. Body injection requires `crossProjectBodyInjection === true`, which is safe but too coarse.

### Required model

Each memory source must be classifiable as one of:

- `project`: only the owning project may receive the body.
- `shareable-global`: body may be shared to allowlisted projects/domains.
- `private-global`: body is never auto-injected outside explicit direct read.
- `sensitive`: pointer only, or no surface, depending on policy.

Each consumer project/domain must have policy:

- allowed source scopes
- denied source scopes
- allowed source projects/domains
- pointer-only vs body-injection rules
- audit logging for every cross-project body disclosure

### Acceptance criteria

- Cross-project body injection remains deny-by-default.
- Pointer-only cross-project hints remain available if policy allows.
- Body injection requires an explicit source scope and consumer allowlist.
- Tests prove work repos cannot receive personal memory bodies by default, and personal repos cannot receive work memory bodies by default.
- Sensitive fixture test includes a known credentials/security memory such as `MEMORY/KNOWLEDGE/security.md`
  so the first scope-policy test covers the highest-risk disclosure class, not only benign project notes.
- Every body injection emits telemetry:
  - `recall.surfaced`
  - `source_type: cross-project-body`
  - source project
  - consumer project
  - policy decision

## Workstream C — SF-3 embeddings into `MemoryRecall`

Purpose: reduce keyword-only misses while keeping the recall path measurable and reversible.

### Current state

`MemoryRecall` has scoring and token budgeting. Other paths already use semantic infrastructure (`LocalContextFirst` semantic fallback, memcarry semantic recall), but `MemoryRecall` itself does not yet use the planned embedding-backed semantic scoring.

### Required behavior

- Keep keyword candidate generation as the safe first stage.
- Add embedding-backed semantic reranking behind a config flag.
- Emit telemetry for both keyword and semantic legs.
- Use Phase-A baseline as the revert signal.

### Feature flag

Proposed:

- `memoryRecall.semanticScoring: false` by default until baseline is captured.

### Acceptance criteria

- With flag off, current ranking is unchanged.
- With flag on, semantic rerank can promote relevant memories that keyword scoring under-ranks.
- `recall.latency` includes semantic leg latency.
- `recall.surfaced` includes provider/source attribution.
- Revert path is tested: disabling the flag restores keyword-only behavior.
- Rollout criterion: enable only after baseline telemetry exists.
- Revert criterion: disable if recall hit-rate drops or p95 recall latency exceeds agreed threshold.

## Execution order

1. A2 structured recall telemetry audit/fill-in.
2. A3 memory-save emitters.
3. A4 capture-latency emitters.
4. A5 silent-degrade telemetry.
5. A6 health/readout.
6. B cross-project scope model.
7. C SF-3 semantic scoring in `MemoryRecall`.

Rationale: scope and semantic ranking decisions need telemetry first. Without baseline hit-rate, save-events, and latency, every “improvement” is a guess.

## Adjacent §0 observability items

These are tracked in `ROADMAP-7.x.md` §0 and `7.4.0-remaining-spec.md`. They are not memory-spine acceptance criteria, but they should stay visible because they affect runtime evidence quality.

### PostToolBatch aggregation — PAI-SR-099

Status: idea, binary-confirmed event exists.

Problem:

- Several current PostToolUse-style paths infer “parallel tool batch is done” from individual tool events.
- That can create race-prone shared-state updates and duplicated aggregation work.

Memory-spine relationship:

- Not required for recall hit-rate or memory save telemetry.
- Useful later if memory/capture analysis needs one event after all parallel Reads/Writes complete.

Keep separate until a concrete consumer is identified.

### InstructionsLoaded observability — PAI-SR-038

Status: idea, binary-confirmed event exists.

Problem:

- Some current instruction/rule freshness checks rely on prompt-time mtime polling and global temp state.
- Native `InstructionsLoaded` can expose instruction path, memory type, reason, and globs directly.

Memory-spine relationship:

- Not required for `recall.surfaced`/`recall.hit`.
- Useful for ADA/context provenance: “which instruction or pack was loaded before this recall/context decision?”
- Should emit runtime telemetry, but not to `memory-telemetry.jsonl` unless the event is tied to memory/recall context provenance.

Acceptance when pulled:

- Direct event fixture exists.
- No prompt-time mtime polling for rules that native events can report.
- Event output can answer which instruction source was loaded and why.

## Validation commands

Use these after each implementation slice:

```bash
PAI_DIR=$PWD HOME=$HOME bun test
PAI_DIR=$PWD bun scripts/sync-ci-gate.ts --warn-pii
PAI_DIR=$PWD bun scripts/memory-telemetry-report.ts --json
```

For live validation, run a controlled session that:

1. submits a prompt known to trigger `MemoryRecall`,
2. reads a surfaced memory file,
3. ends the session with a memory write,
4. checks the report for `recall.surfaced`, `recall.hit`, `memory.save`, and latency events.
