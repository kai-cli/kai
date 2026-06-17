# Quickstart — Validating the Retrieval Sprint

End-to-end validation scenarios that prove the four items work. Run from the MemCarry core repo.
See `contracts/cli-and-hooks.md` for interface details and `data-model.md` for structures.

## Prerequisites

```bash
cd ~/Projects/kai/memcarry          # LIVE canonical (NOT NewTool/core — tombstoned)
bun install
export MEMCARRY_STORE="$HOME/.claude/MEMORY/memcarry/store"   # live store (6 atoms)
bun test                                                       # baseline: 35 tests green
```

## Scenario 1 — Hybrid recall surfaces a semantic-only match (Item 1 / B2)

**Proves:** semantic leg works; keyword-only would miss this.

1. Ensure a lesson exists whose claim is about a topic using *different words* than the query
   (e.g. lesson about "regenerate patches via quilt"; query about "fixing a diff file").
2. `bun run packages/cli/src/index.ts recall "how do I fix a broken diff file"`
3. **Expect:** the patch/quilt lesson appears in `hits` with `semanticRank` set, even though it shares
   no literal keyword with "diff file". `rrfScore` > 0.

## Scenario 2 — Degraded mode: embedder off, keyword still works (Item 1)

**Proves:** silent degradation (finding #2).

1. Force the embedder unavailable (e.g. `MEMCARRY_DISABLE_EMBED=1` or rename the model cache).
2. `bun run packages/cli/src/index.ts recall "patch quilt overlay"`
3. **Expect:** keyword hits still returned, every hit has `semanticRank: null`, **no error**, exit 0.

## Scenario 3 — Index rebuilds on new atom, no manual reindex (Item 1)

**Proves:** cache is rebuild-on-miss, atom-keyed (finding #13).

1. Write a new lesson atom (`memcarry write <atom.json>`).
2. Immediately `recall` with a prompt matching it.
3. **Expect:** the new atom is found on the first recall (its vector was embedded write-through);
   `index/` contains a gitignored entry; no manual reindex step was run.

## Scenario 4 — Precondition gate beats semantic score (Item 1)

**Proves:** wrong-moment injection stays fixed (finding #12).

1. Pick a lesson with a narrow `when` (e.g. "editing an existing .patch file").
2. Recall with a prompt that's *semantically near* but whose precondition doesn't hold
   (e.g. "tell me about patch management strategy").
3. **Expect:** that lesson is **excluded** from `hits` despite semantic nearness.

## Scenario 5 — Ambient recall on every prompt (Item 2 / A2)

**Proves:** surfacing isn't first-prompt-only.

1. Simulate `MemRecall.hook.ts` with a UserPromptSubmit payload on the **2nd/3rd** prompt of a session
   (feed hook stdin JSON, as the existing adapter tests do).
2. **Expect:** `additionalContext` contains a `<memcarry-recall>` block with a relevant lesson — on a
   non-first prompt.

## Scenario 6 — Injection dedup vs MemoryRecall (Item 2)

**Proves:** no double-injection.

1. Arrange the same source content to be surfaceable by both PAI MemoryRecall and MemCarry this turn.
2. Run the MemRecall hook with the MemoryRecall injection record present.
3. **Expect:** the shared content appears **once** (MemCarry suppresses its copy by source-path/hash).

## Scenario 7 — Warm cold-start from PRD (Item 3 / B1)

**Proves:** resume reads the real next-action.

1. With an active PAI PRD (`STATE/work.json` → a `WORK/*/PRD.md` with a STATUS next-action / unchecked ISC):
   `bun run packages/cli/src/index.ts resume <project>` (via the modified path).
2. **Expect:** the resume cursor `next` is the PRD's next-action, **not** `[CONFIRM] continue work`.
3. Repeat with **no** active PRD → **Expect:** mechanical fallback unchanged. No LLM call on this path.

## Scenario 8 — Memory survives compaction (Item 4 / H2)

**Proves:** mid-session context isn't lost.

1. Simulate `MemCompact.hook.ts` with a post-compaction payload, an active resume-state present.
2. **Expect:** `additionalContext` re-injects the cached cursor + relevant lessons as
   `<memcarry-recovered>`; nothing double-injected that `MemRecall` already showed this turn; no probes run.

## Regression gate

```bash
bun test    # all existing 35 + new unit tests green
```
- `memcarry resume | drift | capture | duplicates | write | confirm | health` unchanged.
- `MemDrift` / `MemCapture` hooks unchanged.
- No writes to the 269-file PAI store; MemCarry store separate (run-alongside rule).

## Definition of Done

All 8 scenarios pass + regression gate green + `index/` gitignored + zero added latency on the
UserPromptSubmit path (recall reads disk + cache only).
