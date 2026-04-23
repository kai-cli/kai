# Changelog

All notable changes to KAI will be documented in this file.

## [5.0.0] — 2026-04-23

Initial public release of KAI (Kaizen AI).

### Features
- **Algorithm v3.12.0** — Parallelization gate, phantom capability prune, version centralization
- **41 skills** — Research, Security, Analysis, Writing, Engineering Manager workflows, and more
- **41 hooks** — Lifecycle automation including KnowledgeSync, SecretOutputDetector, WebFetchGuard, RatingCapture
- **18 named agents** — Architect, Engineer, researchers, Pentester, and domain specialists
- **Memory system** — Cross-project knowledge distillation, staging, curation (`pai curate`, `pai harvest`)
- **Security hooks** — SecretScanner, SecretOutputDetector, WebFetchGuard, GitHubWriteGuard
- **Kanban board** — `scripts/board.ts` with REST API at localhost:3333
- **Multi-model deliberation** — `scripts/deliberate.ts` for cross-model debate and research
- **314 tests passing** — Coverage across hooks, tools, and integration paths

### Infrastructure
- Template-based configuration (`config/identity.jsonc`, `.env.example`)
- Three-category file model (System / User / Runtime)
- Symlink-based installation (`~/.claude` → cloned repo)
- `install.sh` with backup and rollback support
