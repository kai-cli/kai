# KAI — Roadmap

> Canonical repo: `github.com/kai-cli/kai`

---

## v5.0.0 — Current Release

- [x] Algorithm v3.12.0 — parallelization gate, capability prune, version centralization
- [x] Memory curation — `pai curate` CLI, STAGING, draft lifecycle, ReflectionHarvester
- [x] Self-learning loop — rating-triggered drafts, KnowledgeSync auto-triggers, nudge system
- [x] Security — WebFetchGuard, SecretOutputDetector, hook timeouts, memory TTL
- [x] 314 tests passing

---

## Backlog

### Configuration Layer (v5.1.0)
- [ ] `config/domains.jsonc` — user-configurable knowledge domains
- [ ] `hooks/lib/config-loader.ts` — single config module for all hooks
- [ ] Refactor KnowledgeSync, knowledge-readback, LocalContextFirst to use config

### Setup & Install (v5.1.0)
- [ ] `pai setup` — interactive wizard with archetype selection
- [ ] `install.sh` — curl-pipe installer with proper `~/.claude` handling
- [ ] Template files for PAI/USER/ and config/

### Infrastructure
- [ ] Confidence calibration — track approval rate, adjust draft thresholds
- [ ] Batch approve — `pai curate approve-all --confidence N`

### Future
- [ ] Local model support (Ollama/llama.cpp)
- [ ] Multi-machine remote access
- [ ] External notifications (Discord/Slack/email)
