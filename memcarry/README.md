# Memory Core (name pending — placeholder scope `@mem`, binary `mem`)

Model-agnostic memory + resumption layer. Standalone core repo; a thin Claude adapter lives in KAI.
See `../ARCHITECTURE.md` (design), `../PLAN.md` (roadmap), `../PHASE-MINUS-1-FINDINGS.md` (de-risk).

> **NAME PLACEHOLDER.** `@mem/` scope and `mem` binary are placeholders pending the final name.
> Rename: `grep -rl '@mem/'` for package refs; the bin is in `package.json`.

## Layout
```
packages/lib   shared library — SOLE behavior source (schema, store, transcript parser, probes)
packages/cli   `mem` binary — what HOOKS shell out to (hooks CANNOT call MCP tools)
packages/mcp   MCP server — what the MODEL calls mid-turn
store/atoms/   git-tracked markdown atoms — SOLE source of truth
index/         gitignored, rebuildable cache (not yet populated)
fixtures/      dev script generating proof atoms
```

## Phase 0 status: COMPLETE
- 2-type schema (`lesson`, `resume-state`), WHEN→DO→BECAUSE claim, provenance trust tiers,
  verified/unverified split, (project,worktree/branch) origin keying, `also_touched` (F3).
- Markdown store: atomic write (temp+rename), defensive parse, round-trip tested.
- Transcript parser: F1 session gate, F2 defensive parse, F3 multi-repo spread.
- 3-state probe layer (VERIFIED/DRIFTED/INDETERMINATE), no shell interpolation, validated args,
  explicit `-C`/`--repo` — verified LIVE against real git/gh/ping.
- 14 unit tests pass; MCP stdio handshake works; fixtures generate the duplicate-killing global lesson.

## Run
```bash
bun install
bun test
bun run fixtures/make-fixtures.ts     # generate proof atoms
bun run packages/cli/src/index.ts health
bun run packages/cli/src/index.ts resume feed-bbf
```
