# ADA Native-First — Historical Design Note
> **Status:** SUPERSEDED FOR GROUP A · created 2026-06-20 · reconciled 2026-06-23
> **Current source of truth:** `ada-build-spec.md` for ADA Group A implementation.
> This document remains useful as the rationale for using Claude-native `CLAUDE.local.md` imports,
> keeping packs outside MEMORY, and avoiding unnecessary self-feeding machinery. It no longer
> supersedes the REGISTRY/generator path.
> **Trigger:** post-rev-2 review against live Claude Code docs (v2.1.183 confirmed). Three findings
> changed the build plan.

---

## What changed after the doc audit

ADA rev 2 was designed correctly but before a full read of the current Claude Code memory docs.
Three live Claude Code features materially change what needs to be built:

### Finding 1 — Auto Memory is on by default (v2.1.59+)

> **⚠️ CORRECTION (2026-06-21):** The "Dreams / AutoDream" claim below is **WRONG** — there is NO
> native idle-period consolidation pipeline in Claude Code (verified absent from docs/changelog;
> claude-code-guide pass 2026-06-21). The consolidation behavior WARP described is **PAI's OWN**
> (InstinctCapture, MemoryCurate). Native Auto Memory *captures* notes but does **not**
> consolidate/dedup/resolve contradictions. **Consequence: phase 1b is only PARTIALLY redundant**
> (native covers capture, not consolidation) — do not retire it wholesale. See
> `project_auto_memory_interaction.md` + the handoff's "WARP's 3rd review" section. The original
> (now-disproven) text is preserved below for the record.

Claude Code automatically writes session learnings to `~/.claude/projects/<repo-hash>/memory/MEMORY.md`
and loads the first 200 lines / 25 KB at every session start. The **Dreams / AutoDream** pipeline
consolidates this during idle periods: merges duplicates, resolves contradictions, surfaces new
patterns from transcripts. This is exactly what ADA rev 2's phase 1b self-feeding loop was going
to build manually (End skill + `/ada-capture` → REGISTRY → regenerate pack).

**Impact:** phase 1b is redundant. Auto Memory already closes the correction→ambient loop
natively, with better consolidation logic than we would build. The task is to *configure* Auto
Memory correctly, not rebuild it.

### Finding 2 — CLAUDE.local.md is fully documented and confirmed working

The `CLAUDE.local.md` + `@~/...` import mechanism is in Anthropic's official docs with exactly
the semantics ADA rev 2 assumed: loads alongside `CLAUDE.md` on the cwd→root walk, treated
identically, supports absolute `@~/.../` imports, survives compaction. No ambiguity remains.

**Impact:** T1 mechanism is confirmed ★★★. No research risk.

### Finding 3 — Generator pipeline solves a scale problem we don't have

ADA rev 2's REGISTRY + generator + drift gate + CI pipeline is correct for a team with
20+ repos drifting across developers. The current situation: **one developer, 5–6 repos**.
Writing pack files by hand takes an afternoon. The infrastructure to prevent drift is more
complex than the thing it's protecting.

**Impact:** ship the packs by hand first. If scale demands a generator in 3–6 months, build
it then with real shape data from the hand-written packs.

---

## 2026-06-23 reconciliation

The native-first review was directionally useful but over-corrected. It assumed hand-maintained packs
were enough because the installation was one developer / a small repo set. The later build spec
restored the generator path for two concrete reasons:

1. **Branch/procedure facts are already centralized in `PAI/USER/PROJECTS/REGISTRY.md`.** Hand-written
   packs would duplicate the exact high-risk facts ADA is meant to make reliable: default branches,
   check-in procedure, repo resources, and gotchas.
2. **The first adopter repos have expensive wrong-branch failure modes.** `feed_bbf` and
   `feed_linksys` need repeatable T1 packs and T2 procedure configs, not memory-only convention.

Resolved model:
- **Keep from native-first:** use Claude's native `CLAUDE.local.md` import mechanism; keep packs in
  `~/.claude/ada/` outside MEMORY; do not build a self-feeding loop in Group A.
- **Use from build spec:** REGISTRY schema rows, parser, generator, budget cap, `--check` drift gate,
  and procedure config generation.
- **Defer:** Auto Memory/KAI redundancy audit remains valuable, but it is not part of ADA Group A.

## Original revised design: native-first

Same three tiers as ADA rev 2. The mechanisms are unchanged. Only the implementation path changes.

### T1 — Repo Context Pack (simplified)

**What ADA rev 2 said:** generate packs from REGISTRY into `~/.claude/ada/packs/<repo>.md` via
a generator script with a drift gate in CI.

**What to do instead:**

1. Write the pack files by hand, one per repo. Start with the 3 most-used:
   `feed_bbf.md`, `feed_linksys.md`, `kai.md`. Add others as needed.

   Pack content per file (keep under 120 lines, per ADA rev 2's budget cap):
   - Default branch (e.g., `usp_ui`, `sysevent_integration`, `main`)
   - Naming conventions (e.g., feed event names, commit message format)
   - Checkin procedure (branch target, pre-push gates, PR template)
   - Known gotchas (e.g., "never push to `sysevent_integration` directly")
   - Wiki / MCP resource pointers

2. Add `CLAUDE.local.md` to `~/.gitignore_global` — one command, done for all repos forever.

3. Drop a `CLAUDE.local.md` in each repo root containing one line:
   `@~/.claude/ada/packs/<repo>.md`

4. Verify with `/memory` that the pack content appears in the loaded context.

**Editing packs:** edit `~/.claude/ada/packs/<repo>.md` directly. No regeneration step.
**Drift:** if a pack gets stale, Claude corrects you and you update the file. That's the
  right feedback loop at current scale.
**Upgrade path:** if you add a 10th repo and start feeling pain, add the generator then.
  The pack format will be proven by real use before you automate it.

### T2 — Procedure Cards (unchanged from rev 2)

**Mechanism:** extend `GitHubWriteGuard.hook.ts` (not a new hook) to inject the repo's
checkin procedure checklist as context before `git commit` / `git push` / PR-create.
Hard rules (wrong branch pushes) use `{ "decision": "block", "message": "..." }`.

This is not simplified — it's a genuine hook build. But it's well-scoped:
- Single file change to an existing hook
- Pack files (T1) already contain the procedure content to inject
- GitHubWriteGuard already has the PreToolUse trigger wired

**Sequence:** T1 pack files must exist first (they're the content source for T2).

### T3 — On-demand Domain Knowledge (unchanged from rev 2)

Targeted branch change in `LocalContextFirst.hook.ts`: when the domain-match branch fires
(lines ~96–110), run the same `semanticFallback()` call that the `isKnowledgeExploration()`
branch already uses and inject the retrieved **content**, not the pointer hint.
10–15 line change. Do this in Group B.

### Self-feeding loop — REPLACED by Auto Memory configuration

**Do not build phase 1b.** Instead:

1. Confirm Auto Memory is active: run `/memory` and check that auto memory is enabled.
   (It should be — v2.1.183 is well above the v2.1.59 requirement.)

2. When Claude makes the same mistake twice or you correct a procedure, say:
   *"Remember this for future sessions"* — Claude writes it to Auto Memory.

3. Auto Dream consolidates overnight. By the next session, the correction is ambient.

4. For high-value learnings you want to make permanent and explicit, move them from
   Auto Memory into the appropriate pack file (`~/.claude/ada/packs/<repo>.md`). This is
   the manual promotion path — only for things you've confirmed are durable and repo-specific.

The correction→ambient loop now has two layers:
- **Auto Memory** (low-friction, automatic, session-scoped learnings)
- **Pack files** (curated, durable, repo-scoped conventions)

---

## KAI redundancy audit (new recommendation)

KAI was built when Claude Code had no native memory persistence. Auto Memory (v2.1.59+) now
covers a significant portion of what KAI's memory pipeline does manually. Before building more
memory infrastructure, audit which hooks are now redundant or duplicating native behavior.

**Candidates to investigate:**

| Hook / component | Potential overlap with native |
|---|---|
| `MemResume.hook.ts` | Auto Memory loads at session start natively |
| `MemoryRecall.hook.ts` | Auto Memory topic files load on demand natively |
| Memory scoring / `memory-scorer.ts` | Dreams pipeline consolidates and de-dupes natively |
| `PostCompactRecovery.hook.ts` | CLAUDE.md files re-inject at compaction natively |
| KAI memory capture pipeline | Auto Memory write path is native |

**How to audit:** for each candidate, run a session with the hook disabled and compare
behavior. If the native behavior is equivalent or better, retire the hook. This is not
a blocker for ADA — do it as a separate session, probably alongside 7.5.0 or 7.6.0.

**Expected outcome:** if even 3–4 hooks can be retired, KAI's process-spawn count drops
meaningfully (currently flagged as a v6.3 target in the roadmap).

---

## Original implementation order

Superseded by `ada-build-spec.md` Group A. Preserved for historical context.

**Group A — one-time setup (afternoon):**
- Add `CLAUDE.local.md` to `~/.gitignore_global`
- Write pack files for feed_bbf, feed_linksys, kai
- Drop `CLAUDE.local.md` in each repo
- Verify with `/memory` that packs load
- Confirm Auto Memory is active

**Group B — hook work:**
- Extend `GitHubWriteGuard.hook.ts` with procedure injection from pack content
- Fix `LocalContextFirst` domain-match branch (T3)
- Wrap both with `.catch()` per the KAI hook hygiene standard

**Group C — later, when needed:**
- Add packs for remaining repos as you work in them
- Generator + drift gate *if and when* manual maintenance becomes painful
- KAI redundancy audit (separate session)

---

## What this changes from ADA rev 2

| ADA rev 2 item | Native-first decision |
|---|---|
| REGISTRY schema extension | Deferred — packs are hand-maintained |
| Generator script | Deferred — ship packs by hand first |
| Drift gate + CI test | Deferred — not needed at current scale |
| Self-feeding loop (phase 1b) | **Replaced** by Auto Memory (already native) |
| T1 CLAUDE.local.md + @import | **Unchanged** — confirmed ★★★ by official docs |
| T2 GitHubWriteGuard extension | **Unchanged** — still the right build |
| T3 LocalContextFirst branch fix | **Unchanged** — still the right fix |
| T4 operational/environment state | **Unchanged** — deferred to phase 2 |

ADA rev 2 remains the authoritative design for the long-term architecture. This doc
describes the *first cut* — what ships before the generator pipeline exists.

---

## Risks

- **Pack files drift without a gate** — acceptable at 5–6 repos. If a pack gets wrong,
  Claude's corrections surface it. Add a gate when the number of repos makes manual
  review impractical.
- **Auto Memory topic files grow beyond 200-line MEMORY.md limit** — monitor with `/memory`.
  Prune entries that are captured in pack files to avoid duplication. The Dreams pipeline
  consolidates but doesn't enforce a budget.
- **Auto Memory writes something wrong** — Auto Memory is ★★ (Claude decides what to save,
  may be inaccurate). Review `MEMORY.md` periodically; wrong entries are worse than absent
  ones. Run `/memory` and edit the file to remove stale content.
- **T2 procedure injection conflicts with GitHubWriteGuard's existing approval-hash flow** —
  the extension must inject context before the approval prompt, not instead of it. Test in
  a non-critical repo first.
