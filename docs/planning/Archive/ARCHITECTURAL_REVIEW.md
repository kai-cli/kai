# PAI Architectural Review & Proposed Improvements

**Author:** Oz (AI Review) | **Date:** 2026-03-05 | **PAI Version:** v4.0.3 / Algorithm v3.7.0

## Executive Summary

This document presents an independent architectural review of the Personal AI Infrastructure (PAI) project. After analyzing the full codebase — CLAUDE.md, settings.json, Algorithm v3.7.0, Skill System, Hook System, Memory System, security model, release structure, and platform compatibility — this review identifies 10 critical architectural issues and proposes concrete improvements ordered by impact.

PAI's philosophical foundation is strong: the 16 principles, TELOS goal system, User/System separation, and PRD-as-system-of-record are well-designed. The issues identified are implementation-level concerns that, if addressed, would significantly improve performance, reliability, maintainability, and developer experience.

## What's Working Well

- **Clear philosophical framework** — 16 principles are coherent and opinionated in productive ways
- **TELOS system** — Goal-oriented personal context is the core differentiator from generic AI tooling
- **User/System separation** — `USER/` vs system files is clean and conceptually upgrade-safe
- **Hook lifecycle** — Event-driven design with Pre/PostToolUse, Stop, SessionStart/End is solid
- **Memory domain decomposition** — WORK/, LEARNING/, STATE/, RESEARCH/ is reasonable
- **PRD-as-system-of-record** — AI writes state directly; hooks only read. Eliminates indirection bugs
- **Skill customization pattern** — EXTEND.yaml + SKILLCUSTOMIZATIONS/ is elegant
- **Dynamic context loading** — On-demand skill loading via SkillSearch reduces token waste

---

## Critical Issue 1: Context Window Budget Hemorrhage

**Severity:** HIGH | **Impact:** Every session | **Effort:** Low

### Problem

`settings.json` is 1,057 lines. It contains:

- `spinnerVerbs`: ~500 entries (pure personality, zero functional value)
- `spinnerTipsOverride.tips`: ~200 entries (duplicate content already in system docs)
- `_docs` fields throughout (JSON doesn't support comments, so docs are inline data)

All of this is loaded at startup. Combined with CLAUDE.md (native load), `loadAtStartup` files (AISTEERINGRULES, user rules, projects), and `LoadContext.hook.ts` dynamic injection (relationship context, learning readbacks, work summaries), a significant portion of the context window is consumed before the user types anything.

### Proposed Fix

1. **Move spinnerVerbs to external file** — `~/.claude/config/spinner-verbs.json`. Claude Code reads this separately from settings.json; it doesn't need to be in the LLM context.
2. **Move spinnerTipsOverride to external file** — `~/.claude/config/spinner-tips.json`. Same rationale.
3. **Remove `_docs` fields from settings.json** — Create a `settings.schema.json` or `settings.README.md` for documentation. The `_docs` keys add ~100 lines of text loaded into context.
4. **Audit loadAtStartup files** — Measure actual token cost of each injected file. Consider lazy-loading AISTEERINGRULES only when steering behavior is relevant.

### Expected Impact

Recovering 20-40% of wasted startup context, making more room for actual task context during complex work.

---

## Critical Issue 2: File-Based State With No Concurrency Protection

**Severity:** HIGH | **Impact:** Data integrity | **Effort:** Medium

### Problem

All state is JSONL/JSON on disk. Multiple hooks fire on the same event:

- `Stop`: 5 hooks fire, some writing to overlapping files
- `UserPromptSubmit`: 3 hooks fire concurrently
- `events.jsonl`: append-only log written by 15+ hooks across all event types

JSONL append is mostly safe for single-process serial writes, but Claude Code may run hooks concurrently. There is no file locking, no atomic writes (write-to-temp + rename), and no checksum validation.

### Proposed Fix

1. **Short-term: Atomic write pattern** — All JSON state writes should use write-to-`.tmp`-then-rename:

```typescript
import { writeFileSync, renameSync } from 'fs';

function atomicWriteJSON(path: string, data: unknown): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, path);
}
```

2. **Medium-term: SQLite for structured state** — Bun has native SQLite support (`bun:sqlite`). Replace `events.jsonl`, `work.json`, `session-names.json`, `ratings.jsonl`, and `algorithm-reflections.jsonl` with a single `pai.db`:
   - `events` table (append-only, indexed by type + timestamp)
   - `work` table (PRD metadata, status, criteria counts)
   - `ratings` table (structured ratings with session FK)
   - `sessions` table (names, timestamps, metadata)
   - Benefits: ACID transactions, concurrent write safety, SQL queries for analytics, single file backup

3. **Retain JSONL export** — For observability (`tail -f`), add a `pai export events --follow` CLI command that tails the SQLite WAL.

### Expected Impact

Eliminates data corruption risk from concurrent writes. Enables richer queries over historical data. Single-file backup instead of scattered JSON.

---

## Critical Issue 3: Inference Cost and Latency Per Prompt

**Severity:** HIGH | **Impact:** Every prompt | **Effort:** Medium

### Problem

Every `UserPromptSubmit` triggers 3 hooks that each make Anthropic API calls:

- `RatingCapture.hook.ts` — Haiku inference for implicit sentiment analysis
- `UpdateTabTitle.hook.ts` — Haiku inference for tab title summary
- `SessionAutoName.hook.ts` — Haiku inference for session name

That's 3 API round-trips per user prompt, plus additional inference calls on `Stop` events. This adds latency (3 × ~1-2s = 3-6s overhead) and cost to every interaction.

### Proposed Fix

1. **Batch inference** — Create a single `PromptAnalysis` hook that makes ONE Haiku call with a combined system prompt:

```typescript
const result = await inference({
  level: 'fast',
  expectJson: true,
  systemPrompt: `Analyze this user prompt. Return JSON:
    { "sentiment": { "rating": 1-10, "confidence": 0-1 },
      "tab_title": "4-word summary",
      "session_name": "4-word-kebab-name" }`,
  userPrompt: prompt
});
```

This reduces 3 API calls to 1, cutting latency by ~66% and cost by ~66%.

2. **Debounce SessionAutoName** — Only run on the first substantive prompt (it partially does this, but the hook still fires and checks every time). Add an early exit if session already named.

3. **Skip sentiment on short prompts** — Prompts under 10 characters ("ok", "thanks", "7") don't need inference for sentiment — use pattern matching only.

4. **Local inference option** — For these lightweight classification tasks, support Ollama/llama.cpp as a `level: 'local'` option in `Inference.ts`. A 1B parameter model can handle tab titles and sentiment.

### Expected Impact

66% reduction in per-prompt API costs and latency. Path toward zero-cost inference for trivial classifications.

---

## Critical Issue 4: No Test Suite

**Severity:** HIGH | **Impact:** Reliability, contributions | **Effort:** Medium

### Problem

Despite "Spec / Test / Evals First" being Principle #7, the project has zero automated tests. There is `validate-protected.ts` for secret scanning, but:

- No unit tests for any of the 21 hooks
- No integration tests for the memory system
- No end-to-end tests for the Algorithm execution
- No skill validation tests
- No schema validation tests for settings.json or PRD frontmatter

For a system that modifies itself and its own configuration, untested self-modification is high-risk.

### Proposed Fix

1. **Hook contract tests** — For each hook, test: given specific JSON on stdin, assert specific file writes:

```typescript
// tests/hooks/RatingCapture.test.ts
import { test, expect } from 'bun:test';

test('explicit rating 7 writes to ratings.jsonl', async () => {
  const input = { prompt: '7', session_id: 'test-123' };
  // Run hook with mocked stdin
  // Assert ratings.jsonl has new entry with rating: 7
});
```

2. **Memory system round-trip tests** — Write → read → validate for every memory directory.
3. **PRD parsing tests** — Validate frontmatter extraction, criteria counting, phase transitions.
4. **Settings schema validation** — Use Zod or JSON Schema to validate settings.json structure at startup.
5. **CI pipeline** — GitHub Actions running `bun test` on every PR.

### Expected Impact

Catch regressions before release. Enable confident refactoring. Lower barrier for community contributions.

---

## Critical Issue 5: Monolithic settings.json

**Severity:** MEDIUM | **Impact:** Maintainability | **Effort:** Medium

### Problem

1,057 lines in a single JSON file configuring: identity, permissions, hooks, notifications, UI, counts, preferences, tech stack, MCP servers, display settings, and documentation. JSON has no comment syntax, so documentation is stored as `_docs` data fields that consume context tokens.

A single typo (missing comma, unclosed bracket) in any section breaks the entire system.

### Proposed Fix

1. **Split into domain files:**

```
~/.claude/config/
├── identity.jsonc      # daidentity + principal
├── hooks.jsonc         # hook registrations
├── permissions.jsonc   # allow/deny/ask lists
├── notifications.jsonc # ntfy, discord, twilio routing
├── preferences.jsonc   # tech stack, display, temperature
├── spinner-verbs.json  # personality (NOT loaded into LLM context)
└── spinner-tips.json   # tips (NOT loaded into LLM context)
```

2. **Use JSONC** — Bun supports JSON with comments natively. Replace `_docs` fields with actual comments.
3. **Merge at startup** — `BuildCLAUDE.ts` (or a new `BuildSettings.ts`) merges split files into the `settings.json` that Claude Code expects.
4. **Validate on merge** — Run Zod schema validation during the merge step. Fail fast with clear error messages.

### Expected Impact

Smaller blast radius for config errors. Actual comments instead of data-as-documentation. Cleaner git diffs when changing one concern.

---

## Critical Issue 6: Tight Coupling to Claude Code Internals

**Severity:** MEDIUM | **Impact:** Fragility across upgrades | **Effort:** Medium

### Problem

The system assumes specific Claude Code behaviors with no abstraction:

- Transcript format (`type: "user"` — already broke once when it changed from `"human"`)
- Hook stdin payload shapes (no runtime validation)
- `Skill` and `Task` tool availability and parameter formats
- `CLAUDE.md` native loading behavior
- `projects/` directory structure and JSONL format

Claude Code is in active development. Any of these can change.

### Proposed Fix

1. **Typed hook payload interfaces with runtime validation:**

```typescript
// hooks/lib/payload-schema.ts
import { z } from 'zod';

export const UserPromptPayload = z.object({
  session_id: z.string(),
  transcript_path: z.string(),
  hook_event_name: z.literal('UserPromptSubmit'),
  prompt: z.string(),
});

export type UserPromptPayload = z.infer<typeof UserPromptPayload>;
```

2. **Adapter layer for transcript parsing** — A single `TranscriptReader` class that abstracts the JSONL format. When Claude Code changes the format, fix one file.
3. **Version-gated behavior** — Check Claude Code version at startup. If breaking changes detected, warn and gracefully degrade.

### Expected Impact

Clear error messages when Claude Code changes break assumptions. Single points of change for format migrations.

---

## Critical Issue 7: Algorithm Overhead for Simple Tasks

**Severity:** MEDIUM | **Impact:** User experience | **Effort:** Low

### Problem

Algorithm v3.7.0 has mandatory ceremony even for Standard effort (~2 min budget):

1. Read full Algorithm file (~350 lines)
2. Synchronous voice curl ("Entering the Algorithm")
3. Create PRD directory + stub file with frontmatter
4. Reverse engineering output (explicit wants, implied wants, not-wanted)
5. Effort level determination
6. ISC criteria generation (minimum 8)
7. Capability selection (mandatory)
8. 7 phase transitions, each with voice curl + PRD edit

For tasks like "fix this typo" or "rename this variable", this ceremony takes longer than the actual work.

### Proposed Fix

1. **Introduce a "Micro" effort tier** below Standard:
   - Budget: <30s
   - ISC: 1-4 (no floor gate)
   - No PRD creation
   - No voice announcements
   - No capability selection
   - Phases collapsed: Observe+Plan → Execute → Verify (3 phases, not 7)

2. **Lazy-load Algorithm file** — CLAUDE.md currently says "Use the Read tool to load `PAI/Algorithm/v3.7.0.md`" for ALGORITHM mode. Move the effort tier classification INTO CLAUDE.md (just the decision logic, not the full algorithm). Only load the full file for Extended+ tiers.

3. **Pre-classify in CLAUDE.md** — Add a quick heuristic:

```
If request is < 20 words AND matches [fix, rename, update, change, set, add, remove]:
  → NATIVE mode (skip Algorithm entirely)
```

### Expected Impact

Eliminate 30-60s of overhead for simple tasks. Reserve full Algorithm ceremony for work that benefits from it.

---

## Critical Issue 8: Release Distribution Is Fragile

**Severity:** MEDIUM | **Impact:** Upgrade safety | **Effort:** High

### Problem

`cp -r .claude ~/` is the install/upgrade mechanism. Issues:

- No atomic upgrade (partial copy if interrupted = broken state)
- No automatic backup (manual `cp -r ~/.claude ~/.claude-backup-$(date)` suggested but not enforced)
- No dependency checking (Bun version, Claude Code version compatibility)
- No integrity verification (checksums, file counts)
- No rollback mechanism (manual restore from backup)

### Proposed Fix

1. **`pai upgrade` CLI tool** — A Bun TypeScript CLI that:
   - Auto-backs up current installation
   - Downloads/copies release to staging directory
   - Validates integrity (checksums, required files)
   - Checks dependencies (Bun version, Claude Code presence)
   - Performs atomic swap (rename current → `.old`, rename staging → current)
   - Runs post-upgrade hooks (BuildCLAUDE.ts, settings migration)
   - On failure: auto-rollback to `.old`

2. **Release manifest** — Each release includes `manifest.json`:

```json
{
  "version": "4.0.3",
  "requires": { "bun": ">=1.0", "claude-code": ">=1.0" },
  "files": { "hooks/SecurityValidator.hook.ts": "sha256:abc..." },
  "migrations": ["migrate-user-context.ts"]
}
```

3. **Differential upgrades** — Instead of copying the entire `.claude/` directory, only copy changed files based on manifest diffs.

### Expected Impact

Safe, atomic upgrades with automatic rollback. No more broken installations from interrupted copies.

---

## Critical Issue 9: Voice System Coupling

**Severity:** LOW | **Impact:** Maintainability, extensibility | **Effort:** Low

### Problem

`http://localhost:8888/notify` is hardcoded in:

- Algorithm v3.7.0 (direct curl commands in markdown)
- Every SKILL.md template (curl in "Voice Notification" section)
- Hook handlers (VoiceNotification.ts)

ElevenLabs voice IDs are similarly hardcoded in curl commands. Adding a new TTS provider (local Piper, OpenAI TTS, Google TTS) requires touching dozens of files.

### Proposed Fix

1. **Voice utility function** — All voice calls go through one function:

```typescript
// hooks/lib/voice.ts
export async function announce(message: string, opts?: { voiceId?: string }): Promise<void> {
  const config = getVoiceConfig(); // reads from settings.json
  if (!config.enabled) return;
  await fetch(`${config.serverUrl}/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, voice_id: opts?.voiceId ?? config.defaultVoiceId })
  }).catch(() => {}); // fire-and-forget
}
```

2. **Update Algorithm markdown** — Replace inline curl commands with a reference: "Call the voice utility with message: 'Entering the Algorithm'"
3. **Provider abstraction in VoiceServer** — The server already supports ElevenLabs and Google TTS. Formalize this with a provider interface.

### Expected Impact

Single point of change for voice configuration. Easy to add new TTS providers.

---

## Critical Issue 10: Memory System Needs Retention Policies

**Severity:** LOW | **Impact:** Long-term disk usage | **Effort:** Low

### Problem

- `events.jsonl` is append-only, never truncated — grows without bound
- `LEARNING/` and `WORK/` have no retention policy (Claude Code's `projects/` has 30-day retention, but PAI's own directories don't)
- `MEMORY/STATE/` accumulates session state files (`algorithms/`, `kitty-sessions/`, `tab-titles/`) with no cleanup
- No size monitoring or disk usage alerts
- 7 major memory system migrations in 3 months (v1.0→v7.2) suggests the schema isn't stable — old formats may linger

### Proposed Fix

1. **Retention policies in settings.json:**

```json
"memory": {
  "retention": {
    "events": { "maxSizeMB": 100, "maxAgeDays": 90 },
    "state": { "maxAgeDays": 30 },
    "learning": { "maxAgeDays": 365 },
    "work": { "maxAgeDays": 180, "keepCompleted": true }
  }
}
```

2. **Maintenance hook** — A `SessionEnd` hook (or periodic cron) that enforces retention:
   - Rotate `events.jsonl` when it exceeds maxSizeMB (archive to `events.{date}.jsonl.gz`)
   - Delete orphaned session state files older than maxAgeDays
   - Archive completed WORK/ directories older than retention period

3. **Disk usage in statusline** — Show MEMORY/ total size in the status bar. Alert when approaching a threshold.

### Expected Impact

Predictable disk usage. No unbounded growth. Clean state directory.

---

## Additional Recommendations

### A. Schema Validation Everywhere

Add Zod schemas for: settings.json, PRD frontmatter, hook payloads, event types, skill YAML frontmatter. Validate at runtime boundaries (hook entry, file read, config load). Fail with clear messages instead of silent corruption.

### B. Contribution Experience

- Add `CONTRIBUTING.md` with setup instructions, test commands, and PR template
- Add GitHub Actions CI that runs tests + `validate-protected.ts`
- Add a `dev` mode that enables verbose hook logging and disables voice

### C. Windows Support Strategy

Per PLATFORM.md, Windows is unsupported. The recommended path:

1. Convert shell scripts to TypeScript (Bun runs on Windows)
2. Abstract platform-specific operations (notifications, audio, auto-start) behind a `platform.ts` interface
3. Use `process.platform` consistently for branching
4. Target WSL2 as the "easy" Windows path; native Windows as stretch goal

### D. Observability Dashboard

The `events.jsonl` unified event log is a great foundation. Build on it:

- A terminal UI (`bun dashboard.ts`) showing live events, active work, recent ratings
- Aggregate stats: prompts/day, average rating, top skills used, inference cost estimate
- This could replace the current statusline with something richer

### E. Plugin Architecture for Skills

Currently skills are directories with markdown and TypeScript. Consider a more formal plugin system:

- `package.json` per skill (name, version, dependencies, peer skills)
- Skill marketplace/registry (even if just a GitHub repo index)
- Versioned skill APIs so skills can declare compatibility with PAI versions

---

## Implementation Priority

1. **Context bloat reduction** (Issue 1) — Highest ROI, lowest effort. Do this first.
2. **Batch hook inference** (Issue 3) — High impact on every interaction, moderate effort.
3. **Test suite** (Issue 4) — Foundation for all other changes. Start with hooks.
4. **Micro effort tier** (Issue 7) — Immediate UX improvement for simple tasks.
5. **Atomic write pattern** (Issue 2, short-term) — Quick win for data safety.
6. **Split settings.json** (Issue 5) — Improves maintainability for everything else.
7. **Voice utility** (Issue 9) — Low effort, cleans up widespread hardcoding.
8. **Memory retention** (Issue 10) — Prevents future problems.
9. **Hook payload validation** (Issue 6) — Medium effort, prevents silent breakage.
10. **Upgrade CLI** (Issue 8) — High effort but important for growth.

---

## Conclusion

PAI's conceptual architecture is sound — the principles, TELOS, Algorithm, and skill system form a coherent vision for personal AI infrastructure. The issues identified are implementation-level concerns common in rapidly evolving projects (7 major memory migrations in 3 months confirms the pace).

The highest-leverage changes are: reducing context window waste (Issue 1), batching inference calls (Issue 3), and adding tests (Issue 4). These three alone would meaningfully improve performance, cost, and reliability without requiring architectural rewrites.
