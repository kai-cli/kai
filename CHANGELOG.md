# Changelog

All notable changes to KAI will be documented in this file.

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
- **79 skills** — Research, Security, Analysis, Writing, Engineering Manager workflows, and more
- **39 hooks** — Lifecycle automation including SecretScanner, GitHubWriteGuard, RatingCapture, BuildSettings
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
