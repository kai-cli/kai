# KAI — Roadmap & Next Steps

> Canonical repo: `github.com/kai-cli/kai`
> kai is the private live installation. kai is the scrubbed public fork.
> Development workflow: develop in kai → cherry-pick to kai → verify-release.sh → push

---

## Shipped

| Release | Date | Highlights |
|---------|------|-----------|
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

## v5.3.0 — Steering Enforcement + Research Mode + Memory Tests

**Theme:** Close the open loops from v5.2.0 and add steering enforcement.

### Memory system test coverage (4 functions, from v5.2.0 review)

These were flagged during the post-implementation review of memory improvements.
Each is a new exported function with no unit test:

- `trimOldEntries()` — `hooks/SecurityValidator.hook.ts` — test 90-day cutoff logic, line filtering, rewrite behavior
- `synthesisToStagingContent()` — `PAI/Tools/LearningPatternSynthesis.ts` — test lesson generation, count≥2 filtering, output format
- `loadRatings(days?)` — `PAI/Tools/LearningPatternSynthesis.ts` — test file read, JSON parse, day filtering, empty input
- `maybeRunSynthesisBackstop()` — `hooks/SessionCleanup.hook.ts` — test 14-day gate, state file read (mock spawn)

Also: `LearningPatternSynthesis.ts` CLI runs at module scope without `import.meta.main` guard.
Add guard before the file is ever imported directly (currently low risk — only spawned as subprocess).

### Hook test coverage (architectural review #7)

Current state: 8 of 40 hooks tested (Phase T added 5 in v5.2.0). 32 untested.
The architectural review flagged AlgorithmTracker.hook.ts (268 LOC) specifically.

Priority tiers for remaining hook tests:

**MED priority (meaningful logic, no tests):**
- `AlgorithmTracker.hook.ts` (268 LOC) — tracks Algorithm phase progress, writes STATE/algorithms/
- `SkillGuard.hook.ts` — validates Skill tool invocations, fails open (flagged in v5.2.0 review as T6)
- `PRDSync.hook.ts` — PRD frontmatter → work.json sync (needs integration harness, deferred from v5.2.0)
- `LocalContextFirst.hook.ts` — domain-based context injection, now uses config-loader
- `PreCompact.hook.ts` — context preservation before compaction

**LOW priority (simpler logic or already covered by integration):**
- `RelationshipMemory.hook.ts`, `IntegrityCheck.hook.ts`, `UpdateCounts.hook.ts`,
  `StopOrchestrator.hook.ts` (all MED from original list; can follow T1-T5 pattern)

Pattern to follow: export pure functions, add import.meta.main guard, write tests against exports.
See `tests/PostCompactRecovery.test.ts` and `tests/SessionAutoName.test.ts` as templates.

### Skills hierarchy decision (architectural review #1)

79 SKILL.md files exist recursively; 41 at maxdepth 2 (root-category level).
38 are at depth 3+ (subcategory: Documents/Pdf, Documents/Xlsx, Media/Art, etc.).

Two options:
- **Option A — Accept 3-level hierarchy:** Document the nesting as intentional. BuildManifest already
  counts recursively (fixed v5.1.0). No code change needed, just a decision and a comment.
- **Option B — Flatten to 2 levels:** Move subcategory skills up one level. Breaks existing
  invocation paths. Larger refactor.

Recommendation: Option A. The nesting reflects genuine subcategories (Documents/Pdf is distinct
from Documents/Xlsx). The count is correct. Document intent and close the issue.

### Config schema validation (architectural review Gap 3)

Invalid `config/*.jsonc` files currently fail silently at BuildSettings time — wrong field
types, misspelled keys, or missing required fields produce a settings.json that's subtly wrong
rather than explicitly broken.

Options:
- **JSON Schema:** Add `config/schema/` with JSON Schema files for each domain config.
  BuildSettings validates against them before merging. CI check in verify-release.sh.
- **Runtime guards:** Expand `validateConfig()` in BuildSettings.ts to check known field shapes
  at merge time. Simpler, no schema files needed, but less exhaustive.

Recommend runtime guards first (lower friction), schema files if gaps emerge.

### Agent invocation documentation (architectural review Gap 4)

18 agents defined in `agents/*.md` with rich personas, capabilities, and voice. Zero
user-facing documentation on how to actually invoke them.

What's needed:
- A `PAI/PAIAGENTSYSTEM.md` section (or separate doc) explaining: how agents are spawned
  (via `Task` tool or `Agent` tool call), which tasks auto-trigger which agents, how to
  explicitly request a specific agent type, how to pass context to agents.
- A quick-reference table in QUICKSTART.md: "If you want X, ask for Y agent"
- The SKILL.md for the Agents skill already has trigger words — the gap is the how-to,
  not the discovery.

Estimated: ~2 hours of writing, no code changes.

### Memory — Step 4a+4b (auto-promotion + scoring model — deferred from v5.2.0)

See detailed note in Backlog section below. Revisit trigger: 3 manual curation sessions
OR 3+ unduplicated STAGING drafts accumulated.

**Key design question added (2026-05-12):** Should WISDOM/FRAMES entries decay by recency
(re-promote every 90 days via `pai curate` or drop to CANDIDATE/) rather than by access
count? Access-count inflates on injection; recency decay is simpler and more appropriate
for long-lived principles. Decide alongside auto-promotion threshold.

### WORK/ PRD cleanup

11 non-complete PRDs in MEMORY/WORK/ are stale abandoned shells (0/N criteria, months old).
Add SessionCleanup TTL: PRDs in `observe`/`execute`/`plan`/`verify` phase with 0 criteria checked
and last updated >30 days ago should be archived. Keeps WORK/ clean without manual intervention.

### Deliberate Research Mode

**Theme:** Multi-model web-grounded research as a first-class KAI capability.
**Target:** ~4-5 hours (simplified from original design — see v5.3.0-PLAN.md Phase R)
**Story:** `deliberate.ts` already handles multi-model parallel calls, synthesis, and graceful
degradation. Research mode adds a new execution path (scatter-gather-synthesize vs. debate
rounds) and web grounding to the existing invoke functions. No new abstraction layer needed.

**Key decisions made (2026-05-12):**
- `ModelInvocation.ts` dropped — `deliberate.ts` already has `invokeModel()` doing this work
- `Inference.ts` tools param dropped — `--tools ''` is intentional (safety guard for hook
  subprocess calls). Web grounding goes through direct API calls per model, not via CLI.
- Claude contributes reasoning from training knowledge; grounded search via Gemini/GPT/Grok.

### Items

1. **`deliberate.ts --mode research`** — scatter-gather-synthesize execution path
   - Each model answers once with web grounding (no debate rounds)
   - Cross-check: claims in ≥2 responses weighted higher
   - Synthesis: Claude Opus produces final answer with source attribution

2. **Web grounding** — Gemini + Grok for v5.3.0 (GPT deferred — see backlog)
   - Gemini: `tools: [{ google_search: {} }]`
   - Grok: `search_parameters: { mode: "auto" }` (top-level field in OpenAI-compatible path)
   - GPT: requires Responses API (`/v1/responses`) — different schema from Chat Completions. Deferred to v5.4.0.

3. **Skill docs** — `skills/Deliberate/Workflows/ResearchMode.md` + SKILL.md trigger words

---

## Backlog (unversioned)

### Quality & Reliability
- [ ] SessionCloseGuard.hook.ts — natural-language exit detection. Fires on UserPromptSubmit (async), matches explicit exit phrases ("ok we're done", "wrapping up", etc.) and optionally implicit short acknowledgments (≤8 words, ≥10 turns). Injects session-close context so Claude produces a closing summary. Builds on `/end` skill experience. Design in v5.3.0-PLAN.md A2 section (preserved). ~70 LOC + 10 tests.
- [ ] GPT web search via Responses API — `invokeOpenAIResponses()` function for `deliberate.ts`. Chat Completions (`/v1/chat/completions`) doesn't support `web_search_preview`; needs `/v1/responses` endpoint with different request shape (`input` string, `output[]` response). ~40 LOC. Adds a third grounded source alongside Gemini and Grok.
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
