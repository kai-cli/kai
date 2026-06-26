# PAI Planning

> Reorganized 2026-06-05: single 7.x roadmap; pre-7.x version plans moved to `archive/`.

## Active

| File | Purpose |
|------|---------|
| [ROADMAP-7.x.md](ROADMAP-7.x.md) | **Single source of truth.** Shipped 7.0/7.1, active 7.2 (consolidation + KAI hardening), 7.3+ candidates, open tickets, full shipped history. Also owns the hook-integration-test backlog (folded in from the retired BACKLOG.md, 2026-06-22 — see 8.0.0 "Testing blind spots"). |
| [RELEASE-BLOCKERS.md](RELEASE-BLOCKERS.md) | Release gates |
| [memcarry-plan.md](memcarry-plan.md) | Memcarry integration sub-plan (drives W6) |

## Design docs (candidate ideas — see ROADMAP-7.x.md § 7.3+)

| File | Status |
|------|--------|
| [knowledge-cascade-design.md](knowledge-cascade-design.md) | LIVE candidate — knowledge-sync-across-locations problem |
| [MCP-REARCHITECT-PLAN.md](MCP-REARCHITECT-PLAN.md) | Needs re-scope (partly addressed by v5.9 MCP work) |
| [MCP-SSH-IDENTITY-PLAN.md](MCP-SSH-IDENTITY-PLAN.md) | 🆕 Device identity by MAC/serial + verify-on-connect + add/swap/retire (shared-IP ambiguity). HIGH friction. |
| [crewai-adoption-plan.md](crewai-adoption-plan.md) | Parked — multi-agent orchestration patterns |

## Hook test backlog — folded in + retired (2026-06-22)

The former `BACKLOG.md` (hook integration-test gaps + SF-* tickets) was folded into **ROADMAP-7.x.md §
8.0.0 "Testing blind spots"**: the ~33-hook coverage gap maps to the hook-lifecycle harness, SF-7 +
SF-1 carried forward by name, SF-2/8/9/18 already tracked elsewhere, and PromptAnalysis/SF-19/SF-20
dropped as stale (deleted / done). The file was **deleted** once incorporated.

## Streamlining plan — incorporated + retired (2026-06-07)

The former `~/Projects/Plans/pai-streamlining-plan.md` was validated against live code (SF-29): ~40% stale
(Track 2 listed 5 LIVE libs as orphans; Track 4b targeted the already-deleted PromptAnalysis). Its
salvageable ~60% — 3 confirmed-dead libs, the SecretDetector merge, skill archival, and Utilities/
dedup-pending-validation — was folded into **ROADMAP-7.x.md § Open follow-ups**, and the full triage lives in
`PAI-Wiki/findings/session-findings-2026-06-05.md` (SF-29). The orphan file was **deleted** once incorporated.

## Archive

`archive/` holds shipped per-version plans (PAI-5.0.0 → v6.0.0), the v6-era ROADMAP/NEXT-STEPS,
and completed one-time ops docs (GIT-HISTORY-REWRITE, steering-enforcement). Kept for history; not active.

> The active *execution* tracker for the 7.2 consolidation is in `~/Projects/PAI-Wiki/findings/`
> (`execution-plan.md` = W-workstream driver, `session-findings-2026-06-05.md` = SF tickets).
