# Changelog

All notable changes to KAI will be documented in this file.

## [5.6.0] — 2026-05-20

Progressive learning, adaptive memory, and research expansion.

### Added
- `hooks/lib/memory-disclosure.ts` — 3-layer progressive disclosure memory (index ≤50 lines, timeline JSONL, on-demand detail) with eviction scoring (P0–P3 priority, days×-1 + refs×5)
- `hooks/MemoryTimeline.hook.ts` — SessionEnd hook appends session summaries to timeline.jsonl
- `hooks/MemoryAccessTracker.hook.ts` — PostToolUse hook increments reference_count on detail file reads
- `hooks/MemoryRecall.hook.ts` — UserPromptSubmit hook surfaces relevant project memories next to user prompts (keyword scoring, max 5 matches)
- `hooks/lib/instinct-store.ts` — CRUD, decay, archival, and clustering for behavioral instincts
- `hooks/InstinctCapture.hook.ts` — UserPromptSubmit hook detects correction patterns (3 patterns: explicit imperative + tool call, repeated instruction, low rating)
- `hooks/lib/semantic-fallback.ts` — cosine similarity search via @huggingface/transformers@^3.8.1 (threshold 0.45, graceful degradation)
- `hooks/LocalContextFirst.hook.ts` — Feature C semantic fallback when no explicit routing match
- `scripts/EmbeddingIndex.ts` — CLI to build/update embedding index (--setup, --incremental, --stats)
- `skills/Evolve/SKILL.md` — /evolve skill: instinct dashboard, --promote, --prune, --stats
- `agents/MistralResearcher.md` — Sophia: systematic analyst using Mistral Large
- `agents/DeepSeekResearcher.md` — Wei: cost-efficient technical researcher using DeepSeek
- 7 new test files: MemoryDisclosure, InstinctStore, InstinctCapture, SemanticFallback, session-start integration, instinct-lifecycle integration
- `config/settings.json` — instincts and embeddings feature flag blocks

### Changed
- `skills/Research/Workflows/ExtensiveResearch.md` — updated to 4-5 researcher types (12-15 parallel agents)
- `hooks/LoadContext.hook.ts` — adds index memory load (Feature A) and instinct decay+surfacing (Feature B) at session start
- `hooks/SecurityValidator.hook.ts`, `hooks/SecretScanner.hook.ts` — security prefix rebranded to `[KAI SECURITY]`
- `hooks/lib/change-detection.ts` — system label rebranded to `KAI System`
- `PAI/Tools/RoutingAudit.ts` — MEM_PREFIX derived from HOME (portable, no hardcoded paths)
- Manifest updated: 83 skills, 47 hooks, 20 agents
- VERSION 5.2.0 → 5.6.0
- README, QUICKSTART, WHATS-DIFFERENT, releases/README updated to KAI 5.6.0

### Fixed
- `hooks/lib/output-validators.ts` — removed dead `getCompletionFallback()` export (zero callers)
- `hooks/LocalContextFirst.hook.ts` — removed dead `isKnowledgePath` import
- Manifest hookInventory corrected: added InsightExtractor, PlanApprovalGuard, MemoryRecall
- Stale v4.0 version strings updated in LoadContext, WorkCompletionLearning, prd-template

## [5.5.0] — 2026-05-19

Memory lifecycle automation, knowledge intelligence, auto-consolidation.

### Added
- `hooks/InsightExtractor.hook.ts` — auto-captures learnings from session conversations at session end
- `PAI/Tools/AutoConsolidate.ts` — guard-railed STAGING→WISDOM promotion with dedup
- `PAI/Tools/ContradictionDetector.ts` — finds version/claim conflicts across knowledge files
- `PAI/Tools/KnowledgeHealth.ts` — telemetry analysis for knowledge freshness/coverage
- `PAI/Tools/MemorySearch.ts` — fast keyword search across MEMORY/ with budget control
- `PAI/Tools/ValidateKnowledge.ts` — schema validation for knowledge file frontmatter
- `hooks/lib/knowledge-schema.ts` — shared knowledge file parsing/validation
- `skills/PAI/Search/` — `/search` command for memory retrieval
- `skills/WikiQuery/` — local engineering wiki query skill (user-customizable)
- 7 new test files (AutoConsolidate, ContradictionDetector, InsightExtractor, KnowledgeHealth, KnowledgeSchema, MemorySearch, ValidateKnowledge)

### Changed
- Manifest updated: 81 skills, 42 hooks, 18 agents
- README version bump to 5.5.0
- Deep PII/brand scrub pass on all tracked files
- Banner tools updated to reference kai-cli/kai
- Removed stale `skills/KAIUpgrade/` (replaced by `skills/Utilities/KAIUpgrade/`)

### Fixed
- `hooks/lib/config-loader.ts` — added `loadRequiredTags()` and `loadRelatedDomains()` exports
- Test data genericized (removed domain-specific terms from test fixtures)

---

## [5.4.0] — 2026-05-18

Knowledge schema foundation, memory search, contradiction detection.

### Added
- Knowledge file YAML frontmatter schema (domain, updated, tags, related)
- `scripts/migrate-knowledge-frontmatter.ts` — one-shot migration tool
- Domain-based knowledge injection via `config/domains.jsonc`

### Changed
- 784 tests passing

---

## [5.3.0] — 2026-05-15

Steering enforcement, multi-model research, graceful session exit, self-learning capabilities.

### Added
- `hooks/PlanApprovalGuard.hook.ts` — detects plan presentations via signal co-occurrence (>=2 of: phase header, completion gate, time estimate, execution order), injects approval reminder at next prompt
- `hooks/handlers/PlanDetection.ts` — Stop handler for plan signal detection, writes plan-pending state
- `skills/PAI/End/` — `/end` command for graceful session close with structured summary
- `scripts/deliberate.ts --mode research` — scatter-gather-synthesize research across Gemini (google_search grounding) and Grok (search_parameters)
- `skills/Deliberate/Workflows/ResearchMode.md` — research mode documentation
- `CAPABILITIES.md` system — cross-project capability/skill tracking, auto-learning
- Stale PRD surfacing in LoadContext (>14 days, 0 progress) + Board API `stale` flag
- `validateConfig()` now validates hook entry shapes (direct, matcher-grouped, grouped-no-matcher)
- Agent invocation guide in `PAI/PAIAGENTSYSTEM.md` with quick-reference table
- 50+ new tests: PlanApprovalGuard (28), HookFunctions (43), MemoryFunctions (14), BuildSettings hook validation (7)

### Changed
- Algorithm version reference updated to v3.13.0
- LoadContext version string updated to v5.3.0
- CONTEXT_ROUTING.md rewritten as clean template (personal content removed)
- README attribution rewritten: clear credit to Daniel Miessler's PAI, clear divergence statement
- `AlgorithmTracker.hook.ts` exports `detectPhaseFromBash()` and `parseCriterion()` for testing
- `SkillGuard.hook.ts` exports `shouldBlockSkill()` with `import.meta.main` guard
- `LocalContextFirst.hook.ts` exports `loadDomainPatterns()` and `matchesDomainTopics()`
- `PreCompact.hook.ts` exports `loadIdentity()` and `loadAlgorithmState()`
- `SecurityValidator.hook.ts` exports `trimOldEntries()`
- `LearningPatternSynthesis.ts` CLI wrapped in `import.meta.main` guard

### Fixed
- BuildSettings validation no longer rejects hooks with `{matcher, hooks:[...]}` shape
- SessionCleanup cleans `plan-pending.json` at session end

### Test Coverage
- Total: 529 tests across 27 files (up from 457)

---

## [5.2.0] — 2026-04-30

Foundation completion, routing intelligence, and test coverage.

### Added
- `hooks/ReadTracker.hook.ts` — PostToolUse:Read async hook; tracks KAI-internal file reads to `MEMORY/STATE/read-log.jsonl` with 90-day retention, 1MB cap, and per-session deduplication
- `PAI/Tools/RoutingCandidates.ts` — CLI surfacing frequently-read files missing from routing table
- `PAI/Tools/RoutingAudit.ts` propose mode — generates copy-paste routing rows with Haiku labels and offline fallback
- `hooks/handlers/BuildSettings.ts` `--dry-run` flag — previews config diff without writing
- `docs/planning/steering-enforcement-design.md` — full design spike for v5.3.0 plan-approval enforcement
- `config/starters/` archetype files now canonical in source; syncs to kai
- Template files for `PAI/USER/` scaffold (AISTEERINGRULES.md.template, PROJECTS.md.template)
- `hooks/handlers/BuildSettings.ts --dry-run` — previews what would change before writing

### Fixed
- `VERSION` file updated to 5.1.0 (was stale at 4.9.0)
- `KnowledgeHarvester.ts` now reads from `config/domains.jsonc` via config-loader (was using hardcoded fallback always)
- 5 CommonJS `require()` calls converted to ESM imports across hooks and tools
- `hooks/ReadTracker.hook.ts`, `SessionAutoName`, `WorkCompletionLearning`, `KnowledgeSync`, `SessionCleanup` all guarded with `import.meta.main` (prevents process.exit when imported by test runner)
- `docs/architecture/SYSTEM-ATLAS.md` archived as v4.4.0 snapshot (was 9 versions stale, actively misleading)
- `hooks/lib/metadata-extraction.ts` deleted (zero importers or runtime references)
- `hooks/lib/github-approve.ts` documented as runtime CLI invoked by GitHubWriteGuard, not an import
- `scripts/verify-release.sh` version consistency gate — manifest.json is canonical SoT; preferences.jsonc, VERSION, install.sh banner all checked against it
- `hooks/README.md` footer: corrected stale counts (was 22/13, now 40/26)
- `install.sh` header updated to KAI Installer v5.1; upgrade vs fresh-install messaging added

### Changed
- Hook count: 39 → 40 (ReadTracker)
- Tests: 367 → 437 (+70): 5 new test files for hooks (LoadContext, SessionAutoName, SessionCleanup, WorkCompletionLearning, KnowledgeSync), 4 BuildSettings dry-run tests, 2 ConfigLoader edge-case tests

## [5.1.0] — 2026-04-29

Cleanup, config layer completion, skill count fix, and archetype installer.

### Fixed
- `hooks/lib/config-loader.ts` — JSONC regex now preserves URLs with `://` (lookbehind fix matching BuildSettings pattern)
- `BuildManifest.ts` skill count: recursive walk replaces shallow maxdepth-2 walk (41 → 79)
- `verify-release.sh` skill count to match recursive walk
- `hooks/lib/recovery-block.ts` — stale v3.12.0 / v3.10.0 references updated to v3.13.0
- `PAI/Tools/BuildCLAUDE.ts` — stale v3.12.0 fallback updated to v3.13.0
- `PAI/Tools/deploy.ts` — VERSION now reads from `manifest.json` at runtime (was hardcoded 4.5.0)
- `hooks/handlers/DocCrossRefIntegrity.ts` — removed phantom `custom-agents/` directory checks
- `hooks/lib/knowledge-readback.ts` — migrated from hardcoded constants to config-loader calls (C1)

### Added
- `hooks/lib/config-loader.ts` for KAI — exposes `loadDomainKeywords`, `loadDomainDescriptions`, `loadProjectMapping`, `loadExcludedProjects`, `getMaxDomainsPerSession`
- `tests/ConfigLoader.test.ts` — 30 tests covering normal load, graceful degradation (missing/malformed/empty config), JSONC comment handling, URL preservation, and integration against actual domains.jsonc
- `config/starters/` — 4 archetype domain configs: generic, fullstack, datascience, devops
- `PAI-Install/main.ts` — Step 2 archetype selection (7 steps total); validates JSONC before writing
- `PAI/README.md` — documents PAI/ vs skills/PAI/ intended split
- `scripts/verify-release.sh` section 12 — PAI/ vs skills/PAI/ divergence guard with seeded allowlist

### Removed
- `policy-limits.json` — phantom enforcement with all flags false, zero consumers
- `statusline-command.sh` — 917-line shell script replaced by `statusline.ts`; all 8 references updated
- `lib/migration/` — 5 dead TypeScript files, no runtime consumers; doc references cleaned
- `PAI/Algorithm/v3.9.1.md`, `v3.10.0.md`, `v3.11.0.md`, `v3.12.0.md` — archived to `PAI/Algorithm/archive/`

### Changed
- Skill counts updated everywhere: 41 → 79 (BuildManifest, verify-release.sh, README, QUICKSTART, WHATS-DIFFERENT)
- `scripts/deploy.ts` — rebranded to KAI, package name `kai-VERSION`
- 376 tests passing (up from 367)

## [5.0.1] — 2026-04-28

Release hardening — fixes verify-release.sh false confidence, corrects stale counts, and wires config-loader to domain-aware hooks.

### Fixed
- verify-release.sh count check now handles marker syntax (was silently passing on mismatched counts)
- Multi-author check promoted from warn to fail
- release.sh Gate 6 now fails (not skips) when RELEASE-BLOCKERS.md is absent
- CHANGELOG test count corrected (338 → 367)
- Brand consistency check excludes planning docs (legitimate kai references)
- CI smoke test validates `{{PRODUCT_NAME}}` template variable in CLAUDE.md.template
- CI smoke test now asserts manifest counts match filesystem
- CLAUDE.md.template body uses `{{PRODUCT_NAME}}` (was hardcoded product name)
- Pre-commit hook identity + PII gates now repo-aware (kai only)

### Changed
- `knowledge-readback.ts` reads project mappings from `config/domains.jsonc` via config-loader
- `KnowledgeHarvester.ts` reads domain definitions from `config/domains.jsonc` with built-in fallback
- `BuildManifest.ts` now tracks `counts.tests` (test file count)
- `sync-to-kai.sh` sets `productName: "KAI"` automatically after sync
- Version bumped to 5.0.0 in `preferences.jsonc`
- Hook count updated: 35 → 36 (HealthCheck added)

## [5.0.0] — 2026-04-23

Initial public release of KAI (Kaizen AI).

### Features
- **Algorithm v3.13.0** — Parallelization gate, phantom capability prune, version centralization
- **83 skills** — Research, Security, Analysis, Writing, Engineering Manager workflows, and more
- **47 hooks** — Lifecycle automation including SecretScanner, GitHubWriteGuard, RatingCapture, BuildSettings
- **18 named agents** — Architect, Engineer, researchers, Pentester, and domain specialists
- **Memory system** — Cross-project knowledge distillation, staging, curation
- **Security hooks** — SecretScanner, GitHubWriteGuard, SecurityValidator
- **Kanban board** — `scripts/board.ts` with REST API at localhost:3333
- **Multi-model deliberation** — `scripts/deliberate.ts` for cross-model debate and research
- **367 tests passing (all green)** — Coverage across hooks, tools, and integration paths

### Infrastructure
- Template-based configuration (`config/identity.jsonc`, `.env.example`)
- Three-category file model (System / User / Runtime)
- Symlink-based installation (`~/.claude` → cloned repo)
- `install.sh` with backup and rollback support
