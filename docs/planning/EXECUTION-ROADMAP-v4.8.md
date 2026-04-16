# PAI v4.8.0 Execution Roadmap

**Created:** 2026-04-15
**Source:** Council Synthesis (3 Architect agents)
**Branch:** v4.8.0-dev (from v4.7.0-dev)
**Theme:** Token optimization + memory curation + guardrails

---

## Phase 0: Token Economy (Do First)

| Task | What | Savings | Status |
|------|------|---------|--------|
| 0A | Remove duplicate project CLAUDE.md | ~588 tokens | Pending |
| 0B | Make TELOS loading conditional | ~200-400 tokens | Pending |
| 0C | Extract steering rule examples to separate file | ~400 tokens | Pending |

**Net Phase 0 savings:** ~1,200-1,400 tokens per session

## Phase 1: Foundation Infrastructure

| Task | What | Status |
|------|------|--------|
| 1A | Read telemetry in LoadContext (memory-reads.jsonl) | Pending |
| 1B | MEMORY/STAGING/ directory + draft format + 14-day expiry | Pending |
| 1C | `pai curate` CLI skeleton (stats, stale, domains) | Pending |
| 1D | Hard token budget cap in LoadContext (max 4,000 dynamic tokens) | Pending |
| 1E | SessionEnd inference budget cap (max 3 LLM calls) | Pending |

## Phase 2: Weekly Review (Future — v4.8.1)

- Full interactive `pai curate` report (5 sections)
- Archive/restore mechanics
- Domain health scoring

## Phase 3: Learning Loop (Future — v4.9.0)

- ReflectionHarvester.ts with human review gate
- Rating-triggered draft generation
- Lesson injection (<200 tokens)

---

## Build Order & Dependencies

```
0A ──┐
0B ──┼──→ Phase 0 complete ──→ 1D (token cap needs baseline)
0C ──┘
                                1A (telemetry, independent)
                                1B (staging, independent)
                                1C (CLI skeleton, depends on 1A + 1B for data)
                                1E (inference budget, independent)
```

## Version Plan

| Version | Content | Algorithm |
|---------|---------|-----------|
| v4.7.0 | PR #1 (KnowledgeSync, v3.11.0, context routing) | v3.11.0 |
| v4.8.0 | Phase 0 + Phase 1 (this roadmap) | v3.11.0 (unchanged) |
| v4.8.1 | Phase 2 (weekly review) | v3.11.0 |
| v4.9.0 | Phase 3 (learning loop) | v3.12.0 (if lesson injection added) |
