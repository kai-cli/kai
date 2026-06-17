# PAI / KAI Roadmap — 7.x

> **Single source of truth for the 7.x line.** Consolidates what was scattered across ROADMAP.md (v6-era),
> NEXT-STEPS.md, and assorted design docs. Created 2026-06-05.
>
> - **kai** = private live installation (source of truth). **kai** = scrubbed public fork (`kai-cli/kai`).
> - Workflow: develop in kai → `sync-to-kai.sh` (PII scrub + brand) → verify → push.
> - Active execution detail for the consolidation effort lives in `~/Projects/PAI-Wiki/findings/`
>   (`execution-plan.md` = the W-workstream driver; `session-findings-2026-06-05.md` = SF tickets).
> - Pre-7.x version plans are archived in `docs/planning/archive/`.

---

## Shipped

| Release | Date | Highlights |
|---------|------|-----------|
| **7.1.0** | 2026-06 | Agent View integration, cognitive-persistence fixes |
| **7.0.0** | 2026-05 | (v6.4+ architecture hardening line — see archive/ROADMAP.md for the v6.x detail) |
| _≤ v6.0.0_ | — | Full shipped history in `archive/` (v4.1 → v6.0 plans) and the table at the bottom of this doc |

---

## 7.2 (in progress) — Consolidation + KAI hardening

**Theme:** Eliminate duplicate flows, activate orphaned components, harden the kai↔KAI boundary.
Driver: `PAI-Wiki/findings/execution-plan.md`. **Do NOT bump VERSION/manifest to 7.2 until this completes** (SF-20).

### Consolidation workstreams (keystone chain ✅ done)
- [x] **W1** — shared embeddings/similarity service (keystone) — fixed broken pooling, built the index
- [x] **W13** — TranscriptParser dedup → `hooks/lib/transcript-parser.ts` (`6d05441`)
- [x] **W2** — activate memory-scorer in MemoryRecall, flag-gated (`7e58ab9`)
- [x] **W3** — shared transcript-cache, cache-only split (`546f66e`)
- [x] **W4** — adopt SessionEndComposite, flag-gated (`c2033c6`)
- [x] **SF-10 guard** — `reconcile-wiring.ts` hook-wiring drift check, in CI + weekly

### Consolidation workstreams (Phase 1 ✅ all done 2026-06-05)
- [x] **W5 — Merge duplicate hooks.** 5a ReadTracker+MemoryAccessTracker→ReadActivity (`9159af9`); 5b deleted
  orphan PromptAnalysis (0 cache readers, never-wired consolidator) (`5f3ba13`).
- [x] **W7 — Audit loop.** `SecurityAuditLoop.ts` routes recurring denials→instincts, in weekly (`76dfd0e`).
- [x] **W10 — TerminalUI merge.** Slimmed TerminalState to SessionStart-only, removed 3 racing branches (`ffac284`).
- [x] **W11 — Shared ratings-store.** `lib/ratings-store.ts`, 9 accessors migrated (`804130e`).
- [x] **W9 remainder** — StopOrchestrator graceful-shutdown deadline (`b3d3421`); board auth (`af9ae1c`);
  embedding-index in weekly (`116d684`); SubagentStop investigated→deferred (SF-25, telemetry-only value).

### Consolidation workstreams (remaining — signal-blocked, deferred past 7.2)
- [~] **W6 — Memcarry delegation.** Partial (`4017c49`): provider seam + B1/H2/H4 built; W1 embeddings now
  available to back it. Remainder (W6b live jina recall, A1 ingestion, B3 reinforcement) is **signal-blocked** —
  needs weeks of rated use to have lessons worth recalling, not code. Full sub-plan: `memcarry-plan.md`.

### KAI / sync hardening (from the 2026-06-05 KAI session)
- [x] **SF-12** token out of remote URL + revoked; **SF-13/14** catch-up sync (fixed public orphaned-scorer);
  **SF-16** topology-aware reconcile; **SF-17** memcarry/daemon excludes; **SF-19** KAI CI green (memcarry tests excluded); pre-push PII gate.
- [x] **SF-28 — PII single-source** (`f4aa61b`, 2026-06-07): the PII pattern list was duplicated across 5
  drifting places (verify-release had silently fallen to 12 of 26 patterns). Now `pii-patterns.json` (detection,
  flat) + `pii-replacements.json` (scrub pairs) are the single source; sync-to-kai.sh + verify-release.sh load
  via jq (fail-closed); sync-ci-gate Step 2.6 is the drift guard. Scrub proven end-to-end; zero coverage loss.
- [x] **SF-26 — CLAUDE template landmine** (`f4aa61b`): BuildCLAUDE SessionStart hook now skips rebuild when
  the template is older than CLAUDE.md (self-correcting; was at risk of reverting INVESTIGATE mode).
- [ ] **SF-15 / SF-18 — sync verifies the wrong tree.** `verify-release.sh` scans kai not KAI; sync has
  no per-feature verification. CI runs it with `--warn-pii` (non-blocking) + pre-push gate compensates. Deeper
  fix: run KAI-side checks in the KAI tree. LOW priority.

---

## Codebase review 2026-06-08 (full-scale, 4 parallel audits)

System verdict: **healthy — 0 critical issues** (hooks/handlers wired, configs valid, this session's removals
clean, no silent breakage). Findings split into quick refactor wins (do first) + new development (build after).

### Refactor / consolidation backlog (quick fixes — validated, LOW risk)
Same "duplicated logic drifts" class we killed for counts/PII/secrets, applied to utilities:
- [~] **Shared `hook-stdin`** — PARTIAL (2026-06-08): 3 byte-identical `readStdinWithTimeout` copies consolidated
  into `lib/hook-io.ts` (`f244bfa`). Remaining: 12 hooks still define their own `readStdin` (14 now import
  hook-io) — but these have DIFFERENT shapes (custom payloads, partial extraction), not byte-identical. Lower
  value than first scoped; migrate case-by-case only where the contract matches. **MED.**
- [~] **`expandPath` → `lib/paths.ts`** — PARTIAL (2026-06-08): SecurityValidator migrated to canonical
  (`f53dad5`). Remaining 3 local copies: `PAI/Tools/RoutingAudit.ts` (has unique `${PROJECTS_DIR}` handling),
  `scripts/audit-memory.ts`, `scripts/board.ts` (low-value scripts). **LOW** — deliberately left.
- [~] **state-io** — PARTIAL (2026-06-08): added `readJSON<T>` single-source to `lib/atomic.ts` + migrated
  KnowledgeSync/InsightExtractor/WeeklyMaintenance (`a063da6`), also making their saveState crash-safe.
  Remaining: staging.ts + a few others still inline. Finish the migration onto `readJSON`/`atomicWriteJSON`. **LOW.**
- [ ] **`getAlgorithmVersion` (×4 identical), `ensureDir` (×3 identical)** → shared helpers. **MED, quick.** ← top quick win
- [ ] **Split oversized files** (testability, not urgent): `deliberate.ts` 1116L → 3 mode files;
  `dev-team.ts` 1039L → prompts/phases/review/utils. Board/LoadContext/SecurityValidator are cohesive — leave.
- [ ] **Merge `once-per-session` + `session-end-tracker`** → `lib/session-state.ts` (both manage session
  sentinels). LOW. And **merge `learning-utils` into `learning-readback`** (tightly coupled). LOW.
- [ ] **Delete `hooks/UpdateTabTitle.hook.ts.bak-4.3.1`** (stray backup — confirmed still present). Trivial. ← top quick win

### Shipped this session (2026-06-11/12) — v7.2.0 cut, released, CI hardened on Linux
- [x] **v7.2.0 cut via the release gate** (first time release.sh worked end-to-end) — fixed two release.sh
  bugs found along the way: Gate-6 `grep -c`/pipefail trap that killed the script before tagging, and a
  flaky test-grep (now retry-once like pre-push). Tag pushed both repos.
- [x] **GitHub Releases published** — KAI v7.2.0 (Latest) + backfilled v7.1.0 on public `kai-cli/kai`
  (prior gap: last Release was v7.0.0; tags existed but no Releases).
- [x] **SF-15/18 — verify-release scrubbed-tree fix** — `verify-release.sh --target <DIR>` splits checks
  into STRUCTURAL (invocation repo) / ARTIFACT-leak-brand ($TARGET) / SECRETS (both). Bare run in
  kai went from 44 false-positive failures → 0. Feature-claim + dangling-hook verifiers now ignore
  deletion-context. PRD: `MEMORY/WORK/20260610-175307_verify-release-scrubbed-tree/`.
- [x] **Live brand leak CLOSED** — `frontend/src/App.tsx` shipped "KAI Board" to public kai because
  `.tsx`/`.css` were in NO brand/PII scrub glob. Added to all globs (sync-to-kai SHARED_FILES + BRAND_FILES
  + post-sync guard; sync-ci-gate scanForPII; verify-release). Re-synced → App.tsx now "KAI Board",
  regression-proven.
- [x] **devices.json leak path closed** — gitignored but rsync ignores gitignore; real router serials +
  Tailscale creds reached sync (post-guard caught it). Added to EXCLUDE_PATHS + STALE_PERSONAL_FILES purge.
  Never exposed publicly (verified via gh code-search + history).
- [x] **CI hardened for Linux** (3 env-specific bugs that passed on macOS): portable `sed_i` helper
  (BSD `sed -i ''` no-op'd the entire scrub on Linux); ripgrep installed in CI (MemorySearch dep — the
  long-standing kai red); algorithm-state.ts lazy PAI_DIR resolution (module-const clobbered by
  Bun parallel runner — same class as [[feedback_parallel_test_home_env]]); checkpoint.ts seq tiebreak
  (same-ms saves collided on fast CI). Both repos' CI now green.
- [x] **Steering rule added** — "Empty/null/error output is inconclusive, never confirmation" (CRITICAL)
  in AISTEERINGRULES.md; born from real assumption failures this session.
- [x] **Automate skill added** — `/automate` launches headless `claude -p` agents fenced by --allowedTools.
  Personal profiles (`automations/`) gitignored. Skills 69→70 (kai) / 68 (kai, sync-excluded subset).
- [x] **Artifact-gate REMOVED (won't-do)** — built an over-engineered Linux-fragile post-scrub CI gate, then
  deleted it after verifying its leak classes are already covered (PII scan blocks codenames; .tsx glob fix
  closed the brand class). Redundant defense-in-depth not worth the OS-portability surface. The lesson: the
  source-glob fix was the real fix; the gate was scaffolding.
- **Known follow-up:** sync overwrites kai's manifest.json with kai's skill count (70 vs kai's 68) —
  must regen kai manifest after each sync. Candidate: have sync-to-kai regenerate kai's manifest. LOW.

### Shipped this session (2026-06-10b) — Memcarry backup + 7.2 gate confirm
- [x] **Memcarry repo backed up** — `~/Projects/NewTool/core` had NO git remote (entire codebase
  disk-only). Created **private** `github.com/YourNameYourLastName/memcarry` + pushed (sensitivity scan
  found yourcompany/feed-bbf refs → private is correct; flip public later after scrub). Committed pending
  worktree-concurrency test + fixture PII-genericization (26 tests pass).
- [x] **7.2 gate (SF-20) confirmed satisfied** — only unchecked W-item is W6b/A1/B3, explicitly
  signal-blocked & deferred past 7.2. VERSION 7.2.0 == package.json. Bump was correct.
- [x] **Weekly-maintenance cron live** — job `34e6667f` (Mondays 9:33) in `.claude/scheduled_tasks.json`
  (gitignored). Deleted orphan root `scheduled_tasks.json` (wrong location, never registered).
- [x] **Loose tree committed** — Browser `BROWSER_IGNORE_HTTPS_ERRORS` feat; deploy hook-count 54→55
  (verified 55); KNOWLEDGE distillation; NewTool atom tracked.
- [x] **Live re-verification** — memcarry (5 atoms, all 4 hooks firing, CLI resume/drift/confirm OK,
  26 tests) + PAI memory (reconcile-wiring exit 0, embeddings 3514 chunks fresh, 55 hooks no orphans)
  all confirmed working, not just documented.

### Shipped this session (2026-06-08/09/10) — pulled OUT of the backlog
- [x] **Project-dir encoder single-source** (`3b0f939`) — 7 sites, the per-project-memory-never-loaded root cause.
- [x] **Dead git-capture + state-io readJSON** (`a063da6`).
- [x] **Swallow-catch audit** — 179 catches, 0 new wrong-result bugs; ~12 silent-degrade → SF-9 (`2ecb565`).
- [x] **algorithm-state.ts test** — 18 tests, lib coverage 32→33 (`ce3857e`).
- [x] **KAI public sync** — full 7.2.0 sync, 5 PII/leak classes fixed, divergence-proof pre-push (kai `f607cac`).
- [x] **Wiki-currency nudge** (`ae6e18a`) — Stop `WikiCurrency` handler + `WikiNudge` (UserPromptSubmit) keep
  project wikis current inline; nudge not gate; ~30ms/project. Docs: PAI-Wiki events/stop.md.
- [x] **Live full-system validation** — every subsystem executed; embeddings rebuilt fresh. Scorecard:
  PAI-Wiki/findings/live-validation-2026-06-08.md.

### New development (build AFTER the quick fixes — the "things we don't have")
Forward-looking gaps from the review. Each is real, evidence-backed:

**A. Observability (closes SF-9) — HIGH.** The system is "flying blind": no telemetry on hook latency, which
skills/tools actually get used, memory-recall hit-rate, or inference cost over time. Can't empirically prove
any change works (e.g. did W1 embeddings improve recall?). Build: a telemetry layer + `/health` or board view.
~1.5 sessions.

> **Concrete first wins — silent-degrade visibility (from the 2026-06-08 swallow-catch audit).** A 6-agent
> audit of all 179 swallow-style `catch` blocks found **0 new wrong-result bugs** (the 2 real ones — the
> project-dir encoding bug `3b0f939` and the dead git-capture `a063da6` — are fixed). But it surfaced ~12
> catches that *degrade silently* — a different, lower class than wrong-result, and exactly what an
> observability layer should make visible. These are the cheapest SF-9 starter tasks (each = add a
> `console.error`/metric where today there's a bare swallow):
> - **State-file corruption masked as "no state"** (reset on next run, no signal): `algorithm-state.ts:151`
>   (algorithm phase/criteria), `staging.ts:59` (draft metadata), `memory-disclosure.ts:46` (memory-meta.jsonl),
>   `notifications.ts:59` (ntfy silently off if settings.json corrupt).
> - **Unbounded growth if a cap/rotation silently fails:** `SessionCleanup.hook.ts` events.jsonl rotation
>   (~:310), ratings.jsonl capping (~:391), reflections capping (~:404).
> - **Count-read returns 0 on failure → may mis-gate harvest/synthesis triggers:** `KnowledgeSync.hook.ts`
>   :266/:283/:304 (corrupt state resets trigger counter to 0).
> - **Resume/handoff context lost silently:** `PreCompact.hook.ts:71/:203` (HANDOFF.md / algorithm-state),
>   `MemResume.hook.ts:61` (PRD next-action), `SessionAutoName.hook.ts:122` (names file corrupt → all sessions
>   lose names this run).
> - **Cosmetic-only (lowest):** `MemoryCurate.ts:547/:619` zeroed stats in a human-read report.
>
> None are correctness bugs (verified: e.g. `RatingCapture:591`'s `INFERENCE_FAILED` marker is *deliberate* and
> has fired 0× in 286 live ratings; `SessionCleanup:523` synthesis backstop is `existsSync`-guarded by design —
> both were agent over-flags). The pattern is the lesson: **a bare `catch {}` that resets/zeros/skips is an
> observability hole, not a crash.** Wiring these into the telemetry layer is the natural Phase-A scope.

**B. Close the learning loop — HIGH/STRATEGIC.** PAI *collects* ratings/instincts/reflections but never
*verifies they change behavior* — "a learning system that doesn't verify learning is just logging." Missing:
instrument whether a promoted instinct actually prevents the repeat error; auto-surface recurring corrections;
a lightweight A/B framework to validate system changes. ~3 sessions. (Also unblocks memcarry's value-loop.)

**C. Testing blind spots — CRITICAL for confidence.** Algorithm runtime (OBSERVE→…→VERIFY) has 0 integration
tests; 70 skills have 0 activation/routing tests; the board has 0 E2E. A regression can ship silently. Build
an Algorithm-runtime harness + hook-lifecycle harness + skill-activation tests. ~5 sessions.

**D. Net-new capability ideas (idea-stage, justify before building):**
- **Skill-discovery recommender** — 70 skills, most undiscovered; embed the prompt, suggest a close-but-not-
  invoked skill ("this would be faster with /security"). Embeddings already exist. ~2 sessions. **HIGH adoption.**
- **Inference-budget enforcement** — cost tracked but not enforced; a session could spend $50 silently. Add
  session/task budgets + pre-skill cost estimate + confirm-over-budget. ~1.5 sessions.
- **Context-routing health auditor** — CONTEXT_ROUTING.md is hand-maintained and drifts; weekly-check active
  work-domains vs routing coverage, suggest additions. ~1.5 sessions.
- **Cross-repo concept coherence** — knowledge silos across the 15+ repos; a concept graph + coherence check.
  ~2.5 sessions. (Relates to Knowledge Cascade above.)
- **Capability versioning/rollback** — per-skill changelog + `/rollback :skill`. ~1.5 sessions. MED.

Top-3 by value (per the audit): (1) Observability — foundation for validating everything else;
(2) Close the learning loop — makes "self-improving" real; (3) Skill-discovery recommender — unlocks the 69
skills already built. Full detail: the 4 audit reports (this review).

---

## 7.3+ (candidate / parked ideas)

Triaged from the old design docs. Promote to a 7.x release when picked up.
- **Knowledge Cascade** (`knowledge-cascade-design.md`) — knowledge scattered across 6+ locations (wiki, memory,
  KNOWLEDGE/, projects) with no sync mechanism. Real unsolved problem; relates to W6/memory work. **LIVE candidate.**
- **MCP Rearchitect** (`MCP-REARCHITECT-PLAN.md`) — MCP config/discovery friction (tools "connected but not
  exposed", config single-source). Partially addressed by v5.9 MCP-resilience work; re-assess what remains. **NEEDS RE-SCOPE.**
- **MCP SSH / device-identity** (`MCP-SSH-IDENTITY-PLAN.md`) 🆕 2026-06-08 — can't reliably tell *what we're
  connected to* / *what we can access*: all 3 router-mcp devices share `192.168.1.1`, identity is alias-only
  and unverified. Plan: identify by stable hardware key (MAC/serial) + verify-on-connect + add/swap/retire
  lifecycle, structured to scale 3→N devices. **HIGH friction, LIVE candidate.** (Distinct layer from MCP Rearchitect.)
- **CrewAI pattern adoption** (`crewai-adoption-plan.md`) — borrowed orchestration patterns mapped to releases.
  **PARKED** — revisit if multi-agent orchestration becomes a priority.
- **Steering enforcement** (`steering-enforcement-design.md`) — was "ready for v5.3.0"; likely shipped
  (PlanApprovalGuard). **VERIFY shipped → archive.**

---

## Tracked issues (open SF tickets)

Full detail: `PAI-Wiki/findings/session-findings-2026-06-05.md`. Status synced 2026-06-07.
**OPEN only** (done tickets folded into history): SF-1/4/7/10/11/12/13/14/16/17/19/20/24/25/26/27/28 are ✅ DONE.

| Ticket | Type | Summary | Status |
|--------|------|---------|--------|
| SF-2 | INFRA | Full `bun test` panics on exit (bun 1.3.9) — forces per-file runs | OPEN (environmental) |
| SF-3 | ENHANCE | MemoryRecall scorer relevance is keyword-only — wire embeddings (pairs with W6). **Confirmed live 2026-06-08**: a relevant query scored only 33% | OPEN |
| SF-5 | PERF | transcript-cache could skip the 150ms settle wait on a hit | OPEN (minor) |
| SF-8 | TEST | No concurrency harness for cross-subprocess transcript-cache | OPEN |
| SF-9 | TEST | No runtime telemetry (cache hit-rate, scorer A/B) for long-term validation; + ~12 silent-degrade catches need visibility (see Observability §A — swallow-catch audit 2026-06-08) | OPEN |
| SF-15/18 | PROCESS | Sync verification scans kai not KAI; CI uses `--warn-pii` so non-blocking | OPEN (compensated) |
| SF-29 | PLAN | `pai-streamlining-plan.md` is ~40% stale — see "Open follow-ups" below | OPEN (triaged) |
| SF-30 | INFRA | usp/acsplatform MCP controller unreachable — ✅ **EXPECTED**: AWS ACSPlatform intentionally shut down (cost, not in use). Not a fault. | RESOLVED (by design) |
| SF-31 | INFRA | router M62 (`EXAMPLESERIAL26001024`) unreachable / `uhttpd:false` — ✅ **EXPECTED**: M62 not currently connected. Not a fault. | RESOLVED (by design) |
| SF-32 | OPS | Embeddings index drifted 49 files stale before manual `--incremental` (2026-06-08) — add rebuild to weekly maintenance so semantic routing doesn't silently degrade | OPEN |

Full live-validation scorecard: [[PAI-Wiki/findings/live-validation-2026-06-08]].

---

## Open follow-ups (post-7.2, low-priority — written down so they aren't lost)

Concrete, validated, optional cleanup items surfaced during the 2026-06-07 audit. None are blockers; the
system is verified-healthy. Each is independently shippable.

### From the streamlining-plan triage (SF-29) — the SALVAGEABLE ~60%
The plan at `~/Projects/Plans/pai-streamlining-plan.md` was validated against live code: **do NOT execute it
as-written** (Track 2 lists 5 LIVE libs as orphans; Track 4b targets the already-deleted PromptAnalysis).
The genuinely-valid pieces, pulled in here:

- [x] **Archive 1 confirmed-dead lib** ✅ DONE (`2b0c139`): `hooks/lib/hook-perf.ts` → `.archive/`. Re-verify
  (incl. `scripts/`) found `credential-validator.ts` LIVE (`scripts/dev-team.ts:31`) + `prd-template.ts` LIVE
  (`PAI/Tools/algorithm/prd.ts:7`) — the "3 dead" claim was wrong; only hook-perf archived.
- [x] **Single-source secret patterns** ✅ DONE (`2b0c139`): pivoted from a full hook-MERGE to extracting
  `hooks/lib/secret-patterns.ts` (UNION = 18; SecretScanner had 16, SecretOutputDetector 9 — NOT identical).
  Both hooks import it; SecretOutputDetector re-exports for its test + the audit-loop log contract. Same
  anti-drift win as PII, LOW risk, every original regex byte-preserved. (Full merge was rejected: shim +
  log-contract + event-dispatch on a security hot-path wasn't worth it.)
- [x] **Skill archival (isolated 4)** ✅ DONE (`2b0c139`): AuditMemory, DecisionLog, OneOnOne, WeeklyStatus →
  `skills/.archive/` (0 router refs each). manifest 89→85. **DEFERRED:** SECUpdates/OSINT/Investigation/
  PrivateInvestigator — they have router refs (Investigation 5, OSINT 3), need router updates in the same pass.
- [x] **Utilities/ dedup** (Track 1) ✅ DONE (`1c10e6e`, 2026-06-08): validated via usage signals — the
  Utilities router + all 12 nested copies had **0 invocations** in 12,617 transcripts (no `/router:child`
  call ever happened, for ANY router). Rescued Fabric (the real 318-file impl was hidden here; standalone
  `/fabric` was a broken 2-file skeleton), AudioEditor, Delegation, MCPSetup; deleted the rest. manifest
  85→70. Full architecture writeup: `PAI-Wiki/concepts/skill-discovery-and-routers.md`.
  **The OTHER meta-routers (Thinking/Security/Scraping/Documents/Media) are NOT duplicative** — their nested
  children have no top-level twin, so they're legitimate. No further dedup needed there.
- [x] **Skill archival (router-referenced 4)** — ❌ **WON'T DO** (validated 2026-06-08). Quantified the cost:
  the 4 (SECUpdates/OSINT/Investigation/PrivateInvestigator) total **464K / 1.3% of skills/** and **~245
  tokens/session**, with **ZERO idle runtime cost** (skills load only when invoked). Archiving saves ~nothing
  but costs 4 router-rewrites + dangling-ref risk — and the evidence says keep them: PrivateInvestigator was
  invoked, OSINT/Investigation are referenced as live capabilities by the Security stack (Recon/WebAssessment/
  Research). The 2026-06-05 "archive" was a tidiness instinct that doesn't pay off when measured.
- [x] **OSINT fork** ✅ DONE 2026-06-08 — confirmed Fabric-style: nested `Investigation/OSINT` (15 files) was
  the superset (had the 2567-line SOURCES.JSON source DB + Domain/Organization/DiscoverSources workflows) while
  the registered top-level `/osint` (10 files) was the lesser fork MISSING its source database — a latent
  capability gap. Promoted the superset → top-level `skills/OSINT` (so `/osint` gains SOURCES.JSON), repointed
  the Investigation router, removed the nested copy. Skills 70→69. All counters agree; skills-lock verified.
- [x] **Streamlining plan retired** ✅ DONE (`6f9b0e5`): the orphan `~/Projects/Plans/pai-streamlining-plan.md`
  was deleted after its salvageable content was folded here (SF-29).

### From the full audit (2026-06-07/08)
- [x] **Skill-count single source** ✅ DONE (`14dafaa`, 2026-06-08): skill-counting was copy-pasted across 8
  sites and drifted — the pre-push gate (982eb0e) then CI (a87c660) failures, and a LIVE bug where the
  statusline showed 46 skills (UpdateCounts top-level count) while manifest said 70. New
  `hooks/lib/skill-count.ts` is the single recursive source; GetCounts + UpdateCounts delegate to it; all 8
  counters now agree at 70. *(Bash/YAML gate counters still inline `find` — consistent, could later call
  `GetCounts --single skills`; noted, low value.)*
- [x] **ReadActivity.hook.ts test** ✅ DONE 2026-06-08 — `tests/ReadActivity.test.ts` (10 tests). Extracted the
  two branch gates into pure exported predicates (`isRoutingRead`/`isMemoryRead`) used by BOTH the live
  branches and the tests (single source, no drift); covers routing vs memory dispatch, path-disjointness, and
  the memory branch's real meta-write end-to-end. Export-only refactor, no behavior change.
- [x] **SF-2 root-cause** ✅ DONE 2026-06-08 (root-caused, no build needed): NOT our code — tests pass, then
  Bun panics tearing down the `onnxruntime-node` NAPI addon (`@huggingface/transformers`). macOS-only; CI
  green. Upstream [bun#30431](https://github.com/oven-sh/bun/issues/30431), fix in-flight (PR #30291; Linux
  already fixed in 1.3.14). **Decision: wait for upstream (~1.3.15+), don't work around.** Validate passes
  per-file / grep `0 fail`. (Bumped local bun 1.3.9→1.3.14.)

### From the live-validation sweep (2026-06-08) — every subsystem executed
Full scorecard: `PAI-Wiki/findings/live-validation-2026-06-08.md`. The product is healthy under live fire —
all 4 security guards block real attack inputs, memcarry resume/recall resolve correctly (the encoding fix
confirmed end-to-end), inference engine + board + statusline all respond. Remaining actionable items:
- [x] **Embeddings index fresh** ✅ DONE 2026-06-08 (live): index was 49 files stale (built Jun 4) → ran
  `EmbeddingIndex.ts --incremental` → 3514 chunks fresh. Incremental skip-logic verified working (2nd run:
  "170 unchanged"). **Follow-up SF-32**: add this rebuild to weekly maintenance so it doesn't drift again.
- [x] **SF-30 — usp/acsplatform controller unreachable** ✅ RESOLVED (by design): the AWS ACSPlatform instance was
  intentionally shut down (cost — not in use). The DEVICE_UNREACHABLE from `usp_controller_health` is expected;
  the usp MCP server itself is healthy (10 tools registered). Restart the AWS instance if/when USP work resumes.
- [x] **SF-31 — router M62 unreachable** ✅ RESOLVED (by design): M62 (`EXAMPLESERIAL26001024`) is not currently
  connected. The earlier successful `router_health` read was from a cached/prior connection; it's offline now
  by choice, not broken. Reconnect when lab testing resumes.
- [ ] **SF-32 — weekly embeddings rebuild.** Wire `EmbeddingIndex.ts --incremental` into WeeklyMaintenance so
  semantic routing (Layer 2) doesn't silently degrade as memory grows. Small, mechanical.
- **SF-3 confirmed live** (no new ticket): a clearly-relevant MemoryRecall query scored only 33% — the
  keyword-only scorer limitation is real and observable. Wiring embeddings into recall scoring (pairs with W6)
  is the fix.
- **SF-15/18 confirmed accurate** (no new ticket): `sync-ci-gate --warn-pii` exits 0 (matches green CI); 28
  files carry brand/identifier strings as a known non-blocking warning. A focused real-leak review (is any
  actually public-synced?) remains optional.

### Signal-blocked (cannot build now — need weeks of rated use, NOT code)
- [ ] **W6b** (live jina recall), **A1** (ingestion: MemoryRecall hit + good rating → lesson atom), **B3**
  (atom reinforcement) — all gated on memcarry store accumulating real lessons. See `memcarry-plan.md` +
  `PAI-Wiki/memory/memcarry-architecture.md`.
- [ ] **SubagentStop** (SF-25) — investigated, deferred: metadata-only payload, learning redundant with
  parent-transcript capture; only speculative telemetry is net-new. Revisit if per-agent metrics become a need.

---

## Full shipped history (≤ v6.0.0)

Condensed from the former NEXT-STEPS.md. Detailed per-version plans in `archive/`.

| Release | Date | Highlights |
|---------|------|-----------|
| v6.0.0 | 2026-05-22 | Input Classification, Multi-Harness Agents, Workflow Templates, Spec-Driven Dev, Algorithm v3.14.0 — 995 tests |
| v5.9.x | 2026-05-22 | Installer wizard, setup/doctor/keys CLIs, Skills Lock, Settings Schema, MCP resilience, Board UX |
| v5.8.0 | 2026-05-21 | Adapter architecture, session lifecycle, name locking |
| v5.6.0 | 2026-05-20 | Progressive disclosure memory, instinct learning, embedding fallback |
| v5.5.0 | 2026-05-19 | KnowledgeHealth, AutoConsolidate, ContradictionDetector, MemorySearch, WikiQuery |
| v5.3.0 | 2026-05-15 | PlanApprovalGuard, /end skill, kai first public release |
| v5.0.0 | 2026-04 | Algorithm v3.13.0, memory curation, self-learning loop, security hooks |
| v4.x | 2026-03 | Ralph Loop, multi-agent orchestrator, Board, security hooks, EM/PLM workflows |
