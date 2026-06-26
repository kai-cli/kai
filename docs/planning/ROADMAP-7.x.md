# PAI / KAI Roadmap — 7.x

> **Single source of truth for the 7.x line.** Consolidates what was scattered across ROADMAP.md (v6-era),
> NEXT-STEPS.md, and assorted design docs. Created 2026-06-05.
>
> - **kai** = private live installation (source of truth). **kai** = scrubbed public fork (`kai-cli/kai`).
> - Workflow: develop in kai → `sync-to-kai.sh` (PII scrub + brand) → verify → push.
> - Active execution detail for the consolidation effort lives in `~/Projects/PAI-Wiki/findings/`
>   (`execution-plan.md` = the W-workstream driver; `session-findings-2026-06-05.md` = SF tickets).
> - Pre-7.x version plans are archived in `docs/planning/archive/`.
> - **Codex systematic review integrated 2026-06-22** — findings `PAI-SR-001…105`
>   (`~/Projects/codex-review-notes/pai-systematic-review/`, roadmap synthesis in
>   `claude-cli-improvement-roadmap.md`). Validated this session: every cited PAI-code defect confirmed
>   against live HEAD `d1c6511` (file:line), and every cited native Claude event confirmed present in the
>   **installed 2.1.185 binary** (the canonical event array `"SessionStart",…,"SubagentStart","SubagentStop",
>   "PostCompact","InstructionsLoaded","ConfigChange",…` is literally embedded; public docs lag it). The
>   Codex priority tiers map here as: **C0** → the new 7.3.4 patch; **C1** → 7.4.0 §0 event migration;
>   **C2** → `MEMORY-ARCHITECTURE-PLAN.md` (decoupled); **C4** → SF-35 + SF-15/18; the Codex *adapter* work
>   is tracked only in `~/Projects/pai-codex/docs/CODEX-INTEGRATION-PLAN.md`. **This validation corrected one prior roadmap error** — see the
>   7.4.0 §0 note on `SubagentStart/Stop`.

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
- [~] **SF-15 / SF-18 — sync verifies the wrong tree.** Partially fixed in 7.2.0 by adding
  `verify-release.sh --target <DIR>`, but **not fully closed**: `sync-to-kai.sh` still invokes the PAI-side
  verifier from inside KAI **without `--target "$KAI_DIR"`** (`scripts/sync-to-kai.sh` Step 6), so artifact
  checks can still be skipped. Broader Codex review also found live-KAI mutation before verification,
  regex-based scrub semantics, and divergent policy sources. This is no longer LOW; it is the 7.4.0
  **KAI release hardening** block below.

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
_The still-open quick-fix items (getAlgorithmVersion/ensureDir helpers, oversized-file splits, session-state
merge, stray .bak delete, and the unfinished hook-stdin/expandPath/state-io migrations) now live in the
**🔧 Refactor / tech-debt backlog** below — single source, no drift._

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
- **Follow-up moved:** sync overwrites kai's manifest.json with kai's skill count (70 vs kai's 68).
  This is now homed in **7.4.0 §5 KAI release hardening** as "KAI manifest/count regeneration in sync."

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

**A/B/C above are the audit's reasoning record** (the *why* behind the work). A landed in 7.4.0; B and C
are now targeted in the **📋 Backlog** (7.7.0 and 8.0.0). **D — net-new capability ideas** (skill-discovery
recommender, inference-budget enforcement, context-routing auditor, cross-repo coherence, capability
versioning/rollback) are likewise all homed in the Backlog with target releases — see there, not here, so
they can't drift. Audit Top-3 by value: (1) Observability [→7.4.0], (2) Close the learning loop [→7.7.0],
(3) Skill-discovery recommender [→7.6.0].

---

## 7.3.2 (patch — SHIPPED 2026-06-18) — memory-safety guards

Full detail in `CHANGELOG.md`. **Patch scope = fixes + recurrence guards only**, all built + tested:
- [x] SecurityValidator `rm`+`mv` memory guard (4 pattern files, 6 unit tests)
- [x] Format-judgment steering rule (`AISTEERINGRULES.md`, CRITICAL)
- [x] sync-to-kai atomicity (`.git/.sync-scrub-in-progress` sentinel + pre-commit/pre-push refusal)
- [x] CWD-mismatch detection at SessionStart (`env-check.ts` `detectCwdMismatch`, 9 tests; `.claude/`
      deliberately NOT a marker — it's the catch-all dir's own side-effect)
- [x] CWD startup docs (`PAI/MEMORYSYSTEM.md`)

The net-new memory *capabilities* this incident motivated are NOT here — they're the 7.4 minor below.
(History note: the `3a62455` draft coupled this patch into 7.4 via a "graduating from 7.3.2" section,
duplicating every item across both. That coupling was the error — a patch must ship as a patch.
Decoupled 2026-06-18; all items verified against live code.)

---

## 7.3.3 (patch — SHIPPED 2026-06-22) — nested-depth guard + memory census

Follow-up to 7.3.2, motivated by the workspace-reorg review: the reorg goes depth-2
(`~/Projects/<Domain>/<project>`), which re-armed the catch-all blind spot 7.3.2's depth-1 check
couldn't see. Built + tested this session:
- [x] `detectCwdMismatch` extended to warn for `~/Projects` **and all marker-less descendants**
      (was HOME + immediate children only); added `.pai-project` sentinel to `PROJECT_MARKERS` so
      non-git project leaves stay silent (`env-check.ts`; `EnvCheck.test.ts` 26→29 tests, all pass)
- [x] `scripts/memory-census.ts` 🆕 — ground-truth per-key census: depth-1 live count vs `.archive/`,
      recency, source-folder-exists, and `RETIRED`-tombstone detection → purge-safe verdict. Built to
      kill the false-counting failure (relative-path cwd resets returning 0; hand-typed count tables)
- [x] Reorg-execution rule: non-git leaves get a `.pai-project` sentinel on move (plan §9b step 1b)
- [x] Memory consolidation done this session: Project-Board/Automation → kai; Synergy(10) +
      speedtest fact → Knowledge; 5 stale keys retired via tombstone redirect (content preserved)

### Shipped this session (2026-06-22b) — INSIGHTS promotion path repair + triage drain
Follow-on to the census: the census surfaced **172 insight candidates** piled up in
`MEMORY/LEARNING/INSIGHTS/` with no way out. Root-caused two defects (one of them a standing Codex
finding) and drained the queue. Built + tested this session:
- [x] **`pai curate promote <file> [--project <p>]` built** — **closes PAI-SR-074** (the curator
      printed "Promote with `pai curate promote …`" but the switch in `MemoryCurate.ts` had **no
      `promote` case** — insights could never leave `status: candidate` by hand). New command parses an
      INSIGHTS candidate, appends it to a per-project consolidated `insights_promoted.md`, updates
      MEMORY.md, and flips the source to `status: promoted` (audit trail, no delete). Idempotent
      ("Already promoted"); end-to-end temp-dir verified.
- [x] **InsightExtractor test-pollution fixed** — `tests/InsightExtractor.test.ts:218` ("does not
      overwrite") called `writeInsight` **in-process**, which writes to the module-const real
      `INSIGHTS_DIR`; its cleanup used `process.env.HOME` (clobbered by parallel `ApiKeys.test.ts`) →
      one `YYYY-MM-DD_duplicate-test.md` orphaned into the **live store per test-run day** (23 had
      accumulated). Now runs in a subprocess with isolated `PAI_DIR`; a full run adds 0 new files.
      Same class as [[feedback_parallel_test_home_env]] / the algorithm-state.ts CI fix. 38 tests pass.
- [x] **Triage executed** — 172 candidates classified (3 parallel agents, per-row authority): 23
      verified-noise (the duplicate-test files) + 20 user-confirmed judgment-drops **deleted**; **129
      promoted** (kai 66, yourcompany-firmware 20, mcp-tooling 19, feed-bbf 10, instant-test 9,
      synergy 3, personal 2). 0 candidates remain. INSIGHTS is NOT in any SecurityValidator protected
      list (verified — KNOWLEDGE/WISDOM are; deletion permitted). PRD:
      `MEMORY/WORK/20260622-110000_insight-triage-promote-command/`.
- **Known follow-ups (→ backlog):** the 7 new `insights_promoted.md` files are not yet recall-wired
      (memory-architecture track); bulk promote needed a throwaway script — a `promote --from-manifest`
      batch mode would make future drains one call.

---

## 7.3.4 (SHIPPED 2026-06-22 — patch) — Codex C0: hook-contract & security-correctness repair

**Theme: make Claude's actual behavior match what PAI *thinks* is happening.** These are the Codex
**C0 / P0** items — verified-real defects where a hook silently does nothing, mis-reads a current payload
field, or emits an output shape the 2.1.185 binary no longer honors. Patch scope = **fix + recurrence
guard only** (same doctrine as 7.3.2/7.3.3). Each item carries its validated finding ID. **No new
capabilities here** — those are 7.4.0+.

**All 6 items shipped on branch `fix/7.3.4-pretooluse-ask-contract` (off main), each with a
regression-gate test. Full affected surface: 372 pass / 0 fail across 17 files.** Commits:
`1e5999d` (#1), `1c0190c` (#2), `061bd39` (#3), `767bfee` (#4), `fbaa4ac` (#5).

**Why a patch and not 7.4.0:** these are correctness regressions against the *installed* contract, not
features. Every one was confirmed this session against live code AND the 2.1.185 binary.

**Execution order inside this patch:**
1. Fix the PreToolUse security ask contract and SecretScanner prompt field.
2. Gate/redact unsafe KNOWLEDGE injection.
3. Fix generated-settings reproducibility.
4. Fix ModeClassifier natural-language shell false positives.
5. Fix or retire the global LastResponseCache/FormatReminder bridge.

**Rollback / disable discipline:** every hot-path change in this patch needs a clear off-ramp: feature flag
or config gate where practical, targeted tests proving both enabled/disabled behavior, and a documented
manual rollback (revert-only is acceptable for schema fixes; flags are preferred for memory/context changes).

- [x] **PreToolUse `ask` output is invalid for current schema (2 guards)** ✅ `1e5999d` (PAI-SR-005) — the confirm
      path emits top-level `{"decision":"ask",…}` in **both** `SecurityValidator.hook.ts:462` **and**
      `WebFetchGuard.hook.ts:111-114` (verified 2026-06-22); 2.1.185 honors top-level `decision` only for
      `"block"`. An ask/escalation must be `hookSpecificOutput.permissionDecision:"ask"` +
      `hookEventName:"PreToolUse"` (both strings confirmed in the binary). **Impact: commands/fetches PAI
      believes require confirmation can run unconfirmed.** `GitHubWriteGuard.hook.ts:246` and
      `SkillGuard.hook.ts:74` are **NOT affected** — they emit `{decision:"block"}`, which is valid. Add a
      contract test feeding each guard's output through the current-schema shape. **P0.**
- [x] **SecretScanner reads the wrong prompt field** ✅ `1e5999d` (PAI-SR-030) — reads legacy `input.user_prompt`
      (`SecretScanner.hook.ts:66`); current UserPromptSubmit supplies `prompt`. A synthetic AWS-key probe
      returned `{continue:true}` (undetected). Fix: read `prompt`, return `decision:"block"` +
      `suppressOriginalPrompt:true` (UserPromptSubmit has no `ask`); never echo the secret. **P0.**
- [x] **Generated settings are not reproducible from source** ✅ `061bd39` (PAI-SR-001) — active `settings.json`
      carries top-level `model` + `autoMemoryDirectory` and 52 hook commands; `buildSettings()` produces
      neither key (and 51 commands) → a rebuild can silently drop the model override, Auto Memory
      relocation, and the AgentMemoryCapture registration. Put intentional machine-local root settings in a
      canonical source + add a **semantic source→generated equivalence gate** (allowlist runtime-only
      fields). **P0.** (Pairs with the reproducibility note in
      `~/Projects/pai-codex/docs/CODEX-INTEGRATION-PLAN.md`.)
- [x] **Gate automatic KNOWLEDGE / cross-project injection** ✅ `1c0190c` (PAI-SR-031/073/075) — see the reframed
      7.4.0 §2 item; the **deny-by-default flag flip lands here** as the immediate safety fix (preserve files,
      stop auto-injecting other-project bodies) ahead of the proper scope model. **Also add a redaction guard:**
      `knowledge-readback.ts:53-67` injects a KNOWLEDGE file body verbatim with **zero redaction**, and
      `MEMORY/KNOWLEDGE/security.md:37` holds a plaintext credential (`acsplatformuser:…`). **Latent, not active**
      (verified 2026-06-22 — no project currently maps to the `security` domain in `domains.jsonc:61-84`, so
      it isn't injected today; the ~200 logged injections are other domains), but it's one domain-mapping line
      away from leaking creds with no guard. Add credential/IP redaction to the readback path regardless of the
      domain gate. **P0 privacy.**
- [x] **ModeClassifier infers shell from natural language** ✅ `767bfee` (PAI-SR-040, VERIFIED-BUG) — first PATH
      binary + ≥1 word ⇒ p_shell≈0.95 (`input-classifier.ts:63-76`); "test the theory" / "write a report"
      both misclassify as shell because `test`/`write` are binaries. **This harms behavior — it is not a
      designed constraint.** Fix: trust only the explicit `!` prefix; add a false-positive demotion for
      common-word binaries. (The "plan a vacation → ALGORITHM" sub-claim was **refuted** — intentional verb
      detection.) **MED, fix regardless of the mode-ceremony product question.**
- [x] **FormatReminder / LastResponseCache use global cross-session state** ✅ `fbaa4ac` (PAI-SR-041,
      VERIFIED-BUG) — both read/write one global `MEMORY/STATE/last-response.txt` with no session_id
      (`LastResponseCache.hook.ts:32`, `FormatReminder.hook.ts:55`) → session B's output gets attributed to
      session A. Fix: session-key the cache (or retire it if only RatingCapture needs it). **MED, fix
      regardless.**

**Exit criteria:** security prompts/blocking work under the 2.1.185 schema (contract test green); no
automatic context path injects another project's memory body by default; a rebuild cannot drop the model
override / Auto Memory relocation; natural-language prompts are never re-interpreted as shell; format/rating
state cannot cross sessions.

> **Deferred from C0 to a design track, not this patch:** PAI-SR-002 (AlgorithmTracker wired to `Stop` but
> implements PostToolUse logic — dormant) and PAI-SR-003 (AgentExecutionGuard/AgentMemoryCapture target the
> retired `Task` tool) are **event-migration**, not contract-repair → they live in 7.4.0 §0 below because
> the fix is "re-wire to the right native event," which is a design choice, not a one-line correction.

---

## 7.4.0 (DRAFT — minor) — ADA + native-event foundation

**Theme: Stop re-teaching Claude by landing the safe foundation: generated ADA packs/procedure configs,
current-Claude native-event hook wiring, and KAI release-hardening gates.** Follow-through activation work
continues in **7.4.2**; memory/observability remains decoupled into `MEMORY-ARCHITECTURE-PLAN.md` and
`MEMORY-SPINE-SPEC.md`.

**Cross-release execution order from the Codex review:**
1. Finish 7.3.4 C0 safety items first.
2. Land the KAI §5 patch-now items before any public release.
3. Then proceed with current-Claude event migration (§0).
4. Then ADA/memory/observability work.

**Codex dependency note:** do not start broad Codex memory integration until the 7.3.4 C0 safety items are
complete and the sanitized memory envelope exists in the memory track. The Codex adapter can remain a
read-only validator in parallel, but it must not consume raw KNOWLEDGE, transcripts, SECURITY, STATE, or
inferred learning stores.

**Lead theme — Ambient Domain Activation (ADA).** Added 2026-06-19 as the **#1 stated pain point**:
re-teaching procedural/operational knowledge every session (device locations, home-router state,
GitHub workflows) and re-checking the wiki for repo conventions/branch targets that should be
ambient. Root cause: activation is PULL + advisory (`LocalContextFirst` nudges "check the wiki"
instead of loading content). ADA makes it PUSH. **Feasibility verified against Claude Code's actual
design (claude-code-guide, 2026-06-19)** — see `ambient-domain-activation-design.md` for the full
design, the feasibility table, and the hard constraints (heavy knowledge → a project-local
CLAUDE-family file, not per-turn context; pack content lives in a gitignored `CLAUDE.local.md` so it
never enters company/public repos; Agent subagents load it natively, only Explore/Plan + SDK/background
need delegation injection).

ADA = three tiers, all **generated from `REGISTRY.md` (single source)**, never hand-maintained.
**Rev 2 (2026-06-19)** after holistic review + WARP + claude-code-guide pass 2 — see design doc:
- [x] **T1 — Repo context pack** ✅ **Group A shipped in PR #13** — pack content generated from REGISTRY into
      `~/.claude/ada/packs/<repo>.md`; each repo gets a **gitignored `CLAUDE.local.md`** that just
      `@import`s its pack (branch target e.g. feed_bbf→`usp_ui`, conventions, protocols, wiki/MCP
      pointers, gotchas). **Leak-proof** — no pack content in company/public repo trees; `CLAUDE.local.md`
      added once to `~/.gitignore_global`. Auto-loads + survives compaction + reaches Agent subagents
      natively (★★★ verified). Privately activated and verified for feed_bbf + feed_yourcompany.
- [x] **T2 — Procedure cards / branch guard** ✅ **shipped in PR #15** — **extend existing `GitHubWriteGuard.hook.ts`**
      (already PreToolUse on git commit/push/PR — do NOT add a 2nd racing hook); inject repo checklist
      before the write approval block; hard-block wrong git push / PR base for configured ADA repos via
      `{decision:"block",reason}`; `ADA_BRANCH_GUARD_OVERRIDE=1` bypasses only the ADA branch block and logs
      to `MEMORY/STATE/ada-branch-guard-overrides.jsonl`. Non-ADA repos fail open to the existing GitHub
      write approval flow. The "automatic code check-in" the user asked for (★★★).
- [x] **T3 — On-demand domain knowledge** ✅ **implemented in 7.4.2 branch** — targeted fix in
      `LocalContextFirst`: the domain-match branch now injects retrieved `MEMORY/KNOWLEDGE/<domain>.md`
      content, with redaction, truncation, and missing-domain reporting, instead of only emitting a
      pointer/check-the-wiki nudge. Not a rewrite (★★).
- [x] **ADA generation spine** ✅ **Group A shipped in PR #13** — extend REGISTRY schema
      (conventions/checkin_procedure/gotchas) → generator (with **per-pack token budget cap**) → **drift gate**
      (CI+weekly, must-actually-fail test) → **HUMAN-CONFIRMED self-feeding capture** (End-skill /
      `/ada-capture` proposes REGISTRY edits, user confirms before write — **deferred to 7.4.2/7.5.x after
      read path proves out**). This loop is what ends re-teaching. **Concrete build spec: `ada-build-spec.md`** —
      REGISTRY row format, parser contract, generator I/O, pack template + ≤120-line budget, drift-gate
      test shape, and settled §7 decisions (pack location, first adopters, hard-block branches).
- [ ] **T4 — Operational/environment state** `parked` 🆕 2026-06-19 → **phase 2 / later target** —
      device locations + live router state (devices.json + router-mcp); the user's first example but
      it's operational STATE not repo-domain. Deferred to limit initial blast radius; re-target at
      scoping (may reuse ADA machinery or be separate).

ADA's measurement comes from the decoupled memory/observability track (proves the re-teach rate dropped).
Subagent reach is mostly native now (Agent subagents load `CLAUDE.local.md`); only Explore/Plan +
SDK/background need the narrower 7.5.x delegation injection. Remaining build order after 7.4.0:
**7.4.1** stabilization → **7.4.2** T3 + private validation → **7.5.0** subagent context MVP →
**7.5.1/7.5.2** resilience/reach.

---

### 0. Codex C1 — current-Claude native-event migration `scoping` 🆕 2026-06-22

**Theme: stop inferring lifecycle state from transcripts and retired tool names; use the 2.1.185 native
events directly.** All event names below were confirmed present in the installed binary's canonical event
array this session. This block is the home for the **C0-deferred** wiring fixes (PAI-SR-002/003) plus the
broader migration (PAI-SR-004/006/007/099). Foundational item first.

- [x] **Versioned native-event payload-schema coverage + gate** ✅ `4ac74b9` (PAI-SR-013, C1.1) — extended
      `payload-schema.ts` from 6 → 11 events (added PreCompact, ConfigChange, WorktreeRemove, TaskCompleted,
      TeammateIdle) with **binary-verified current field names** (`source`/`task_subject`/`teammate_name`, NOT
      legacy `config_path`/`subject`/`owner`). `HookEventCoverage.test.ts` is the release gate — fails if a
      settings-registered event lacks a schema, and guards legacy field names from creeping back. The
      substrate the rest of §0 builds on. (Full per-event fixtures w/ golden payloads can extend this later.)
- [x] **AlgorithmTracker — fix the lifecycle wiring** ✅ `d2bb2f4` (PAI-SR-002) — was registered **only under
      `Stop`** while reading PostToolUse fields → fully dormant. Moved to `PostToolUse` matcher
      `Bash|TaskCreate|TaskUpdate|Agent` in `config/hooks.jsonc`; branch 4 now matches current `Agent` tool
      (was retired `Task`). Verified live: a PostToolUse Agent payload now tracks the spawn; reconcile-wiring
      reports no drift.
- [x] **AgentExecutionGuard / AgentMemoryCapture — `Task` → `Agent`/subagent events** ✅ **shipped in PR #14** (PAI-SR-003) —
      both target the **retired `Task`** tool (`settings.json:132-138`; capture rejects `tool_name!=="Task"`).
      Move to `SubagentStart`/`SubagentStop` (or `PostToolUse` matcher `Agent` when parent injection is
      needed). Replace legacy Task terminology in hooks/tests/docs/spinner tips. PR #14 moved active hook
      wiring to current `Agent`, wired `AgentMemoryCapture` on `PostToolUse:Agent`, and removed active legacy
      `Task` compatibility from the native-agent path.
- [x] **Skill telemetry misses direct `/slash` invocation** ✅ (PAI-SR-004) — `SkillGuard`/`SkillTracker`
      match `PreToolUse:Skill`, which a directly-typed `/skillname` **bypasses**; 2.1.185 has
      `UserPromptExpansion` (confirmed) exposing `command_name`/args/source for exactly this path. Shipped
      telemetry-only `UserPromptExpansion` wiring into `SkillTracker`; direct slash and model-invoked skill
      usage now append to the same `MEMORY/STATE/skill-usage.jsonl` stream with a source discriminator.
- [x] **TaskCompleted / TeammateIdle / ConfigChange read legacy fields** ✅ **shipped in PR #14** (PAI-SR-006/007) —
      TaskCompleted reads `subject`/`description`/`owner` not `task_subject`/`task_description`/`teammate_name`;
      TeammateIdle returns early when `last_message` is absent (a no-op — the field doesn't exist in the
      current payload); ConfigChange reads `config_path`/`change_type` and falls back to PAI-root
      `settings.json`, so it inspects the wrong file. Fixed to current `source`/`file_path` + correct field
      names; blocking feedback now uses the channel 2.1.185 actually feeds back (stderr on exit 2, not stdout).
- [ ] **PostToolBatch for parallel-tool aggregation** `idea` (PAI-SR-099) — replace race-prone per-tool
      concurrent aggregators (lost-update-prone shared stores) where the real semantic is "after all parallel
      tool calls." `PostToolBatch` confirmed present in the binary.
- [ ] **InstructionsLoaded for instruction observability** `idea` (PAI-SR-038) — replace prompt-time
      mtime-polling of `CLAUDE.md`/rules (the global `/tmp/pai-hooks/rules-mtime.json` watcher) with the
      native `InstructionsLoaded` event (path/memory-type/reason/globs). Pairs with ADA T1/T3.

**Exit criteria:** every active hook has a current-2.1.185 fixture; no hook is registered on an event whose
payload it can't read; legacy `Task` wiring is gone or explicitly archived; direct `/slash` usage is
observable.

---

> **⚠️ MEMORY WORK IS NOW DECOUPLED — see `MEMORY-ARCHITECTURE-PLAN.md` and
> `MEMORY-SPINE-SPEC.md`.**
> Per decision 2026-06-21, all memory work (this spine §1-§3, 7.7.0 Knowledge Cascade, and the
> signal-blocked memcarry items) is consolidated into the standalone memory plan and runs as its
> own focused track. The items below remain here as **pointers with their release intent**; the
> architecture and PAI/memcarry/native rearchitecture decisions live in `MEMORY-ARCHITECTURE-PLAN.md`,
> while the executable breakout for observability, cross-project scope, and SF-3 lives in
> `MEMORY-SPINE-SPEC.md`.
> Two gating decisions (native Auto Memory disposition + memcarry integration model) are open there.

**Supporting spine — memory capabilities + observability** (was the original 7.4.0; the net-new work
motivated by the rayhunter incident). Observability leads: the rayhunter loss was invisible precisely
because there was no telemetry on memory recall/save or hook behavior — you cannot prove the 7.3.2
guards held, or that ADA/the capabilities below help, without it. Matches the 2026-06-08 audit's Top-3
("Observability — foundation for validating everything else"). All items verified against live code
2026-06-18.

**Spine (committed):**

### 1. Observability FIRST (section A from 2026-06-08 audit) — the verification substrate
- [ ] **Memory spine spec execution** — see `docs/planning/MEMORY-SPINE-SPEC.md`.
      Source-validated status as of 2026-06-23: hook runtime latency is shipped (PR #17);
      `memory-telemetry.ts`, `recall-hit-ledger.ts`, and `memory-telemetry-report.ts` exist;
      `recall.surfaced`/`recall.hit` are partially wired; `recall.latency` is partially wired and now
      includes the memcarry recall path in the 7.4.2 branch; `memory.save`/`capture.latency` have a
      first MemCapture emitter, while broad save/capture coverage and `coherence.drift` remain open.
- [ ] Telemetry layer: hook latency, skill/tool usage, **memory-recall hit-rate**, **memory-save events
      per project**, inference cost. (The two bold metrics would have made rayhunter visible on day 1.)
- [ ] Silent-degrade visibility (the ~12 swallow-catch sites from SF-9)
- [ ] `/health` or board view for runtime telemetry
- [x] ~~SF-32: weekly embeddings rebuild~~ **ALREADY DONE** — `EmbeddingIndex.ts --incremental` is wired into
      `weekly-maintenance.ts:117`. (Validation 2026-06-18 found it shipped; was wrongly still listed open.)

### 2. Memory-routing capabilities (the net-new wiring, measured by §1)
- [ ] **Cross-project recall → deny-by-default + scope model** `scoping` (PAI-SR-031, **was**
      "CrossProjectIndex surfacing") — **direction reversed after validation.** The cross-project path is
      **already live** (`MemoryRecall.hook.ts:335` injects ≤1000 chars of another project's memory on 3+
      keyword hits) with **no allowlist, sensitivity, or scope gate** — and the global index **mixes trust
      domains** (work repos `feed-bbf`/`CommunityFiber`/`ExampleWRT-Firmware` sit beside personal
      `Du-tracking`/`Resume`), so a work prompt can pull personal memory and vice-versa. So this is **not**
      "wire in more surfacing" — it's: (1) **immediate** deny-by-default flag flip → **7.3.4** above; (2)
      **here**, design the scope model (`private-global` / `project` / `shareable-global` + per-consumer
      allowlist) so cross-project transfer can be re-enabled *safely*. The scope/disclosure envelope is the
      C2 work owned by `MEMORY-ARCHITECTURE-PLAN.md` (PAI-SR-070/071/073/075) — this item is its
      cross-project consumer. Re-enable only behind evidence (§1 telemetry shows value).
- [ ] **Agent knowledge harvesting — re-wire to native subagent events** `scoping` (PAI-SR-002/003) —
      **CORRECTION (2026-06-22, binary-verified):** the prior note here ("SubagentStart/SubagentStop are PAI
      agent-teams enum values, NOT Claude-Code-native events") **was wrong.** The installed 2.1.185 binary
      embeds the canonical native event array including `"SubagentStart","SubagentStop"` — they **are**
      native events. Likewise `Task` is the **retired** tool name; the current subagent tool is `Agent`.
      PR #14 moved the immediate capture-loss guard to `PostToolUse:Agent` for parent checkpoint reminders.
      Remaining design question is whether `SubagentStop` should add completion telemetry later without
      duplicating the parent reminder path.
- [ ] MemCapture steering rule — parent must checkpoint after Agent returns

### 3. Memory recall quality
- [ ] SF-3: wire embeddings into MemoryRecall scorer (keyword-only → semantic; confirmed live 33% miss)

### 4. Sync-fidelity gate (release safety) — SF-35 🆕 2026-06-19 `scoping`
- [ ] **SF-35 — post-sync content-fidelity gate.** Nothing today proves kai's synced content matches the
      scrubbed kai source; a dropped/garbled/half-scrubbed file would ship silently. The manual
      593/594 byte-diff during the 7.3.2 release was the *only* time fidelity was checked, and by hand.
      **Why both existing tools are INVALID signals (verified 2026-06-19, do not just "wire one in"):**
      (1) `scripts/sync-drift.ts` compares **raw** kai vs kai, so it flags all ~168 intentionally
      PII-scrubbed / brand-transformed files as "drift" — AND it `exit 0`s even when it reports drift
      (its header claims exit 1; integrity bug). (2) `sync-to-kai.sh --dry-run` reports ~100 "would
      change" purely from rsync **mtime** noise — the real release commit touched only 16 files and the
      kai tree was clean. **Correct design:** after a sync, replicate the scrub+brand transform into a
      temp tree, then content-diff temp↔kai **respecting KAI_ONLY + `--exclude` lists**; any *unexpected*
      file (present/missing/differing outside the allowlist) → `exit 1`. Wire into `verify-release.sh`
      (post-sync, `--target` aware) + a test that deliberately introduces drift and asserts the gate fails
      (per the "gates must actually fail" doctrine). Also fix sync-drift.ts's `exit 0`-on-drift bug or
      retire it. ~1 session. Successor to SF-15/18 (verify-release scrubbed-tree fix).

### 5. KAI release hardening (public-artifact safety) — Codex PAI-SR-087…095/104 🆕 2026-06-22 `ready`

**Theme: prove the public artifact is safe before mutating/staging/tagging KAI.** The intended PAI→KAI
process is directionally right, but the current executable path still has release-safety gaps. This is the
focused home for the KAI-specific parts of Codex C4 and the successor work to SF-15/18/SF-35.

**Public release block:** do not cut/push a new KAI public release until the **patch-now** items below are
done and tested: verifier `--target`, literal-safe scrubber, KAI manifest/count regeneration, and tests that
fail if those regress.

**Patch-now items (✅ ALL COMPLETE 2026-06-22 — verifier `--target`, literal scrubber, dependency-closure
gate, manifest regen, regression tests; KAI public release is unblocked on the patch-now gate):**

- [x] **Fix the immediate verifier invocation** ✅ — `sync-to-kai.sh` Step 6 now calls
      `bash "$PAI_DIR/scripts/verify-release.sh" --target "$KAI_DIR"` from the PAI invocation repo. Added
      `tests/SyncToKaiVerifyTarget.test.ts` so the old missing-target form cannot regress.
- [x] **Literal-safe scrubber** ✅ — `pii-replacements.json` is documented as literal `[find, replace]`
      pairs, and sync now applies them through `scripts/literal-replace.ts` instead of unescaped `sed`
      regex substitutions. `tests/LiteralReplace.test.ts` covers dotted/IP-like strings, regex
      metacharacters, `&`, backslashes, slashes, and delimiter-like content. PR #24 batched this path so
      sync runs one literal-replace process per scrubbed file instead of one process per PII key per file,
      preserving literal ordered semantics while removing the per-key spawn fanout.
- [x] **KAI manifest/count regeneration in sync** ✅ `ca5fd33` — sync Step 5f regenerates KAI's
      `manifest.json` via `BuildManifest.ts` with `PAI_DIR=$KAI_DIR` (reads through paiPath, honors the
      override) → counts reflect KAI's actual post-transform tree (69), not kai's (71). Single source,
      no sed dup. Verified end-to-end against a temp copy of the live KAI tree.
- [x] **TypeScript-derived KAI dependency closure gate** ✅ — `scripts/sync-manifest.json`
      explicitly classifies public support paths used by public hooks/tools, and `sync-ci-gate.ts`
      reports the dependency closure. The gate fails on confirmed public→private or public→KAI-only imports,
      warns on unclassified public dependencies, and reports memory/state + hook-lib dependency surface.
      Current baseline: 0 confirmed boundary risks, 0 manifest coverage gaps.
- [x] **Patch regression tests** ✅ `ca5fd33` + `efec987` — `SyncToKaiVerifyTarget.test.ts` (asserts `--target`
      present + old form absent), `LiteralReplace.test.ts` (literal scrub vs regex), `SyncKaiManifestRegen.test.ts`
      (gates the regen wiring + proves BuildManifest counts come from its target tree, not kai's 71),
      plus dependency-closure coverage in `SyncCIGate.test.ts`.

**Full rebuild items (do after patch-now unless a release is imminent and demands it):**

- [ ] **Sanitized staging artifact before live KAI mutation** `scoping` (PAI-SR-092) — current sync mutates
      and stages the live KAI worktree before all scrub/brand/release checks complete. Rebuild around:
      `kai → temp staging artifact → scrub/brand/verify → atomic KAI update`. Failure must leave the
      KAI worktree/index clean.
- [ ] **Single release/sync manifest** `scoping` (PAI-SR-087/090) — unify shell arrays, JSON manifest,
      deploy packaging, verify checks, and CI gates. Generate sync, verify, package, and docs from one policy.
      Legacy `deploy.ts` must not define an independent public artifact surface.
- [ ] **Release/test gate wrapper** `scoping` (PAI-SR-096/097) — replace raw Bun-output greps in release,
      pre-push, and verify paths with a parser that validates requested files, complete summary, exit status,
      pass/fail counts, zero-test cases, and known Bun crash signatures.
- [ ] **Executable public docs** `idea` (PAI-SR-104) — KAI-facing release docs should describe only checks
      actually enforced by the sync/release scripts. Generate or verify docs from the same manifest/gates.

**Rollback / disable discipline:** KAI release tooling changes must be non-destructive during failure. Patch
items need targeted tests plus a dry-run path. Full rebuild work must prove that a failed sync leaves the KAI
worktree/index unchanged or restored, and must preserve a manual escape hatch to run old dry-run diagnostics
without committing/tagging.

**Exit criteria:** a KAI release candidate is built and verified as a scrubbed staging artifact before live KAI
mutation; verification explicitly targets that artifact; literal PII scrub tests pass; KAI worktree/index are
clean on failure; public docs match executable gates.

_No "candidates" limbo here by design — every not-yet-committed idea lives in the **Backlog** below with
an explicit target release. If something should pull into 7.4.0, promote it from the backlog into a spine
section above; don't leave it floating._

---

## 7.4.1 (TARGETED — patch/minor) — latency + observability stabilization

**Theme: stabilize the live Claude experience after the large 7.4.0 merge before adding more feature
surface.** This release is intentionally small and defensive.

- [x] **Prompt-path inference latency removed** ✅ **PR #16** — `RatingCapture` implicit sentiment inference
      and `UpdateTabTitle` inference are opt-in (`PAI_ENABLE_IMPLICIT_RATING_INFERENCE=1`,
      `PAI_ENABLE_TAB_TITLE_INFERENCE=1`). Explicit ratings, direct-praise fast path, and deterministic tab
      titles remain active. This removes the confirmed 10–12s per-prompt inference timeout path.
- [x] **Hook duration diagnostics** ✅ **PR #17** — `run-hook.sh` now logs START/END, status,
      `duration_ms`, and timeout flag for every hook. Future latency reports can distinguish hook runtime
      from API/model/queue latency mechanically.
- [x] **Memory spine specification breakout** ✅ — `MEMORY-SPINE-SPEC.md` source-validates the current
      telemetry state and defines the next workstreams: observability baseline, cross-project scope model,
      and SF-3 semantic scoring in `MemoryRecall`.

---

## 7.4.2 (TARGETED — patch/minor) — ADA follow-through + private validation

**Theme: Prove the ADA foundation in private use before broadening scope.** This release should stay small:
finish the read-side ADA activation gap, capture lessons from feed_bbf/feed_yourcompany, and absorb review fixes
from 7.4.0 without pulling in the subagent-inheritance work.

**Scope guard:** do **not** start broad subagent context inheritance here. Do **not** publicize ADA to KAI here
unless private validation has produced stable, generic behavior. KAI-safe ADA publicization remains targeted
to 7.7.0.

- [x] **ADA T3 — LocalContextFirst domain-match content injection** ✅ — targeted fix: the
      domain-match branch now injects retrieved repo/domain knowledge content with redaction, per-domain
      truncation, and missing-domain reporting. It remains scoped to repo/domain knowledge, not operational
      live state.
- [x] **ADA private validation pass** ✅ — 2026-06-26 private check covered feed_bbf +
      feed_yourcompany without touching those repos: both local repos exist on feature branches, both
      `CLAUDE.local.md` files import the generated ADA pack, generated packs/procedure JSON are fresh
      (`bun PAI/Tools/ada-generate.ts --check` = 6 artifacts, 0 changed), and the current feature-branch
      shape is covered by the branch-guard refinement. feed_bbf had unrelated local untracked work, so
      validation stayed read-only. Output: explicit no-change note; no REGISTRY edits backed by this pass.
- [x] **ADA Group-A/T2 follow-up fixes** ✅ — no backed fixes found in the 2026-06-26 private validation.
      Procedure-card branch targets/checklists still match generated artifacts; branch parsing/override
      logging are already covered by the existing integration tests. Keep future T2 changes tied to a
      concrete private-flow miss.
- [x] **ADA branch-guard feature-branch refinement** ✅ — preserved the intent from the superseded
      `fix/7.4.0-ada-branch-guard-push` experiment without weakening the guard: feature-branch pushes in
      ADA repos no longer receive an ADA hard-block, but wrong protected targets (`main`/`master`, expected
      branch, or configured hard-block branches) and wrong PR bases still block. Tests cover feature-push
      allow via normal GitHub-write approval and protected-branch push block.
- [x] **Codex local trust bootstrap + hook-boundary guardrail** ✅ — keep the Claude-native
      `UserPromptExpansion` skill-telemetry fix global in PAI/Claude, but do not copy Claude-only hook
      events directly into Codex. Codex integration should use Codex-supported lifecycle events and the
      documented hook trust flow. Add `scripts/codex-trust-bootstrap.ts` so trusted local repos can be
      registered explicitly in `~/.codex/config.toml` while preserving the safer Codex posture:
      `approval_policy = "on-request"` plus trusted project entries, not global `approval_policy = "never"`.
- [x] **Auto-memory inbox isolation** ✅ — generated Claude/native `auto-memory/*.md` files are runtime
      inbox artifacts, not source. Ignore generated topic files in git and point the local
      `autoMemoryDirectory` outside the `kai` checkout (`${HOME}/.pai-runtime/auto-memory`) so
      project-specific memories from other sessions stop appearing as repo dirt. Keep `auto-memory/MEMORY.md`
      available only as an intentional index/compatibility surface; the follow-up promotion flow must reconcile
      that compatibility index with the new out-of-checkout runtime inbox.
- [x] **Auto-memory promotion flow** ✅ — add `scripts/auto-memory-inbox-report.ts`, a read-only
      classifier for the relocated native Auto Memory inbox. It routes clear project facts to project-memory
      review, reusable lesson-shaped items to human-confirmed memcarry capture review, session notes to
      unpromoted/expire, and ambiguous native files to manual review. It never promotes or writes durable
      memory directly. The 2026-06-26 live inbox pass found 5 files and conservatively left all 5 as
      manual-review because the target store was not unambiguous from content alone.
- [x] **Prompt/turn latency report** ✅ — add `scripts/prompt-latency-report.ts` as a read-only diagnostic
      for raw Claude JSONL transcripts. It reconstructs recent turns from transcript metadata and separates
      observable pre-response delay, queue delay, hook duration, tool duration, and total turn duration when
      Claude records it. This confirms whether a slow turn is hook-bound or model/queue/context-bound without
      adding any prompt-path hook work. The 2026-06-25 live validation pass confirmed recent slow turns were
      not PAI-hook bound: pre-response hooks were near zero, while Opus/cache-read/context pressure and queued
      prompt behavior explained the suspicious delay windows. Queued human prompts are now marked explicitly
      because they can be transcript-visible without `UserPromptSubmit` hook telemetry.
- [x] **Inference latency telemetry** ✅ — instrument the central `PAI/Tools/Inference.ts` wrapper so every
      local PAI LLM call records caller, provider/model/tier, timeout, success/error class, and latency
      without storing prompt/response text. `scripts/inference-telemetry-report.ts` summarizes p50/p95,
      failures, and timeout counts by caller/provider/model so Bedrock/API latency can be separated from
      PAI hook latency.
- [x] **Live checkout drift warning** ✅ — extend the existing `EnvironmentStatus` SessionStart hook with
      a local-only git status check for the live PAI checkout. If `~/.claude` / `PAI_DIR` is on a feature
      branch, detached, behind its fetched upstream, or carrying local commits ahead of upstream, Claude gets
      an explicit warning to keep the live install on `main` and do feature work in a separate clone. This
      prevents a repeat of the PR #30 branch-drift incident where merged latency tooling was absent from the
      live install.
- [x] **Agent return/context-size observability** ✅ — correlate large `Agent` returns with the next
      parent-turn pre-response delay. `scripts/prompt-latency-report.ts` now reads existing
      `agent.return.result_chars` / `agent.checkpoint` telemetry, shows cumulative and peak Agent-return
      chars since the previous user prompt, and reports transcript chars before the first assistant token.
      This keeps context-pressure analysis offline and avoids adding any prompt-path hook work.
- [x] **SessionStart context diet** ✅ — remove `CAPABILITIES.md` from `loadAtStartup.files`; the file
      declares itself an on-demand reference and cost about 4.2KB of startup payload, while critical
      steering, memory safety, tool/auth quick reference, TELOS digest routing, and active project context
      remain loaded. A regression test keeps `CAPABILITIES.md` out of startup context.
- [x] **GitHub comment approval ergonomics** ✅ — keep pushes, merges, deletes, and PR approval reviews on the
      strict full-command approval hash, but use a stable operation key for comment-style writes
      (`gh pr comment`, `gh issue comment`, `gh pr review --comment`). This prevents harmless body formatting
      changes or `--body` vs `--body-file` retries from re-triggering the GitHub-write gate while preserving
      one-shot, target-specific approval.
- [x] **CI tiering + isolation hardening** ✅ — split CI by touched paths and remove local-install
      assumptions without weakening required safety gates:
      - docs-only PRs run markdown lint, link checks, and roadmap/spec consistency checks, not the full
        expensive suite unless generated artifacts are touched;
      - hook/config PRs run hook tests, `BuildSettings`, reconcile wiring, and smoke tests;
      - sync/KAI PRs run sync-manifest, dependency closure, release-readiness, and scrub/fidelity gates;
      - memory PRs run recall, telemetry, disclosure, and cross-project scope tests;
      - release branches/nightly/broad source changes still run the full suite.
      CI output should make slow/flaky failures actionable: report slowest tests, slowest hook/config-generation
      steps, timeout counts, and classify failures as likely infra/network vs code when evidence is available.
      Docs/spec consistency checks should verify shipped PR references point to merged PRs, stale `Task`
      terminology does not regress where native `Agent` is intended, version sequencing remains coherent
      (`7.4.1`/`7.4.2`/`7.5.x`), and generated inventory/wiki pages are fresh. KAI-specific gates should run
      sync into a temp KAI tree, regenerate the dependency graph, fail confirmed public→private/KAI-only
      imports, warn on unclassified dependencies, and verify no private memory/docs/secrets ship.
      Always-on safety checks remain required for all PRs: author allowlist, seed-wipe guard,
      large-delete guard with explicit override/audit, `core.bare=false`, no memory/runtime files in the PR,
      no public→private/KAI-only import leaks, and generated inventory/marker freshness. Use temp
      HOME/PAI_DIR/fixture repos so CI never depends on the developer's live `~/.claude` symlink or
      machine-specific paths.
      **Shipped in PR #19–#24:** server-side repo safety (`scripts/repo-safety-ci.ts`), path-aware tier
      planning (`scripts/ci-plan.ts`), docs/spec consistency (`scripts/docs-spec-consistency.ts`),
      report-only slow/flaky CI observability (`scripts/ci-observability-summary.ts`), temp-KAI release
      artifact validation (`scripts/kai-temp-release-gate.ts`), and batched literal scrub replacements are
      all in main. The safety gate remains unconditional; expensive tiers are selected by touched paths;
      sync/KAI changes build and inspect a temp KAI artifact before release; CI summaries now report slow
      steps/timeouts/failure classification without changing pass/fail status.
- [x] **KnowledgeSync disclosure-boundary gate** ✅ — add a pre-write assessment layer before
      `MEMORY/KNOWLEDGE/*.md` updates. Known secrets are redacted before write; internal/private-network
      URLs, local user paths, and email-like contact details stage the proposed domain refresh under
      `MEMORY/STAGING` for review instead of writing tracked knowledge. Domain telemetry now records
      `redacted` / `staged_disclosure_review`, finding counts, staged filename, and run-level staged-domain
      totals. Tests cover redaction and fail-closed staging fixtures without real secrets.
- [x] **Roadmap/wiki reconciliation after 7.4.x** ✅ — align the wiki/docs with the true state:
      7.4.0 foundation shipped, 7.4.1 stabilization shipped, 7.4.2 T3/CI/KAI gates shipped, memory spine
      decoupled. `MEMORY-SPINE-SPEC.md` now records the 2026-06-25 telemetry finding and the `/End` vs
      native `SessionEnd` distinction; this roadmap marks the observability items that are now shipped while
      leaving behavior-changing write-path work open.

---

## 7.5.0 (TARGETED — minor) — Subagent context inheritance MVP

**Theme: Give delegated subagents the context they silently lose today.**

Last in the line because the keystone work is **gated on Anthropic upstream** (issue #69283 /
`docs/github-issue-subagent-context.md`) — it cannot be release-committed on someone else's roadmap.
The parent-side workaround is the fallback that *can* ship regardless.

### MVP scope (ship regardless of upstream)
- [ ] **Parent-side context handoff MVP** `scoping` — inject critical rules (`CLAUDE.md` essentials +
      memory-save instruction + current repo ADA pointer summary) into Agent prompts via the available parent
      dispatch path. This is the brittle-but-available middle ground until native `inherit_context` exists.
- [ ] **Tiered injection policy** `scoping` — choose `none` / `rules` / `full` per delegation so an Explore
      grep does not pay 60K tokens but a research/implementation agent receives project rules.
- [ ] **Agent return checkpoint contract** `ready` — preserve the parent-side save boundary: the parent
      remains the only actor that can persist memory. Use the PR #14 `PostToolUse:Agent` capture-loss guard
      as the enforcement/reminder seam; add tests that durable subagent findings produce checkpoint prompts.
- [ ] **MVP tests** `ready` — prove context reaches expected Agent prompts, fast/no-context paths stay lean,
      and parent checkpoint reminders still fire after Agent returns.

### Dependency note
7.5.0 depends on the 7.4.0 PR #14 native `PostToolUse:Agent` parent-side safety net. The current Claude
tool is `Agent`, not retired `Task`; do not reintroduce Task matchers.

---

## 7.5.1 (TARGETED — patch/minor) — Agent resilience

**Theme: Make delegated work observable and recoverable after the context MVP exists.**

- [ ] **Timeout/failure handling for delegated agents** `scoping` — define what happens when an Agent stalls,
      errors, or returns partial output. Prefer visible parent feedback over silent loss.
- [ ] **Idle/stale recovery** `scoping` — use native `TaskCompleted` / `TeammateIdle` current fields where
      applicable; avoid relying on nonexistent `last_message` fields.
- [ ] **Agent telemetry** `scoping` — measure Agent spawn/return/checkpoint latency and missing-checkpoint
      cases. Feed the memory/observability track rather than building a separate dashboard here.
- [ ] **Failure-mode tests** `ready` — fixtures for timeout, malformed return, no durable finding, and
      durable finding requiring parent checkpoint.

---

## 7.5.2 (TARGETED — minor) — Delegation reach edge cases

**Theme: Cover the non-native paths after the normal Agent path is stable.**

- [ ] **Explore/Plan delegation injection** `scoping` — narrow injection for Explore/Plan sessions that do not
      naturally receive the same project-local context.
- [ ] **SDK/background session inheritance** `scoping` — define the minimal context envelope for SDK-launched
      or background sessions, with explicit privacy boundaries.
- [ ] **Native upstream hook-in point** `parked/ready-if-upstream` — if Anthropic ships `context_files` /
      `inherit_context` (#69283), wire it here and retire brittle parent-side injection where possible.
- [ ] **`inherit_hooks` integration** `parked/ready-if-upstream` — if available, wire SecurityValidator +
      MemCapture into subagents; today PreToolUse hooks do not fire for subagents (#69260).

---

## 📋 Backlog — the no-lose system (READ THIS)

**The rule that prevents lost ideas:** every not-yet-committed idea, design note, or even a passing
*"we should maybe…"* thought MUST land in this backlog with an **explicit target** — a dated release
(7.6.0 / 7.7.0 / 8.0.0) or a long-horizon bucket (9.0+ / Someday). **There is no "candidate" limbo and
no un-targeted item.** An idea with no target is the bug (that's how SpecKit got passed over: it was
"on the roadmap" but only in a candidate list with no release, so it was invisible to every "what's
next" decision and silently skipped).

**Two mechanisms, both required:**
1. **A home** — every item is under a dated header below. Targets are *intentions*, freely re-dated; the
   point is that none is blank.
2. **A surfacing trigger** — at every release cut, the owning release's backlog block is reviewed and each
   item is promoted (→ a committed spine section) or explicitly re-dated. WeeklyMaintenance also echoes
   the next two releases' backlog so it stays in view. A home without a trigger is still limbo.

**How to add (also see the global memory `[[roadmap-backlog-capture]]`):** drop a bullet under the right
target with `🆕 <date>`, a one-line what + why, and a status tag (`idea` / `scoping` / `ready`). When
unsure of the release, use **Someday** — never leave it out of the doc. Discussion-only thoughts are
welcome: tag them `thought`.

Status legend: `idea` (raw) · `scoping` (needs design/audit) · `ready` (scoped, buildable) ·
`thought` (discussion point, may never build) · `parked` (deliberately dormant) · `verify` (may already be done).

---

## 7.6.0 (TARGETED) — Spec-driven dev + skill discoverability

- [ ] **SpecKit-as-a-skill** `ready` 🆕 2026-06-17 — pull SpecKit's spec/plan/tasks/implement *patterns* into
  a first-class PAI `/speckit` skill (peer to `/research`), available from ANY session, mapped onto PAI's
  Algorithm/PRD machinery (we already have `specs/` + spec-status lifecycle in Algorithm v3.14.0).
  **Groundwork already exists:** `~/Projects/SpecKit/` is a cloned `github/spec-kit` v0.10.1 "design
  studio" with 10 upstream `speckit-*` skills installed locally (2026-06-10) — but those are vendor skills
  scoped to that one workspace, NOT PAI-global. Next step: audit the upstream skills' templates/phase-prompts,
  decide which become `/speckit` sub-commands vs. reuse Algorithm. Relates to Spec-Driven Dev shipped v6.0.0.
- [ ] **Skill-discovery recommender** `scoping` — 71 skills, most undiscovered; embed the prompt, suggest a
  close-but-not-invoked skill ("this would be faster with /security"). Embeddings already exist. ~2 sessions.
  **HIGH adoption** (audit Top-3). Pairs naturally with the SpecKit discoverability theme.
- [ ] **`pai curate promote --from-manifest` batch mode** `ready` 🆕 2026-06-22 — the 2026-06-22b triage
  drained 129 insights via a throwaway script because the per-item `promote` command would have been 129
  Bun spawns. Add a batch path: read a `<file>\t<project>` manifest (or `--all <project>`), promote in one
  process. Makes future census drains one call. Small (~30 min); the single-item command already exists.
- [ ] **`pai curate` interactive promote-from-report flow** `ready` 🆕 2026-06-22 — close the
  candidate→promoted loop in the **TUI** too, not just the CLI: surface candidates from the curate report and
  let the user promote inline. Complements the `--from-manifest` batch mode (CLI) and the single-item
  `promote` command (already built). ~1 hr.
- [ ] **Wire `insights_promoted.md` into recall** `scoping` 🆕 2026-06-22 → **belongs to
  `MEMORY-ARCHITECTURE-PLAN.md`** — the 7 consolidated files from the 2026-06-22b drain are durable but
  nothing surfaces them yet (same recall-coverage gap as the embeddings/scorer work). Pointer here so the
  new files aren't orphaned; design/sequence lives in the memory track.

## 7.7.0 (TARGETED) — Close the learning loop + knowledge cohesion

- [ ] **Close the learning loop** `scoping` (audit §B, HIGH/STRATEGIC) — PAI collects ratings/instincts/
  reflections but never *verifies they change behavior*. Instrument whether a promoted instinct prevents the
  repeat error; auto-surface recurring corrections; lightweight A/B for system changes. ~3 sessions. Also
  unblocks memcarry's value-loop. (Depends on 7.4.0 observability as the measurement substrate.)
- [ ] **KAI-safe ADA publicization** `scoping` 🆕 2026-06-23 — after validating ADA privately in PAI,
  split the PAI-private generator into a public KAI-safe capability. Requirements: no dependency on
  `PAI/USER/PROJECTS/REGISTRY.md`, no private repo names/branches/PII fixtures, explicit user-provided
  registry/template path, example-only fixtures, no writes outside the configured ADA root/repo root without
  opt-in, and docs for users to create their own repo packs. Keep PAI's private feed_bbf/feed_yourcompany rows
  out of KAI; ship only the generic mechanism once private validation proves the workflow reduces re-teaching.
- [ ] **Knowledge Cascade** `scoping` (`knowledge-cascade-design.md`) — knowledge scattered across 6+
  locations (wiki, memory, KNOWLEDGE/, projects) with no sync mechanism. Relates to CrossProjectIndex (7.4.0)
  and W6/memcarry. **LIVE.** → **now Phase 4 of the decoupled `MEMORY-ARCHITECTURE-PLAN.md`** (memory track).
- [ ] **Cross-repo concept coherence** `idea` — knowledge silos across 15+ repos; a concept graph + coherence
  check. ~2.5 sessions. (Superset of / relates to Knowledge Cascade — consider merging at scoping.)
- [ ] **A/B-test the mandatory mode-ceremony** `thought` 🆕 2026-06-22 (PAI-SR-029) — Codex flags that
  CLAUDE.md's mandatory mode header + multi-field template on *every* response (incl. acknowledgments)
  over-constrains modern Claude vs. concise-CLAUDE.md guidance. **Validated as INTENTIONAL, not a bug:**
  enforcement is **soft** (instruction only — no hook blocks/modifies responses), so this is deliberate PAI
  identity, not a mis-fire. Therefore **evidence-gated, not a fix** (contrast the two *real* ceremony bugs —
  PAI-SR-040/041 — already homed in 7.3.4). Use this release's A/B framework to compare completion quality /
  correction rate / token use / user preference of full ceremony vs. a lighter default **before** changing
  anything. KAI may ship the lighter default regardless; PAI keeps its preference unless the A/B says
  otherwise. Depends on the close-the-learning-loop A/B harness above.

## 8.0.0 (HORIZON) — Confidence + cost + capability lifecycle

- [ ] **Testing blind spots** `scoping` (audit §C, CRITICAL-for-confidence) — Algorithm runtime has 0
  integration tests; 71 skills have 0 activation/routing tests; board has 0 E2E. Build Algorithm-runtime
  harness + hook-lifecycle harness + skill-activation tests. ~5 sessions.
  **Absorbed the former `BACKLOG.md` hook-integration-test backlog here (2026-06-22, file retired):** the
  bulk gap is ~33 hooks (parameter validators + cosmetic/analytics) with **no integration tests** — covered
  by the hook-lifecycle harness above. **Two named live items** carried forward verbatim so they aren't lost:
  - [ ] **SF-7 — SessionEnd chain integration test** — no test exercises the full SessionEnd sequence
    end-to-end (parse → extractors → KnowledgeSync); feed a fixture transcript through the composite and
    assert each extractor's output. (Was a W4 prereq; W4 has since shipped, so this is now regression cover.)
  - [ ] **SF-1 — RelationshipMemory regression test** — assert user-side entries are captured; pairs with
    the SF-1 bug fix.
  **Caveat (do NOT test hooks slated for removal):** scope coverage to *surviving* hooks only — StartupGreeting
  (SR-026), CheckVersion (SR-025), FormatReminder/ModeClassifier (SR-040/041 → 7.3.4), WorktreeSetup (SR-014)
  are flagged for removal/repair by the Codex findings; don't write tests for code about to be deleted.
  (Already-tracked elsewhere, not re-listed: SF-2/8/9 in Tracked Issues, SF-18 in 7.4.0 §5 KAI release
  hardening. Dropped
  as stale: PromptAnalysis — deleted; SF-19/SF-20 — done.)
- [ ] **Inference-budget enforcement** `idea` — session/task **dollar-cost** budgets + pre-skill estimate +
  confirm-over-budget. **Note (validated 2026-06-18):** `hooks/lib/inference-budget.ts` already exists but is
  a *different* thing — a SessionEnd LLM-**call-count** cap (max 3, anti-timeout), wired into KnowledgeSync.
  This item is the cost-dollar layer; reuse that file's state-store pattern, don't rebuild it. ~1.5 sessions.
- [ ] **Capability versioning/rollback** `idea` — per-skill changelog + `/rollback :skill`. ~1.5 sessions. MED.
- [x] **Context-routing health auditor** ✅ **DONE 2026-06-18** — `PAI/Tools/RoutingAudit.ts` already did the
  audit/discover/propose work; the only gap was automation. Wired into `weekly-maintenance.ts` as the
  `routing-audit` task (read-only audit mode). Closed same session it was validated.
- [ ] **MCP SSH / device-identity** `ready` 🆕 2026-06-08 (`MCP-SSH-IDENTITY-PLAN.md`) — can't reliably tell
  *what we're connected to*: all 3 router-mcp devices share `192.168.1.1`, identity is alias-only/unverified.
  Identify by stable hardware key (MAC/serial) + verify-on-connect + add/swap/retire lifecycle, 3→N devices.
  **HIGH friction.**

## 9.0+ / Someday (PARKED — revisit when the trigger condition hits)

- [ ] **MCP Rearchitect** `parked` (`MCP-REARCHITECT-PLAN.md`) — MCP config/discovery friction. Partially
  addressed by v5.9 MCP-resilience. **NEEDS RE-SCOPE** before it can be targeted — re-assess what remains.
- [ ] **CrewAI pattern adoption** `parked` (`crewai-adoption-plan.md`) — orchestration patterns. Revisit IF
  multi-agent orchestration becomes a priority.
- [x] ~~**Steering enforcement** ✅ VERIFIED SHIPPED 2026-06-18~~ — **SUPERSEDED by Codex PAI-SR-043
  (2026-06-22): scheduled for REMOVAL, see below.** It shipped and tests pass, but validation shows the
  *approach* is wrong: `PlanDetection.ts` infers a pending plan from response **prose** (2-of: phase header /
  checkbox / time-estimate / "execution plan") instead of observing native plan mode; the global
  `plan-pending.json` is read without comparing its `sessionId`, so a plan-like response in **session A can
  constrain session B**; approval regexes accept bare `yes`/`start`/`great` anywhere. 2.1.185 exposes
  `permission_mode` on UserPromptSubmit and has native plan mode + ExitPlanMode that authoritatively
  represent approval state. The 68 tests cover regex helpers only — not session isolation or native mode.
- [ ] **Remove PlanDetection + PlanApprovalGuard; rely on native plan mode** `ready` 🆕 2026-06-22
  (PAI-SR-043) — pull both from the default hook fleet; use native plan mode / ExitPlanMode for execution
  approval, and the `permission_mode` payload field for any telemetry. Keep explicit user-requested planning
  as a skill/workflow. **No Codex adapter should import this inferred-state bridge**
  (`~/Projects/pai-codex/docs/CODEX-INTEGRATION-PLAN.md` non-goal). Removal task → dangling-ref audit on
  `plan-pending.json` + SessionCleanup `:222`. **MED.**

## 🔧 Refactor / tech-debt backlog (LOW-risk cleanups, no release urgency — target 7.6.0 unless pulled sooner)

Quick wins from the 2026-06-08 audit; do opportunistically alongside themed work:
- [ ] **`getAlgorithmVersion` (×4 identical), `ensureDir` (×3 identical)** → shared helpers. **MED, quick.** ← top quick win
- [x] **Delete `hooks/UpdateTabTitle.hook.ts.bak-4.3.1`** ✅ DONE 2026-06-18 (stray backup removed; live file intact).
- [ ] **Finish `hook-stdin` migration** — 12 hooks still define own `readStdin` (different shapes); migrate
  case-by-case where the contract matches. **MED.**
- [ ] **Finish `expandPath` → `lib/paths.ts`** — 3 local copies remain (RoutingAudit has unique handling). **LOW.**
- [ ] **Finish `state-io` migration** — staging.ts + a few others still inline; move onto `readJSON`/`atomicWriteJSON`. **LOW.**
- [ ] **Split oversized files** — `deliberate.ts` 1116L → 3 mode files; `dev-team.ts` 1039L → prompts/phases/review/utils. **LOW.**
- [ ] **Merge `once-per-session` + `session-end-tracker`** → `lib/session-state.ts`; merge `learning-utils` into `learning-readback`. **LOW.**
- [ ] **Sync 7.3.3 changes to KAI?** 🆕 2026-06-22 `scoping` — `env-check.ts` (depth-2 guard + `.pai-project`
  sentinel) and `scripts/memory-census.ts` are kai-local; decide if the KAI public repo needs them
  (KAI uses `~/.kai/work` paths, so the `~/Projects`-specific census may be PAI-only by design). **LOW.**
- [ ] **PAI install must survive the `kai → PAI/config` move** `scoping` 🆕 2026-06-22 — the workspace
  reorg (`QA-Planning/Plans/PROJECT-CONSOLIDATION-PLAN.md`, Phase 3, not yet executed) renames the **live
  install**: `kai → PAI/config` and `kai → PAI/kai`. This is a hard-break on PAI itself — the `~/.claude`
  symlink target changes, `settings.local.json` carries absolute `kai` paths, `CONTEXT_ROUTING.md` has
  30+ `kai` refs, and `sync-to-kai.sh`/`verify-release.sh` assume the `kai`/`kai` paths. **Scope
  here = the PAI-system half only** (the folder moves + memory-key lockstep migration stay in the reorg doc):
  audit absolute-path assumptions, make path resolution survive the move (or a documented one-shot fixup +
  verification), and confirm a sync still works from the new tree. Pairs with **SF-35** (sync-fidelity gate)
  and the §0 reproducible-settings fix (PAI-SR-001). **MED — release-safety, do before Phase 3 runs.**

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
| SF-15/18 | PROCESS | KAI artifact verification/staging remains incomplete; see 7.4.0 §5 KAI release hardening | OPEN (targeted 7.4.0) |
| SF-29 | PLAN | `pai-streamlining-plan.md` is ~40% stale — see "Open follow-ups" below | OPEN (triaged) |
| SF-30 | INFRA | usp/acsplatform MCP controller unreachable — ✅ **EXPECTED**: AWS ACSPlatform intentionally shut down (cost, not in use). Not a fault. | RESOLVED (by design) |
| SF-31 | INFRA | router M62 (`EXAMPLESERIAL26001024`) unreachable / `uhttpd:false` — ✅ **EXPECTED**: M62 not currently connected. Not a fault. | RESOLVED (by design) |
| SF-32 | OPS | Embeddings index drifted 49 files stale before manual `--incremental` (2026-06-08) — add rebuild to weekly maintenance so semantic routing doesn't silently degrade | ✅ DONE — wired into `weekly-maintenance.ts:117` (confirmed 2026-06-18) |

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
- [x] **SF-32 — weekly embeddings rebuild.** ✅ DONE — `EmbeddingIndex.ts --incremental` is wired into
  `weekly-maintenance.ts:117`. (Confirmed 2026-06-18 during backlog validation; was wrongly still open.)
- **SF-3 confirmed live** (no new ticket): a clearly-relevant MemoryRecall query scored only 33% — the
  keyword-only scorer limitation is real and observable. Wiring embeddings into recall scoring (pairs with W6)
  is the fix.
- **SF-15/18 superseded by 7.4.0 §5 KAI release hardening:** the original `sync-ci-gate --warn-pii`
  observation remains true, but the current release-safety issue is broader: artifact-target verification,
  staging-before-mutation, literal scrub semantics, and single-source release policy.

### Signal-blocked (cannot build now — need weeks of rated use, NOT code)
- [ ] **W6b** (live jina recall), **A1** (ingestion: MemoryRecall hit + good rating → lesson atom), **B3**
  (atom reinforcement) — all gated on memcarry store accumulating real lessons. See `memcarry-plan.md` +
  `PAI-Wiki/memory/memcarry-architecture.md`.
- [ ] **SubagentStop** (SF-25) — investigated, deferred: metadata-only payload, learning redundant with
  parent-transcript capture; only speculative telemetry is net-new. Revisit if per-agent metrics become a need.
  **Correction 2026-06-22 (PAI-SR-002/003):** `SubagentStop` **is** a native 2.1.185 event (confirmed in the
  binary's event array) — earlier roadmap text that called it a "PAI agent-teams enum value, not native" was
  wrong. The *deferral* still stands on value grounds (metadata-only), but the event-availability premise is
  corrected; the active re-wiring decision lives in 7.4.0 §0.

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
