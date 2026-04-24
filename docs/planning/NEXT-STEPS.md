# KAI — Roadmap & Next Steps

> Canonical repo: `github.com/kai-cli/kai`

---

## Shipped

| Release | Date | Highlights |
|---------|------|-----------|
| **v5.0.0** | 2026-04 | Algorithm v3.12.0, 41 skills, 37 hooks, 18 agents, memory curation, self-learning loop, 335 tests |
| **v4.9.0** | 2026-04 | Parallelization gate, phantom cap prune, version centralization |
| **v4.8.0** | 2026-03 | Memory curation, staging, `pai curate`, `pai harvest`, security hooks, 248 tests |
| **v4.7.0** | 2026-03 | KnowledgeSync, Algorithm v3.11.0, context routing |
| **v4.5.0** | 2026-03 | Ralph Loop, multi-agent orchestrator, Board v2, SecretScanner, SecurityValidator |
| **v4.4.0** | 2026-03 | EM/PLM workflows, 3 named agents, CompetitiveIntel, StandardsTracker |
| **v4.1.0** | 2026-03 | Atomic writes, payload schema validation, settings split, `pai upgrade` CLI |

---

## v5.1.0 — Research, Quality & Polish

### Configuration Layer (shipped in v5.0.0)
- [x] `config/domains.jsonc` — user-configurable knowledge domains
- [x] `hooks/lib/config-loader.ts` — single config module for all hooks
- [x] Refactor LocalContextFirst to use config-loader
- [x] `hooks/user/` — user-custom hook loading mechanism
- [x] `config/preferences.local.jsonc` — machine-specific overrides (Bedrock)
- [x] `BuildSettings.ts` — env var preservation across rebuilds

### Setup & Install (shipped in v5.0.0)
- [x] `install.sh` — interactive setup with archetype selection
- [x] `get-kai.sh` — curl-pipe installer with 3-case `~/.claude` handling
- [x] Template files for PAI/USER/ and config/
- [x] `CUSTOMIZATION.md` — user guide for config, hooks, domains, Bedrock

### Deliberate Research Mode
- [ ] `PAI/Tools/ModelInvocation.ts` — shared model invocation with web search support
- [ ] `Inference.ts` — add `tools` param for web_search
- [ ] `deliberate.ts` — `--mode research` (Scatter-Verify-Synthesize pipeline)
- [ ] `deliberate.ts` — `--rotate` (parallel rotation, empirical role validation)
- [ ] `deliberate.ts` — web search grounding (Gemini, Grok, GPT Responses API, Claude)
- [ ] `deliberate.ts` — dynamic model-to-role assignment with `--roles` override
- [ ] Skill docs: Deliberate Research workflow, Research CrossValidation workflow
- [ ] Plan: `Plans/deliberate-research-mode.md`

---

## Backlog (unversioned)

### Quality & Reliability
- [ ] PostToolUse code quality gate — error/lint/syntax detection after edits
- [ ] Agent context seeding — auto-inject prior ResearchIndex findings into spawned agents (infrastructure built, manual only today)
- [ ] Confidence calibration — track approval rate, adjust draft thresholds
- [ ] Batch approve — `pai curate approve-all --confidence N`

### KAI Public Launch
- [x] Git history rewrite — PII purged, author rewritten to KAI Maintainer
- [x] LICENSE (MIT), CONTRIBUTING.md, CHANGELOG.md
- [x] Symlink compatibility verified
- [ ] Team deployment guide — org-config patterns, multi-user setup for kai-cli/kai
- [ ] Org-config templates — shareable team configurations
- [ ] End-to-end test — `get-kai.sh` on clean machine without `~/.claude`

### Future
- [ ] Automatic model routing — detect task complexity, route to fast/standard/smart without manual selection
- [ ] Local model support (Ollama/llama.cpp)
- [ ] Multi-machine remote access
- [ ] External notifications (Discord/Slack/email)
