# KAI — Roadmap & Next Steps

> Canonical repo: `github.com/kai-cli/kai`
> kai is the private live installation. kai is the scrubbed public fork.
> Development workflow: develop in kai → cherry-pick to kai → verify-release.sh → push

---

## Shipped

| Release | Date | Highlights |
|---------|------|-----------|
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

## v5.1.0 — Context Intelligence & Configuration

**Theme:** KAI gets smarter about your codebase over time and easier to set up for new users.
**Target:** ~1-2 weeks of development
**Story:** Every session, KAI learns which files you reach for. After enough sessions, it suggests adding them to your routing table. New users get a cleaner install path.

### 1. Read-Tracking for Routing Candidates

**What:** Log every `Read` tool call per session. Surface files that are frequently read but not in `CONTEXT_ROUTING.md` as routing candidates.

**Implementation:**
- `hooks/ReadTracker.hook.ts` — `PostToolUse:Read` hook, writes to `MEMORY/STATE/read-log.jsonl`
  - Entry format: `{ timestamp, session_id, path, project_dir }`
  - Only tracks files inside `PAI_DIR` — skip external paths
- `PAI/Tools/RoutingCandidates.ts` — reads `read-log.jsonl`, aggregates by path, cross-references `CONTEXT_ROUTING.md`, outputs paths loaded ≥N sessions without a route entry
  - CLI: `bun PAI/Tools/RoutingCandidates.ts [--threshold 3] [--days 30]`
- Register `ReadTracker` in `config/hooks.jsonc` as async `PostToolUse:Read`

**Why threshold matters:** Too low = noise. Default 3 sessions is a signal, not an accident.

**Acceptance:** Running `bun PAI/Tools/RoutingCandidates.ts` after 3+ sessions shows unrouted frequently-read files.

---

### 2. Auto-Routing Proposals *(depends on #1)*

**What:** After N sessions with read-tracking data, generate proposed `CONTEXT_ROUTING.md` additions and present them for review.

**Implementation:**
- Extend `RoutingAudit.ts` with a `propose` mode: `bun PAI/Tools/RoutingAudit.ts propose`
  - Reads `RoutingCandidates.ts` output
  - For each candidate, generates a proposed routing table entry (topic label + path)
  - Uses fast inference to name the topic from the file's content
  - Outputs a diff-style proposal block the user can copy into `CONTEXT_ROUTING.md`
- Add `LoadContext` hook nudge: if proposals pending and last nudge >7 days ago, show one-liner at session start

**Acceptance:** `propose` mode outputs valid CONTEXT_ROUTING.md table rows for top unrouted candidates.

---

### 3. BuildSettings Dry-Run Mode

**What:** `bun hooks/handlers/BuildSettings.ts --dry-run` previews what would change in `settings.json` without writing it.

**Implementation:**
- Add `--dry-run` flag to `BuildSettings.ts` CLI entry point
- When set: run `buildSettings()` as normal, then diff result against current `settings.json`, print a unified diff to stdout, exit without writing
- Use `diff` or a simple line-by-line comparison — no external dep needed

**Acceptance:** `--dry-run` prints changes and exits 0. Without flag, behavior unchanged.

---

### 4. Refactor KnowledgeSync / LocalContextFirst to Config Layer

**What:** These two hooks currently have hardcoded domain logic (knowledge paths, context injection rules). Move to `config/domains.jsonc` so users can customize without editing hook source.

**Scope:**
- `hooks/LocalContextFirst.hook.ts` — replace hardcoded knowledge domain checks with `config-loader.ts` read
- `hooks/lib/knowledge-readback.ts` — replace hardcoded path list with domains from config
- `config/domains.jsonc` — already exists with archetype starters; verify it covers the hardcoded cases
- KnowledgeSync excluded from this scope — it's complex enough to be a separate PR

**Acceptance:** Adding a new domain to `config/domains.jsonc` is reflected in `LocalContextFirst` and `knowledge-readback` without code changes.

---

### 5. install.sh — Proper Curl-Pipe Installer

**What:** The current `get-kai.sh` handles download. `install.sh` inside the package handles setup. Close the gap: `install.sh` should handle the case where `~/.claude` already exists (upgrade path) vs fresh install.

**Implementation:**
- Detect existing `~/.claude` — if present, offer upgrade (merge config, preserve env vars) vs fresh overwrite
- Preserve `config/preferences.local.jsonc` across upgrades (already gitignored, should survive)
- Print clear next steps on completion (set env vars, run `/help`)
- Test: `bash install.sh` on both fresh and existing `~/.claude`

**Acceptance:** `install.sh` runs cleanly on a machine with existing `~/.claude` without wiping `preferences.local.jsonc` or env vars.

---

### 6. Template Files for PAI/USER/

**What:** New KAI installs have empty `PAI/USER/` — no guidance on what goes there. Provide starter templates.

**Implementation:**
- `PAI/USER/AISTEERINGRULES.md.template` — personal behavioral overrides (commented examples)
- `PAI/USER/PROJECTS/PROJECTS.md.template` — project registry format with examples
- `install.sh` copies `.template` → actual file only if the target doesn't already exist (safe upgrade)

**Acceptance:** Fresh install produces populated `PAI/USER/` templates the user can edit immediately.

---

### v5.1.0 Completion Gate

- [ ] All 6 items implemented and tested
- [ ] `bun test` passes (335+ tests)
- [ ] `bash scripts/verify-release.sh` passes in kai
- [ ] Cherry-picked to kai, conflicts resolved, no PII
- [ ] `NEXT-STEPS.md` updated with v5.1.0 in Shipped table

---

## v5.2.0 — Deliberate Research Mode

**Theme:** Multi-model web-grounded research as a first-class KAI capability.
**Target:** ~2-3 weeks of development
**Story:** Today `deliberate.ts` rotates between models for debate. v5.2.0 adds a research mode: scatter queries across Gemini, Grok, GPT, and Claude with live web search, verify findings against each other, synthesize a grounded answer. The Deliberate skill gets web eyes.

### Architecture

```
deliberate.ts --mode research "query"
    │
    ├── ModelInvocation.ts (shared layer)
    │       ├── Claude (web_search tool via Anthropic API)
    │       ├── Gemini (Google Search grounding)
    │       ├── Grok (xAI web search)
    │       └── GPT (OpenAI Responses API with web_search)
    │
    └── Scatter-Verify-Synthesize pipeline
            ├── Scatter: parallel queries to all 4 models
            ├── Verify: cross-check claims that appear in ≥2 sources
            └── Synthesize: final answer with source attribution
```

### Items

1. **`PAI/Tools/ModelInvocation.ts`** — shared invocation layer
   - Unified interface: `invoke(model, prompt, options)` → `{ text, sources, latency }`
   - Handles: Anthropic (web_search tool), Gemini (grounding), Grok (xAI SDK), GPT (Responses API)
   - Config-driven: which models are available based on API keys present in env

2. **`Inference.ts` — add `tools` param**
   - Add optional `tools?: AnthropicTool[]` param to all three tiers
   - `web_search` tool definition included as a named export: `WEB_SEARCH_TOOL`
   - Backward compatible — no tools = current behavior

3. **`deliberate.ts --mode research`**
   - Scatter-Verify-Synthesize pipeline (see architecture above)
   - Output: synthesis with inline citations, per-model raw responses available via `--verbose`

4. **`deliberate.ts --rotate`**
   - Parallel rotation with empirical role validation
   - Dynamic model-to-role assignment: measure which model performs best for a given role type across sessions
   - `--roles` flag to override assignment manually

5. **`deliberate.ts` web grounding**
   - Gemini: Google Search grounding via `google.generativeai` SDK
   - Grok: xAI API with `search_parameters`
   - GPT: Responses API with `web_search_preview` tool
   - Claude: Anthropic `web_search` tool (add to Inference.ts first)

6. **Skill docs**
   - `skills/Deliberate/Workflows/ResearchMode.md` — Scatter-Verify-Synthesize workflow
   - `skills/Deliberate/Workflows/CrossValidation.md` — multi-model cross-validation patterns

### v5.2.0 Completion Gate

- [ ] All 6 items implemented
- [ ] Works with ≥2 models when only 2 API keys are present (graceful degradation)
- [ ] `bun test` passes
- [ ] `verify-release.sh` passes in kai
- [ ] Cherry-picked to kai

---

## Backlog (unversioned)

### Quality & Reliability
- [ ] PostToolUse code quality gate — lint/syntax detection after edits
- [ ] Agent context seeding — auto-inject prior ResearchIndex findings into spawned agents
- [ ] Confidence calibration — track approval rate, adjust draft thresholds
- [ ] Batch approve — `pai curate approve-all --confidence N`

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
