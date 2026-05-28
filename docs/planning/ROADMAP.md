# KAI Roadmap — Post v6.0

> Written: 2026-05-26 | Status: Draft for review

---

## v6.1 — Hardening Sprint (shipped)

**Theme:** Test coverage, security validation, dead code cleanup

| # | Item | Effort | Priority |
|---|------|--------|----------|
| 1 | Tests for security hooks (SecurityValidator, SecretOutputDetector, WebFetchGuard) | Medium | P0 |
| 2 | Unit tests for `atomic.ts`, `payload-schema.ts` | Medium | P0 |
| 3 | Unit tests for `instinct-store.ts`, `instinct-dedup.ts`, `instinct-cluster.ts` | Medium | P1 |
| 4 | Delete or implement 40+ stub workflow files (PromptInjection, Parser, Security, Fabric) | Small | P1 |
| 5 | Test coverage from 33% to 60% of hooks | Large | P1 |
| 6 | Add tests for knowledge-schema.ts, knowledge-readback.ts | Small | P2 |

**Exit criteria:**
- Security hooks have >=3 tests each covering happy path + bypass attempts
- Zero empty/stub workflow files remain (deleted or implemented)
- `bun test` count reaches 1100+
- No hook crashes on `bun hooks/X.hook.ts` with empty stdin

---

## v6.2 — Polish & Documentation (shipped)

**Theme:** Discoverability, API documentation, config validation

| # | Item | Effort | Priority |
|---|------|--------|----------|
| 1 | `agents/README.md` — task-to-agent routing matrix | Small | P0 |
| 2 | Frontend/Board API contract (SSE event types, REST endpoints) | Medium | P0 |
| 3 | Populate TELOS user files or remove stubs (9 files x 3 lines) | Small | P1 |
| 4 | Archive or populate `workflows/` directory | Small | P1 |
| 5 | Standardize skill trigger declarations (formal `triggers:` vs `USE WHEN`) | Medium | P2 |
| 6 | Settings schema validation (JSON Schema for settings.json) | Medium | P2 |
| 7 | Algorithm version migration guide (v3.9 → v3.14 changelog) | Small | P2 |

**Exit criteria:**
- New user can find the right agent for their task without reading 21 files
- Frontend contributor can understand board.ts ↔ frontend protocol from docs alone
- `workflows/` is either useful or gone
- All skills use consistent trigger format

---

## v6.3 — Scaling & Automation (shipped)

**Theme:** Runtime health, automated maintenance, growth readiness

| # | Item | Effort | Priority |
|---|------|--------|----------|
| 1 | STATE file TTL/cleanup automation (cron or SessionStart hook) | Medium | P0 |
| 2 | Memory WISDOM schema definition + population guide | Small | P1 |
| 3 | Config migration tooling (version-to-version settings upgrades) | Medium | P1 |
| 4 | Test coverage target: 80% of hooks | Large | P1 |
| 5 | Hook performance monitoring (latency tracking per hook) | Medium | P2 |
| 6 | Automated sync-drift detection (PAI vs KAI diff report) | Medium | P2 |
| 7 | Split LoadContext.hook.ts into focused hooks (static, dynamic, nudges) | Medium | P2 |
| 8 | Add caching to config-loader.ts (required when hooks consolidate into single process) | Small | P2 |
| 9 | hook-io.ts: cancel stdin reader after timeout wins the race | Small | P3 |

**Exit criteria:**
- MEMORY/STATE/ never grows unbounded (TTL enforced)
- Version upgrades have documented migration path
- Hook latency regressions are caught before they ship
- PAI→KAI drift detected automatically, not manually
- LoadContext responsibilities are separable (testable in isolation)
- config-loader is safe for single-process hook consolidation

---

## v6.4+ — Architecture Hardening & Evolution (v6.4.0 shipped)

Detailed plan with implementation specs, validation criteria, and multi-model deliberation decisions:
**See `docs/planning/v6.4-review-remediations.md`**

| Release | Theme | Key Items |
|---------|-------|-----------|
| **v6.4.0** | Write Coordination + Security | SessionEnd crash detection (UUID sentinels), risk-classifier fuzzing, E2E scaffold |
| **v6.4.1** | Full E2E + Security Audit | 10+ E2E scenarios, fail-open/closed audit, secret scanning, CLI injection audit, **tool credential declaration** |
| **v6.5.0** | SessionEnd Composite + Learning | 9→1 composite hook, heuristic gate, learning data lifecycle (event-source + view), **composite memory scoring** |
| **v6.5.1** | Algorithm Decomp + Sync CI | algorithm.ts 1515→150 lines, sync dry-run CI gates, PII grep |
| **v6.6.0** | DevTeam Intelligence + Orchestration | Cost tracking, dynamic roles, adaptive retry, **event checkpointing (resume), conditional phases, DAG execution planner** |
| **v7.0** | Monitor + SQLite (conditional) | Algorithm → meta-cognitive linter, **planning observer (adaptive replanning)**, SQLite WAL only if corruption proven |

**CrewAI pattern adoption plan:** `docs/planning/crewai-adoption-plan.md`

---

## Current State (v6.4 — shipped)

- 1398 tests, 74 files, 0 failures
- 52 hooks (PAI), 49 hooks (KAI) — all registered, 63 commands in settings.json
- 86 skills, 21 agents, Algorithm v3.14.0
- Full hook parity between PAI and KAI
- Security hooks active + hardened (risk-classifier fuzzing, E2E scaffold)
- SessionEnd write coordination (UUID sentinel tracking)
- Learning system active (KnowledgeSync, InstinctCapture, InsightExtractor)
- Sync pipeline verified + automated drift detection (sync-drift.ts)
- STATE TTL cleanup automation (state-cleanup.ts)
- Hook performance monitoring (hook-perf.ts)
- Config migration tooling (config-migrate.ts)
- Deliberate skill migrated to AWS Bedrock (zero personal API keys for external models)
- Agent routing matrix, Board API docs, Algorithm migration guide

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-27 | Adopt 7 CrewAI patterns across 4 releases | Checkpoint/resume, composite scoring, conditional execution, DAG planner, credential validation, stall content analysis, planning observer |
| 2026-05-27 | Keep two repos, harden sync CI | Migration cost is weeks; filter leak is irreversible; gates-must-fail favors reviewable diffs |
| 2026-05-27 | Event-source + materialized view for learning | Content-hash dedup + frequency + recency into token-capped view; no LLM pruning |
| 2026-05-27 | Algorithm → meta-cognitive monitor (v7.0) | Reclaim ~18% context window; post-generation linter with testable policy checks |
| 2026-05-27 | SessionEnd: heuristic gate + batched inference | Skip trivial sessions; batch learning into 1 Sonnet call; /feedback bypasses gate |
| 2026-05-27 | SQLite WAL conditional on proven corruption | Instrument first; migrate only if interleaving detected in 30 days |
| 2026-05-26 | Prioritize security hook tests over coverage % | Untested security gates are worse than low coverage |
| 2026-05-26 | Delete stubs rather than implement | 40 empty files add noise; reimplementing when needed is cheap |
| 2026-05-26 | Defer workflows/ to v6.2 | Skills-based execution has superseded the workflow pattern |
