# KAI — Roadmap & Next Steps

> Canonical repo: `github.com/kai-cli/kai`
> kai is the private live installation. kai is the scrubbed public fork.
> Development workflow: develop in kai → cherry-pick to kai → verify-release.sh → push

---

## Shipped

| Release | Date | Highlights |
|---------|------|-----------|
| **v5.9.2** | 2026-05-22 | kai-setup, kai-doctor, kai-keys, kai-reset, kai-upgrade CLIs; ConfigValidation + EnvironmentStatus hooks; MCP Onboarding skill; Hook integration tests (30 new); Release Audit script — 924 tests |
| **v5.9.1** | 2026-05-22 | Installer: API Key Wizard, MCP Server Setup, Notification Setup, .env bootstrap, local overrides creation; Post-install checklist; First-Session Onboarding hook; 4 docs (MEMORY, CONFIGURATION, MCP-GUIDE, PLUGINS); devices.json.example; .env.example completeness — 905 tests |
| **v5.9.0** | 2026-05-22 | Skills Lock (hash-verified, CI-enforced), Skill Specialization, Settings Schema + validator, Command Risk Classifier, MCP Resilience (health tools, reconnect, mcp-doctor), Board UX (Cmd+K palette, j/k nav, Focus Mode, suggestions), Hot-Reload Rules, ModeClassifier calibration — 851 tests |
| **v5.8.0** | 2026-05-21 | Adapter architecture, session lifecycle, name locking, release hardening (PR #4 cherry-picks), board session naming fix |
| **v5.7.0** | 2026-05-21 | Instinct pipeline maturation, marker regions, verify-release enhancements |
| **v5.6.0** | 2026-05-20 | Progressive disclosure memory, instinct learning, embedding fallback, MistralResearcher + DeepSeekResearcher, 724 tests |
| **v5.5.0** | 2026-05-19 | KnowledgeHealth, AutoConsolidate, ContradictionDetector, MemorySearch, WikiQuery, 661 tests |
| **v5.4.0** | 2026-05-18 | Knowledge schema foundation, domain-based injection, 627 tests |
| **v5.3.0** | 2026-05-15 | PlanApprovalGuard, deliberate research mode, /end skill, hook testability (SkillGuard, LocalContextFirst, PreCompact exports), BuildSettings shape validation, stale PRD nudge, 529/549 tests, kai first public release |
| **v5.2.0** | 2026-04-30 | Foundation completion: ESM conversions, version gate, KnowledgeHarvester→config-loader, 5 new hook tests (437 total), ReadTracker, RoutingCandidates, RoutingAudit propose, BuildSettings --dry-run, memory cleanup (302MB→18MB), WISDOM/FRAMES curated, 16-project domain mapping, LearningPatternSynthesis wired |
| **v5.1.0** | 2026-04-29 | Algorithm archive, config-loader, knowledge-readback migration, skill count fix (41→79), PAI/skills/PAI guard, deploy.ts version from manifest, archetype installer, 376 tests |
| **v5.0.1** | 2026-04 | restore-memory-automation branch: KnowledgeSync+SecretOutputDetector+WebFetchGuard restored, hook counts 35→39, pre-commit fix, domains.jsonc, 367 tests |
| **v5.0.0** | 2026-04 | Algorithm v3.13.0, memory curation (`pai curate`), self-learning loop, WebFetchGuard, SecretOutputDetector, 314 tests |
| **v4.9.0** | 2026-04 | Parallelization gate, phantom cap prune, version centralization |
| **v4.8.0** | 2026-03 | Memory curation, staging, `pai curate`, `pai harvest`, security hooks, 248 tests |
| **v4.7.0** | 2026-03 | KnowledgeSync, Algorithm v3.11.0, context routing |
| **v4.5.0** | 2026-03 | Ralph Loop, multi-agent orchestrator, Board v2, SecretScanner, SecurityValidator |
| **v4.4.0** | 2026-03 | EM/PLM workflows, 3 named agents, CompetitiveIntel, StandardsTracker |
| **v4.1.0** | 2026-03 | Atomic writes, payload schema validation, settings split, `pai upgrade` CLI |

---

## v5.2.0 — SHIPPED (2026-04-30)

See `docs/planning/v5.2.0-PLAN.md` for full detail. All phases complete.
Memory improvements (302MB→18MB), hook tests, routing intelligence, installer polish,
steering enforcement design spike. 437 tests. kai @ `f7ff18e`, kai @ `e457faa`.

---

## v5.3.0 — SHIPPED (2026-05-15)

See `docs/planning/v5.3.0-PLAN.md` for full detail. All coding phases complete.
PlanApprovalGuard, deliberate research mode, /end skill, hook testability exports,
BuildSettings shape validation, stale PRD nudge, 529 tests. kai tagged v5.3.0 + GitHub Release.
Remaining: G1 clean install test, G3 flip public.

---

## v5.4.0 — SHIPPED (2026-05-18)

See `docs/planning/v5.4.0-PLAN.md` for full detail. Phases 0-2 + T complete.
Knowledge schema foundation, MemorySearch retrieval, ValidateKnowledge, ContradictionDetector,
`pai curate check`, domains.jsonc expansion, 627 tests. Phase 3 (Lifecycle) deferred to v5.5.

---

## v5.5.0 — SHIPPED (2026-05-19)

KnowledgeHealth telemetry analysis, AutoConsolidate (guard-railed STAGING→WISDOM promotion),
`pai curate approve-all`, Board /api/knowledge-health endpoint. 661 tests.
SessionCloseGuard and memory scoring model deferred to v5.6.

---

## v5.6.0 — SHIPPED (2026-05-20)

See `docs/planning/v5.6.0-PLAN.md` for full detail. All phases complete.
Progressive disclosure memory (3-layer), instinct-based learning, embedding fallback,
MistralResearcher + DeepSeekResearcher, ExtensiveResearch 4-5 types, MemoryRecall hook wired.
724 tests (kai), 744 tests (kai). Both repos synced and pushed.

---

## v5.7.0 — SHIPPED (2026-05-21)

Instinct pipeline maturation: marker-aware count regions across docs, verify-release enhancements,
session lifecycle tracking, manifest version sync. 749 tests.

---

## v5.8.0 — SHIPPED (2026-05-21)

Adapter architecture for terminal integration, session name locking (inference sets once, no drift),
release hardening cherry-picks from PR #4 (dead-link checker, marker-aware counts, manifest brand gate,
preferences.jsonc brand transform in sync-to-kai). Board session naming fix (no more "New Session").
755 tests.

---

## v5.9.0 — SHIPPED (2026-05-22)

Skills Lock (hash-verified, CI-enforced), Skill Specialization, Settings Schema + validator,
Command Risk Classifier, MCP Resilience (health tools, reconnect, mcp-doctor), Board UX
(Cmd+K palette, j/k nav, Focus Mode, suggestions), Hot-Reload Rules, ModeClassifier calibration.
851 tests.

---

## v5.9.1 — SHIPPED (2026-05-22)

Installer expanded to 12 interactive steps (API Keys, MCP Servers, Notifications). Fresh install
creates preferences.local.jsonc and .env. 4 guides (Memory, Configuration, MCP, Plugins).
devices.json.example template. .env.example completeness. FirstSessionOnboarding hook.
Post-install actionable checklist. 905 tests.

---

## v5.9.2 — SHIPPED (2026-05-22)

Re-runnable setup & self-service configuration. 6 CLI tools (kai-setup, kai-doctor, kai-keys,
kai-reset, kai-upgrade, kai-release-audit), 2 new hooks (ConfigValidation, EnvironmentStatus),
MCP Onboarding skill, hook integration test suite (30 tests across 4 hooks), shared test helpers.
924 tests.

---

---

## Gate: Pre-v6.0 Stabilization ✅

All gates green as of v5.9.2:
- ✅ v5.9.2 Feature [9] hook integration tests all passing (30 tests, 4 hooks)
- ✅ v5.9.2 Feature [10] release audit script functional (11 checks, --json, --category)
- ✅ No open P0/P1 bugs in shipped v5.9.x features
- ✅ Test count: 924 (target was 800+)

One pre-existing failure: InsightExtractor `loadState returns defaults` (reads real state in test,
not caused by v5.9.x work). Non-blocking for v6.0.

---

## Next: v6.0.0 — Paradigm Shift

**Theme:** New interaction models + multi-agent orchestration + identity consolidation

See `docs/planning/v6.0.0-PLAN.md` for full detail.

| # | Feature | Est. LOC | Complexity |
|---|---------|----------|-----------|
| 1 | Input Classification | ~400 | High |
| 2 | Multi-Harness Agents | ~600 | High |
| 3 | Workflow Templates | ~250 | Medium |
| 4 | Hot-Reload Rules | ~150 | Medium |
| 5 | Spec-Driven Development | ~200 | Medium |
| 6 | PAI→KAI Internal Rename | ~0 (massive rename) | High |

---

## Backlog (unversioned)

### Quality & Reliability
- [ ] SessionCloseGuard.hook.ts — natural-language exit detection. Fires on UserPromptSubmit (async), matches explicit exit phrases ("ok we're done", "wrapping up", etc.) and optionally implicit short acknowledgments (≤8 words, ≥10 turns). Injects session-close context so Claude produces a closing summary. Builds on `/end` skill experience. Design in v5.3.0-PLAN.md A2 section (preserved). ~70 LOC + 10 tests. *Deferred from v5.7 — `/end` covers the explicit case; auto-detection adds false-positive risk.*
- [ ] GPT web search via Responses API — `invokeOpenAIResponses()` function for `deliberate.ts`. Chat Completions (`/v1/chat/completions`) doesn't support `web_search_preview`; needs `/v1/responses` endpoint with different request shape (`input` string, `output[]` response). ~40 LOC. Adds a third grounded source alongside Gemini and Grok. *Deferred from v5.7 — diminishing returns (Gemini + Grok already grounded).*
- [ ] Auto-reindex external Knowledge/ paths — Detect stale embedding index at session start, trigger incremental reindex in background. Currently manual (`bun scripts/EmbeddingIndex.ts --incremental`). *Deferred from v5.7 — solve when stale index causes visible problems.*
- [ ] PostToolUse code quality gate — lint/syntax detection after edits
- [ ] Agent context seeding — auto-inject prior ResearchIndex findings into spawned agents
- [ ] Confidence calibration — track approval rate, adjust draft thresholds
- [ ] Batch approve — `pai curate approve-all --confidence N`
- [ ] `pai security` CLI — query `MEMORY/SECURITY/security-events.jsonl`; show blocks/alerts from last N days, filter by tool or category, summary stats. Makes the security audit log actually readable. SecurityValidator already writes blocks+alerts to the rolling log (v5.2.0); the reader is what's missing. Estimated: ~80 LOC, 1 session.

### Memory System — Step 4 + 4b: Auto-Promotion Policy + Memory Scoring (DEFERRED)

**Revisit trigger:** After 3 manual `pai curate` sessions OR when STAGING accumulates
3+ unduplicated drafts — whichever comes first. Currently: 1 curation pass (2026-04-30),
5 new ratings since last synthesis. Not enough signal yet.

#### Step 4a — Auto-Promotion Policy

Context: ReflectionHarvester synthesizes reflections → STAGING drafts (confidence: 0.8).
LearningPatternSynthesis synthesizes ratings → STAGING drafts (confidence: 0.75).
Manual curation (2026-04-30) produced a 90/85/80/75% CRYSTAL distribution from 1 pass.

**Why deferred:** One sample isn't enough to know whether 0.8 is a useful confidence gate
or whether harvest output is uniformly 0.8 regardless of quality.

**Design decisions to make:**
1. Gate: 7-day time + confidence ≥ 0.8 (not 48h — too aggressive)
2. Dedup against existing WISDOM/FRAMES before promoting (key issue: naive auto-promote
   creates near-duplicates every harvest cycle without an LLM dedup pass)
3. WISDOM/CANDIDATE/ intermediate step (auto-approved at 70% CRYSTAL; manual graduation
   to FRAMES/ at 85%+)
4. Lower-friction manual path first (batch approve CLI) — may eliminate need for auto-promote

#### Step 4b — Memory Scoring Model (new, 2026-05-12)

**The core question:** Should memory entries self-prune based on usage, or only on time?

**Proposed access-count model (raised by YourName):**
- New WISDOM/FRAMES entries start at 5/10
- Injected into a session → increment (cap at 10 = permanent)
- Not accessed in weekly pass → decrement (floor at 0 = archived)

**Problem with naive access-count:** LoadContext injects all entries ≥85% CRYSTAL on every
session start — so every session increments everything above threshold regardless of whether
the lesson was actually relevant. "Accessed" ≠ "useful." Score inflation, not signal.

**Better split by memory type:**
- **WISDOM/FRAMES**: recency decay only — re-promote via `pai curate` every 90 days or
  drop to CANDIDATE/. Forces periodic review without requiring behavioral attribution.
  Long-lived generic principles (parallelize, pre-flight) shouldn't decay on low-rated sessions.
- **FAILURES/LEARNING**: access-count model fits well here — if a failure pattern hasn't
  been relevant (injected AND session was well-rated) in 60 days, it's likely resolved.
- **KNOWLEDGE/**: already has 7-day full-harvest refresh cycle — leave as-is.

**What a v1 implementation looks like:**
1. Add `last_accessed` timestamp to WISDOM/FRAMES entries (updated when LoadContext injects)
2. SessionCleanup weekly pass: entries not injected in 90+ days → move to WISDOM/CANDIDATE/
3. `pai curate` shows CANDIDATE entries with "last used N days ago" — one keystroke to re-promote
4. FAILURES/: entries where failure type hasn't appeared in ratings for 60 days → archive

**Unanswered:** What's the right behavioral signal for WISDOM? Rating correlation to specific
injected frames is the ideal but requires attribution logic that doesn't exist yet. Recency
decay is the pragmatic fallback. Design this alongside Step 4a — the two are coupled (promotion
threshold and decay rate need to be calibrated together).

**Related code:** hooks/lib/staging.ts, hooks/LoadContext.hook.ts (loadWisdomFrames),
hooks/SessionCleanup.hook.ts (retention cleanup), PAI/Tools/MemoryCurate.ts

### KAI Public Launch
- [ ] User reviews kai-cli/kai on GitHub and approves
- [ ] Flip kai-cli/kai visibility to public
- [ ] End-to-end test: `get-kai.sh` on clean machine without `~/.claude`
- [ ] Team deployment guide — org-config patterns, multi-user setup
- [ ] Org-config templates — shareable team configurations

### Future
- [ ] Automatic model routing — detect task complexity, route to fast/standard/smart
- [ ] Local model support (Ollama/llama.cpp)
- [ ] Multi-machine remote access
- [ ] External notifications (Discord/Slack/email)
