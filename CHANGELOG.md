# Changelog

All notable changes to KAI will be documented in this file.

## [5.0.1] — 2026-04-28

Release hardening — fixes verify-release.sh false confidence, corrects stale counts, and wires config-loader to domain-aware hooks.

### Fixed
- verify-release.sh count check now handles marker syntax (was silently passing on mismatched counts)
- Multi-author check promoted from warn to fail
- release.sh Gate 6 now fails (not skips) when RELEASE-BLOCKERS.md is absent
- CHANGELOG test count corrected (338 → 367)
- Brand consistency check excludes planning docs (legitimate kai references)
- CI smoke test validates `# KAI` header specifically, not any `#` header
- CI smoke test now asserts manifest counts match filesystem
- CLAUDE.md.template body uses `{{PRODUCT_NAME}}` (was hardcoded product name)
- Pre-commit hook identity + PII gates now repo-aware (kai only)

### Changed
- `knowledge-readback.ts` reads project mappings from `config/domains.jsonc` via config-loader
- `KnowledgeHarvester.ts` reads domain definitions from `config/domains.jsonc` with built-in fallback
- `BuildManifest.ts` now tracks `counts.tests` (test file count)
- `sync-to-kai.sh` sets `productName: "KAI"` automatically after sync
- Version bumped to 5.0.0 in `preferences.jsonc` and `VERSION`
- Hook count updated: 35 → 36 (HealthCheck added)

## [5.0.0] — 2026-04-23

Initial public release of KAI (Kaizen AI).

### Features
- **Algorithm v3.12.0** — Parallelization gate, phantom capability prune, version centralization
- **41 skills** — Research, Security, Analysis, Writing, Engineering Manager workflows, and more
- **36 hooks** — Lifecycle automation including SecretScanner, GitHubWriteGuard, RatingCapture, BuildSettings
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
