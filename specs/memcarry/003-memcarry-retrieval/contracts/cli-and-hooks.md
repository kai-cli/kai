# Contracts — CLI & Hook Interfaces

MemCarry's external surfaces are its **CLI** (what hooks shell out to) and its **hooks** (what Claude
Code invokes at lifecycle events). This sprint modifies one CLI command and adds two hooks. The MCP
server is untouched. All output is JSON on stdout; all failures degrade WITHOUT crashing (exit 0, empty/no
injection) per findings #2/#3.

## C1 — CLI: `memcarry recall` (MODIFIED)

```
memcarry recall "<prompt>" [--project <name>] [--k <n>]
```

**Before:** keyword-only scorer. **After:** hybrid keyword+semantic, RRF-fused, precondition-gated.

**Input:** prompt string (required); `--project` (optional, scopes to `project:<name>` + `global`);
`--k` (optional, default 5).

**Output (stdout JSON):**
```json
{ "hits": [
  { "id": "lsn_x", "scope": "global", "claim": "WHEN … → DO … BECAUSE …",
    "keywordRank": 1, "semanticRank": 3, "rrfScore": 0.0317, "expand_when": "…" }
] }
```

**Contract guarantees:**
- Precondition-gated atoms never appear in `hits` (even if semantically near).
- Embedder unavailable ⇒ `semanticRank: null` for all hits, still returns keyword hits, **no error**.
- Reads atoms directly from disk (survives MCP server down).
- Never throws; on any internal error prints `{ "hits": [] }` and exits 0.
- Global-scope lessons eligible regardless of `--project` (cross-project transfer).

## C2 — Hook: `MemRecall.hook.ts` (NEW) — UserPromptSubmit

**Trigger:** every `UserPromptSubmit`.

**Behavior (AS BUILT):** resolve active project → IN-PROCESS hybrid recall (`recall()` + host
`ScoreProvider`, K=5) → inject hits. (Cross-system dedup vs MemoryRecall was DEFERRED — decision C+;
MemRecall injects independently. See spec.md Item 2.)

**Output (stdout JSON):**
```json
{ "additionalContext": "<memcarry-recall>\n- WHEN … → DO … BECAUSE …\n</memcarry-recall>" }
```

**Contract guarantees:**
- Fires on 2nd, 3rd, … prompts (not just first — that's `MemDrift`'s read-once job). ✅
- ~~Suppresses any hit already surfaced by MemoryRecall this turn (dedup).~~ DEFERRED (C+).
- MemCarry recall capped at K=5; HEADs ≤ `CLAIM_DISPLAY_CAP`. ✅
- No network, no probes, no blocking; query-embed only (cached model). 
- CLI/store unavailable ⇒ emits nothing (`{}` or empty `additionalContext`), exit 0.

## C3 — Hook: `MemCompact.hook.ts` (NEW) — PostCompact

**Trigger:** after window compaction (pattern from PAI `PostCompactRecovery`).

**Behavior:** `memcarry resume <project>` (cached cursor, no probes) + recall hits for the last prompt
→ dedup → re-inject, annotated as recovered.

**Output (stdout JSON):**
```json
{ "additionalContext": "<memcarry-recovered>\nresume cursor + lessons re-surfaced after compaction\n…</memcarry-recovered>" }
```

**Contract guarantees:**
- Re-injects **cached** cursor only — no fresh verify probes (no-block rule).
- Dedups against what `MemRecall` already injected this turn (shared `dedup-inject.ts`).
- No active resume-state / CLI down ⇒ emits nothing, exit 0.

## C4 — Hook: `MemResume.hook.ts` (MODIFIED) — SessionStart

**Change:** the resume cursor's `next` now reflects the active PRD's next-action when a PRD exists
(via `capture.ts` → `prd-read.ts`); mechanical `[CONFIRM] continue work` otherwise.

**Contract guarantees (additive):**
- Active PRD present ⇒ `next` = PRD STATUS next-action / first unchecked ISC item.
- No PRD ⇒ behavior unchanged (mechanical fallback).
- **No new LLM inference** on the SessionStart path (latency-safe, finding #3).
- Async-detach verify behavior unchanged (still returns immediately).

## Unchanged surfaces (regression guard)

- `memcarry resume | drift | capture | duplicates | write | confirm | health` — signatures unchanged
  (recall is the only modified command; capture's output gains a PRD-derived `next` but same shape).
- `MemDrift.hook.ts`, `MemCapture.hook.ts` — unchanged.
- MCP server tools — untouched this sprint.
- Existing 25 tests must still pass.
