# KAI — Roadmap & Next Steps

> Canonical repo: `github.com/kai-cli/kai`

---

## Shipped

| Release | Date | Highlights |
|---------|------|-----------|
| **v5.0.0** | 2026-04 | Algorithm v3.12.0, memory curation (`pai curate`), self-learning loop, WebFetchGuard, SecretOutputDetector, 314 tests |
| **v4.9.0** | 2026-04 | Parallelization gate, phantom cap prune, version centralization |
| **v4.8.0** | 2026-03 | Memory curation, staging, `pai curate`, `pai harvest`, security hooks, 248 tests |
| **v4.7.0** | 2026-03 | KnowledgeSync, Algorithm v3.11.0, context routing |
| **v4.5.0** | 2026-03 | Ralph Loop, multi-agent orchestrator, Board v2, SecretScanner, SecurityValidator |
| **v4.4.0** | 2026-03 | EM/PLM workflows, 3 named agents, CompetitiveIntel, StandardsTracker |
| **v4.1.0** | 2026-03 | Atomic writes, payload schema validation, settings split, `pai upgrade` CLI |

---

## v5.1.0 — Configuration, Setup & Research

### Configuration Layer
- [ ] `config/domains.jsonc` — user-configurable knowledge domains
- [ ] `hooks/lib/config-loader.ts` — single config module for all hooks
- [ ] Refactor KnowledgeSync, knowledge-readback, LocalContextFirst to use config

### Setup & Install
- [ ] `pai setup` — interactive wizard with archetype selection
- [ ] `install.sh` — curl-pipe installer with proper `~/.claude` handling
- [ ] Template files for PAI/USER/ and config/

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
- [ ] PostToolUse code quality gate — error/lint/syntax detection after edits (SecretOutputDetector exists but no code quality check)
- [ ] Agent context seeding — auto-inject prior ResearchIndex findings into spawned agents (infrastructure built, manual only today)
- [ ] Confidence calibration — track approval rate, adjust draft thresholds
- [ ] Batch approve — `pai curate approve-all --confidence N`

### KAI Public Launch
- [ ] Team deployment guide — org-config patterns, multi-user setup for kai-cli/kai
- [ ] Org-config templates — shareable team configurations

### Future
- [ ] Automatic model routing — detect task complexity, route to fast/standard/smart without manual selection
- [ ] Local model support (Ollama/llama.cpp)
- [ ] Multi-machine remote access
- [ ] External notifications (Discord/Slack/email)
