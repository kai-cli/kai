# ADA + Auto Memory — Session Handoff (2026-06-19, evening)

> **Resume in the morning from here.** This captures everything from the WARP reviews + the
> claude-code-guide verification + filesystem investigation. Two decisions are already made (below);
> one investigation is half-done (Auto Memory ↔ PAI) and is the first thing to finish.

## TL;DR — where we are

We designed **Ambient Domain Activation (ADA)** to kill the #1 pain: re-teaching Claude repo
conventions, branch targets, and check-in procedures every session. Design doc + roadmap entry are
written and revised twice. Then WARP's 3rd review surfaced a **native Claude Code feature we'd
missed (Auto Memory)** that changes scope. We validated WARP's claims, made two decisions, and
started investigating a live interaction — then paused for sleep.

**Nothing is committed.** All edits are local in `~/Projects/kai` on `main`.

## The artifacts (all written, uncommitted)

- **Design doc:** `docs/planning/ambient-domain-activation-design.md` (rev 2, ~15KB)
- **Roadmap:** `docs/planning/ROADMAP-7.x.md` — ADA is the **lead theme of 7.4.0**
- **Memory:** `~/.claude/projects/-Users-your-name-Projects-kai/memory/project_ambient_domain_activation.md`
- **This handoff:** `docs/planning/ada-session-handoff-2026-06-19.md`

## The design (validated feasible, rev 2)

ADA = push repo/domain context instead of pull. Three tiers:
- **T1 — Repo context pack:** pack content in `~/.claude/ada/packs/<repo>.md`; each repo gets a
  **gitignored `CLAUDE.local.md`** containing only `@~/.claude/ada/packs/<repo>.md`. Auto-loads on
  Claude Code's cwd→root walk, survives compaction, reaches Agent subagents natively. **Leak-proof**
  for company (`yourcompany/*`) + public (`kai`) repos. ★★★ verified.
- **T2 — Procedure cards:** **extend existing `GitHubWriteGuard.hook.ts`** (already PreToolUse on
  git commit/push/PR — do NOT add a 2nd hook). Inject repo checklist before the command; block
  wrong-branch pushes via `{ "decision": "block", "message": ... }` (verified in-codebase format —
  NOT `permissionDecision: "deny"`). ★★★.
- **T3 — On-demand domain knowledge:** targeted fix to `LocalContextFirst.hook.ts` — the
  domain-match branch (~lines 96-110) emits a pointer; make it inject retrieved content like the
  `isKnowledgeExploration` branch already does (Feature C). ~10-line change. ★★.

## DECISIONS MADE THIS SESSION (don't re-litigate)

1. **Hand-write the 5-6 pack files; do NOT build the generator/drift-gate/CI pipeline yet.**
   WARP correctly turned our own premortem against us: REGISTRY→generator→drift-gate is
   over-engineered for ~5-6 repos + one developer. The 5-6 hand-written packs ARE the single source
   until scale demands a generator. Generator → backlog item "build when scale demands."
   First cut = half-day: hand-write packs + gitignore `CLAUDE.local.md` globally + drop pointers +
   extend GitHubWriteGuard + T3 branch fix. Solves ~80% immediately, zero pipeline.

2. **Investigate the Auto Memory ↔ PAI interaction BEFORE building ADA.** (Half-done — see below.)

3. **T4 (operational/environment state — device locations, "why isn't the home router connected")
   stays deferred to phase 2.** It's operational STATE (devices.json + router-mcp), not repo-domain.

4. **Scope = all projects** (not a single pilot) — ADA must be felt everywhere.

## WARP's 3rd review — VALIDATED (accept core, reject 2 overreaches)

**✅ ACCURATE — and important:**
- **Auto Memory is a REAL native Claude Code feature.** v2.1.59+, **on by default**, and we are
  running **2.1.183 with it unset = ON**. It auto-loads first 200 lines / 25KB of
  `~/.claude/projects/<hash>/memory/MEMORY.md` at session start **with no hook required**. Path,
  version, default-on all confirmed against official docs (https://code.claude.com/docs/en/memory.md).
  Can be disabled via `autoMemoryEnabled: false` or `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`; dir
  override via `autoMemoryDirectory`.
- **The generator pipeline is over-engineered for current scale** — accepted (decision 1).
- **T1/T2/T3 feasibility** — matches our own verification.

**❌ WRONG — one specific claim:**
- **"Dreams / AutoDream" idle-period consolidation pipeline does NOT exist** in native Claude Code.
  Not in docs, changelog, or commands. The "merges duplicates, resolves contradictions, surfaces
  patterns from transcripts" behavior WARP described is **PAI's OWN hand-built consolidation**
  (InstinctCapture, MemoryCurate, etc.) — WARP mis-attributed a custom framework feature to native.
- **Consequence:** WARP's "skip phase 1b, Auto Memory does it for free" is **overstated**. Native
  Auto Memory *captures* notes; it does NOT consolidate/dedup/resolve contradictions. So phase 1b is
  only *partially* redundant (with native capture), not fully. Capture ≠ consolidation.

**⚠️ WARP's "audit which of PAI's 51 hooks / 325 memories are redundant" idea:**
- Legitimate and overdue — BUT this is the **rayhunter failure class** (see
  `project_rayhunter_memory_loss.md` + the memory-safety steering rules). Judging memory/hooks
  "redundant" and removing them is exactly how 9 days of work was lost. Auto Memory captures going
  FORWARD; it does NOT retroactively hold the 325 curated memories or the cross-project recall /
  instinct / PRD-resume logic. **Do the audit additively + measured by telemetry — NEVER as a
  deletion pass.**

## INVESTIGATION IN PROGRESS — Auto Memory ↔ PAI collision (FINISH THIS FIRST in the morning)

**The concern:** native Auto Memory WRITES to `~/.claude/projects/<hash>/memory/MEMORY.md` — the
**exact same path** PAI hooks (`memory-disclosure.ts`, `LoadContext`, `MemoryRecall`) treat as
**read-only / user-curated**. PAI never writes MEMORY.md directly (confirmed: no
`writeFileSync/appendFileSync` to MEMORY.md in any hook). So if native is ON, Claude Code itself may
be writing a file PAI assumes only the human curates — two writers' assumptions on one file.

**Evidence gathered so far (2026-06-19 eve):**
- Native Auto Memory: **no `autoMemoryEnabled`/`autoMemoryDirectory` override** in
  `~/.claude/settings.json` → running at native default = **ON**, native default directory.
- All current files in `projects/*/memory/` follow **PAI naming** (`project_`/`feedback_`/
  `reference_`/`user_` prefixes + curated `MEMORY.md` index). **No native-authored topic files
  detected** (no non-PAI-pattern filenames found).
- The kai memory dir is **git-untracked** in this checkout (interesting — the memory lives in
  the project-encoded path, separately managed).

**UNRESOLVED — the key open question to answer in the morning:**
1. **Does native Auto Memory's default directory actually COINCIDE with PAI's
   `~/.claude/projects/<hash>/memory/`, or is the native default a DIFFERENT path?** This is THE
   crux. If different paths → no collision, they're parallel systems (and we should pick one). If
   same path → live two-writer interaction to resolve. Verify via official docs' stated default for
   `autoMemoryDirectory` + check for any native-written files appearing over the next sessions.
2. Has native Auto Memory written ANYTHING yet? (So far no native-pattern files seen — possibly
   because PAI's curated files dominate, or because the default dir differs, or because it writes
   only on explicit corrections.) Run `/memory` to see what Claude Code itself reports as loaded +
   whether auto memory is on and where its folder is.
3. **Integrate vs disable decision:** once path question is answered —
   - If same path: decide whether PAI should (a) embrace native Auto Memory as the capture layer and
     retire phase 1b, keeping PAI only for consolidation/recall/cross-project; or (b) set
     `autoMemoryDirectory` to a separate path so the two don't collide; or (c) disable native and
     keep PAI authoritative.
   - This decision likely reshapes more than ADA — it touches the whole memory stack and the
     "redundant hooks audit."

**Fastest way to resolve #1 in the morning:** ask claude-code-guide for the EXACT native default
`autoMemoryDirectory` value (the docs state it), and run `/memory` live to see the reported folder.

## SUGGESTED MORNING SEQUENCE

1. **Finish the Auto Memory investigation** (questions 1-3 above) — run `/memory`, confirm native
   default dir vs PAI path. This gates everything.
2. **Decide integrate-vs-disable** for Auto Memory (may spawn a separate roadmap item + the careful
   additive hooks audit).
3. **Update the ADA design doc** to reflect: generator → backlog (decision 1); phase-1b corrected
   (native capture exists but not consolidation); Auto Memory interaction noted.
4. **Then build ADA phase 1** (hand-written, half-day): packs + pointers + GitHubWriteGuard ext + T3.
5. Branch + commit the docs (we're on `main`; branch first).

## Key file:line references (verified this session)

- `GitHubWriteGuard.hook.ts` — already PreToolUse on git commit/push/PR (T2 extends this)
- `LocalContextFirst.hook.ts` ~96-110 = domain-match branch (pointer-only, the T3 defect);
  ~112-140 = `isKnowledgeExploration` branch (already injects content — the model to copy)
- `hooks/lib/memory-disclosure.ts:83` `loadIndexMemory` — PAI's read of MEMORY.md (read-only)
- Block format: `DeviceAuthReminder.hook.ts:82` / `ConfigChange.hook.ts:17` → `{decision:"block",message/reason}`
- `core.excludesfile` = `~/.gitignore_global` (already set; `CLAUDE.local.md` NOT yet added there)
- Claude Code version: **2.1.183**; Auto Memory requires 2.1.59+
