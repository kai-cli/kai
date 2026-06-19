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

## 7.4.0 (DRAFT — minor) — Memory capabilities + observability

**Theme: Make knowledge loss *visible*, then build the capabilities that route knowledge correctly.**

The net-new work motivated by the rayhunter incident — feature-sized, so it lands in a minor, not the
7.3.2 patch. Observability leads: the rayhunter loss was invisible precisely because there was no
telemetry on memory recall/save or hook behavior — you cannot prove the 7.3.2 guards held, or that the
new capabilities below help, without it. This matches the 2026-06-08 audit's Top-3 ("Observability —
foundation for validating everything else"). All items verified against live code 2026-06-18.

**Spine (committed):**

### 1. Observability FIRST (section A from 2026-06-08 audit) — the verification substrate
- [ ] Telemetry layer: hook latency, skill/tool usage, **memory-recall hit-rate**, **memory-save events
      per project**, inference cost. (The two bold metrics would have made rayhunter visible on day 1.)
- [ ] Silent-degrade visibility (the ~12 swallow-catch sites from SF-9)
- [ ] `/health` or board view for runtime telemetry
- [x] ~~SF-32: weekly embeddings rebuild~~ **ALREADY DONE** — `EmbeddingIndex.ts --incremental` is wired into
      `weekly-maintenance.ts:117`. (Validation 2026-06-18 found it shipped; was wrongly still listed open.)

### 2. Memory-routing capabilities (the net-new wiring, measured by §1)
- [ ] CrossProjectIndex surfacing in MemRecall (`PAI/Tools/CrossProjectIndex.ts` exists — wiring only)
- [ ] **Agent knowledge harvesting via PostToolUse `Task` matcher** — NOT TaskCompleted/SubagentStop
      (verified 2026-06-18: those are PAI agent-teams enum values, not Claude-Code-native events, and
      do NOT fire on Agent-tool returns; PostToolUse `Task` is the documented hook point that fires in
      the parent when a subagent returns). New hook on the parent side.
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

_No "candidates" limbo here by design — every not-yet-committed idea lives in the **Backlog** below with
an explicit target release. If something should pull into 7.4.0, promote it from the backlog into a spine
section above; don't leave it floating._

---

## 7.5.0 (DRAFT — minor) — Subagent context inheritance + agent resilience

**Theme: Give delegated subagents the context they silently lose today.**

Last in the line because the keystone work is **gated on Anthropic upstream** (issue #69283 /
`docs/github-issue-subagent-context.md`) — it cannot be release-committed on someone else's roadmap.
The parent-side workaround is the fallback that *can* ship regardless.

### Keystone (gated — wire if/when upstream ships)
- [ ] If Anthropic ships `context_files` / `inherit_context` (#69283) — wire into PAI agent system
- [ ] `inherit_hooks` support if available — wire SecurityValidator + MemCapture into subagents
      (today PreToolUse hooks don't fire for subagents — #69260, OPEN)

### Parent-side workaround (ships regardless of upstream)
- [ ] Inject critical rules (CLAUDE.md essentials + memory-save instruction) into Agent prompts via
      a pre-dispatch hook — the brittle-but-available middle ground until a real `inherit_context` lands
- [ ] Tiered injection (none / rules / full) mirroring the #69283 proposal, decided by the parent
      per-delegation — so an Explore grep doesn't pay 60K but a research agent gets project rules

### Dependency note
7.5.0's keystone depends on 7.4.0's PostToolUse `Task`-matcher harvesting hook as the parent-side
safety net: even with the workaround, the parent remains the only actor that can persist memory, so
7.4.0 must land first.

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

## 7.7.0 (TARGETED) — Close the learning loop + knowledge cohesion

- [ ] **Close the learning loop** `scoping` (audit §B, HIGH/STRATEGIC) — PAI collects ratings/instincts/
  reflections but never *verifies they change behavior*. Instrument whether a promoted instinct prevents the
  repeat error; auto-surface recurring corrections; lightweight A/B for system changes. ~3 sessions. Also
  unblocks memcarry's value-loop. (Depends on 7.4.0 observability as the measurement substrate.)
- [ ] **Knowledge Cascade** `scoping` (`knowledge-cascade-design.md`) — knowledge scattered across 6+
  locations (wiki, memory, KNOWLEDGE/, projects) with no sync mechanism. Relates to CrossProjectIndex (7.4.0)
  and W6/memcarry. **LIVE.**
- [ ] **Cross-repo concept coherence** `idea` — knowledge silos across 15+ repos; a concept graph + coherence
  check. ~2.5 sessions. (Superset of / relates to Knowledge Cascade — consider merging at scoping.)

## 8.0.0 (HORIZON) — Confidence + cost + capability lifecycle

- [ ] **Testing blind spots** `scoping` (audit §C, CRITICAL-for-confidence) — Algorithm runtime has 0
  integration tests; 71 skills have 0 activation/routing tests; board has 0 E2E. Build Algorithm-runtime
  harness + hook-lifecycle harness + skill-activation tests. ~5 sessions.
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
- [x] **Steering enforcement** ✅ **VERIFIED SHIPPED 2026-06-18** — all 5 spec components live: `PlanDetection.ts`
  (Stop-phase plan detector, wired into StopOrchestrator), `PlanApprovalGuard.hook.ts` (UserPromptSubmit,
  registered), `plan-pending.json` state, SessionCleanup clears it (`:222`), 68 tests pass. Design doc already
  in `docs/planning/Archive/`. Nothing to build — closed.

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
