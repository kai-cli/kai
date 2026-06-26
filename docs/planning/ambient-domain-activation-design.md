# Ambient Domain Activation (ADA) — Design

> **Status:** DRAFT design · created 2026-06-19 · **rev 2** 2026-06-19 (holistic review + WARP +
> claude-code-guide pass 2) · target release: 7.4.0 lead theme (see ROADMAP-7.x.md)
> **Problem owner:** YourName · **Pain rank:** #1 stated pain point as of 2026-06-19.
> **Scope:** felt across ALL projects (not a single pilot). Operational/environment state (device
> locations, live router status) is **explicitly deferred to phase 2** — see "Deferred (phase 2)".

**Rev-2 changelog** (what the review changed): T1 mechanism is now **gitignored `CLAUDE.local.md`
that `@import`s a single REGISTRY-generated pack** — leak-proof for company/public repos, removes
the old "can't commit" fallback contradiction. T2 hook output corrected to `{ decision: "block",
message }` (was a wrong `permissionDecision: "deny"`). T3 re-scoped to a **targeted branch change**
in `LocalContextFirst` (the domain-match branch), not a rewrite. Self-feeding loop is now
**human-confirmed**, not auto-detected. Added token-budget + REGISTRY-scalability risks. Corrected
the subagent claim (Agent subagents DO load CLAUDE.md/.local.md; only Explore/Plan + SDK/background
skip it).

## The Problem (in the user's words)

> "The biggest issue I have is explaining or retraining Claude how to do things — where the
> devices are, why the home router isn't connected, how to handle GitHub workflows. It's about
> the **precision of doing stuff on a routine basis** that seems to be missing… If I work in
> repo `feed_bbf` then the YourCompany repo should **know the naming conventions and protocols** for
> working in a YourCompany repo. I shouldn't have to make it re-check the wiki for that information —
> it should be **loaded when I tell it that's what we're doing, or when it understands that's
> what we're doing**… I also want to see **how much we can make automatic**. I don't want to
> tell it remember the steps for checking in code and other things."

Two failure classes, one root cause:

- **(A) Recurring operational facts** re-taught every session (device locations, home-router
  state, GitHub workflow conventions).
- **(B) Domain-context activation** — entering a repo/domain should auto-load its conventions,
  branch targets, protocols, and procedures *without re-checking the wiki*.

**Root cause:** activation is **PULL** (Claude must choose to load context) and **advisory**
(`LocalContextFirst` injects *"check local sources before web research"* — a nudge to go fetch —
instead of loading the actual content). The pain demands **PUSH**: context activates from
detected domain/intent. The knowledge already exists (REGISTRY.md, domains.jsonc, the wiki,
embeddings, 325 memory files); it is not *routed* and not *pushed*.

## Feasibility (verified against Claude Code design, 2026-06-19)

Verified via claude-code-guide against official Claude Code docs (2 passes). Summary:

**Reliability legend:** ★★★ = synchronous / guaranteed-loaded (native or pre-execution hook) ·
★★ = best-effort, may decay under compaction · ★ = model-dependent heuristic, not guaranteed.

| Mechanism | Feasibility | Channel | Reliability |
|-----------|-------------|---------|-------------|
| Project `CLAUDE.md` / `.claude/CLAUDE.md` / `CLAUDE.local.md` auto-load (walks cwd→root, concatenated, survives compaction) | ✅ FEASIBLE | native memory | ★★★ best push channel |
| `CLAUDE.local.md` = documented gitignored personal variant; `@import` resolves absolute/external paths (e.g. `@~/.claude/...`) | ✅ FEASIBLE | native memory | ★★★ leak-proof pointer |
| `PreToolUse` hook on `Bash(git commit/push)` injecting procedure + can block | ✅ FEASIBLE | hook | ★★★ synchronous, enforceable |
| `SessionStart` repo detection (read cwd / CLAUDE_PROJECT_DIR) + inject | ✅ FEASIBLE | hook | ★★★ once-per-session |
| Skill auto-invocation by "USE WHEN" heuristics | ⚠️ PARTIAL | model heuristic | ★ best-effort, not guaranteed — use hooks for mandatory |
| `UserPromptSubmit` `additionalContext` every turn (ambient) | ⚠️ PARTIAL | hook | ★★ decays under compaction; OK for short metadata, not heavy knowledge |
| **Agent-spawned subagents loading project CLAUDE.md/.local.md** | ✅ FEASIBLE | native memory | ★★★ — **except Explore/Plan** (skip CLAUDE.md by design) and SDK/background agents |

**Three design-shaping constraints:**
1. Heavy domain knowledge belongs in a project-local CLAUDE-family file (auto-loads, survives
   compaction), NOT in per-turn `additionalContext` (fragile, decays under compaction).
2. The pack file lives in a **gitignored `CLAUDE.local.md`** because the targets are company-owned
   (`yourcompany/*`) and public (`kai`) repos — a committed `CLAUDE.md` would push personal AI config
   into shared/public trees. `CLAUDE.local.md` auto-loads identically but is never committed.
3. **Most subagents DO reach the pack natively** (Agent-spawned load CLAUDE.local.md). The only gap
   is Explore/Plan (skip CLAUDE.md by design) + SDK/background agents — those need delegation-prompt
   injection (the residual 7.5.0 dependency, now much smaller than first thought).

**Hook output format (verified in-codebase — use this, not the docs' generic form):** blocking
hooks emit `{ "decision": "block", "message": "..." }` (or `"reason"`), confirmed in
`DeviceAuthReminder.hook.ts` / `ConfigChange.hook.ts`. There is **no** `permissionDecision: "deny"`
field in this codebase — do not use it.

## The Design: three tiers, one source of truth

All three tiers are **fed from `REGISTRY.md`** as the single source. The per-repo packs are
**generated**, never hand-maintained — this is what prevents the "duplicated logic drifts" class
the project has already killed three times (counts, PII patterns, sync excludes).

### T1 — Repo Context Pack  → solves "feed_bbf should know its conventions"
- **Mechanism (rev 2 — leak-proof by construction):**
  1. The pack *content* is **generated from REGISTRY into a single place under PAI control**:
     `~/.claude/ada/packs/<repo>.md` (branch target e.g. feed_bbf → `usp_ui`, feed_yourcompany →
     `sysevent_integration`; naming conventions, protocols, wiki/MCP pointers, known gotchas).
  2. Each repo gets a **one-line gitignored `CLAUDE.local.md`** at its root containing only:
     `@~/.claude/ada/packs/<repo>.md`. Claude Code auto-loads `CLAUDE.local.md` on the cwd→root
     walk and resolves the `@import` (absolute/external paths are supported).
  3. `CLAUDE.local.md` is added **once** to the global excludes (`~/.gitignore_global`, already
     configured via `core.excludesfile`) so it is ignored in *every* repo with no per-repo
     `.gitignore` edits — fits the "felt across all projects" scope.
- **Why this shape:** zero pack content ever enters a company/public repo tree; even if a
  `CLAUDE.local.md` were accidentally committed, it contains only a `@~/.claude/...` path that does
  not exist on anyone else's machine → no conventions leak (defense in depth). REGISTRY stays the
  single source; the repo file is a dumb pointer.
- **Subagent reach:** Agent-spawned subagents load `CLAUDE.local.md` natively (so the pack reaches
  them); Explore/Plan and SDK/background agents do not — covered by delegation injection (Group C).
- **Reliability:** ★★★ — auto-loads every session in that cwd, survives compaction.

### T2 — Procedure Cards  → solves "don't re-teach me code check-in steps"
- **Mechanism:** **extend the existing `GitHubWriteGuard.hook.ts`** (which already fires PreToolUse
  on `git commit`/`git push`/PR-create with an approval flow) — do **NOT** add a second PreToolUse
  hook on the same commands (that would double-prompt and race the approval-hash flow). The
  extension injects that repo's checklist from its pack (correct target branch, git identity,
  commit-message conventions, pre-push gates) as the context shown before the command runs.
- **Hard rules** (e.g. push to a protected branch like `sysevent_integration`) emit
  `{ "decision": "block", "message": "<reason + correct branch>" }` — the verified in-codebase
  block format. **No** `permissionDecision: "deny"`.
- **Reliability:** ★★★ — synchronous, enforceable. This is the "automatic" the user asked for:
  the steps fire from the *action*, not from being re-taught.

### T3 — On-demand Domain Knowledge  → solves "shouldn't have to re-check the wiki"
- **Mechanism (rev 2 — targeted branch change, NOT a rewrite):** `LocalContextFirst.hook.ts`
  already injects retrieved *content* on its `isKnowledgeExploration()` branch (Feature C, lines
  ~112-140). The defect is only the **domain-match branch** (~lines 96-110), which still emits a
  *pointer hint* ("check local knowledge sources"). The fix: when domains match, run the same
  semantic retrieval the exploration branch uses and inject the **content**, not the pointer.
- **Reliability:** ★★ — per-turn injection; best for the long-tail topics not worth a permanent
  pack. Subject to the context budget (see premortem).

### Supporting workstreams (already on the roadmap, now explicitly in ADA's service)
- **Telemetry (7.4.0 §1):** measure activation hit-rate + "re-teach" events so we can *prove* the
  pain dropped, not guess. Without this we cannot validate ADA worked (the rayhunter-invisibility
  lesson).
- **Agent harvesting + delegation injection (7.4.0 §2 / 7.5.0):** carry packs into the subagents
  that don't load CLAUDE.local.md natively — i.e. Explore/Plan + SDK/background agents only.
  Agent-spawned subagents already get the pack via native CLAUDE.local.md loading, so this
  dependency is narrower than rev 1 assumed.

## The automatic-generation spine (robustness, not a pile of hand-written files)

1. **Extend `REGISTRY.md`** with structured per-repo fields: `conventions`, `checkin_procedure`,
   `gotchas`. ONE place to edit.
2. **Generator script** emits each repo's pack to `~/.claude/ada/packs/<repo>.md` + the one-line
   gitignored `CLAUDE.local.md` pointer in the repo root + procedure-card config (for the
   GitHubWriteGuard extension) — all from REGISTRY.
3. **Drift gate** (CI + weekly maintenance): regenerate packs into a temp dir and fail if any
   committed/generated pack differs from what REGISTRY would produce — same pattern as the existing
   count/PII single-source gates. **"Gates must actually fail" doctrine** ([[feedback_verify_gates_must_actually_fail]]):
   a gate that can't fail is worse than none, so ship it with a test that deliberately desyncs a
   pack and asserts the gate returns non-zero (proven to fail, not assumed).
4. **Self-feeding loop — HUMAN-CONFIRMED (rev 2):** the loop must NOT rely on Claude silently
   auto-detecting that a correction is REGISTRY-worthy and routing it correctly — that's an
   unproven reliability assumption (and the exact "confidently wrong" class we're trying to avoid).
   Instead, model it on memcarry's confirmed `capture-lesson` gate:
   - **Trigger:** the `End` skill (`SessionEnd` wrap-up) and an explicit `/ada-capture` path
     propose REGISTRY additions detected from session corrections. ("End/capture path" = the End
     skill's save step + a dedicated capture command — defined here, was undefined in rev 1.)
   - **Gate:** each proposed REGISTRY edit is shown to the user for confirm/edit/reject before it
     is written. No silent writes to the single source.
   - **Then:** confirmed edit → REGISTRY → regenerate pack → ambient next session.
   - **Phasing:** this loop is **phase 1b** — the read path (T1/T2/T3 + generation + drift gate)
     ships first and is validated before the write-back loop is wired, to limit blast radius.

## Parallelization plan (for build)

- **Group A (independent):** REGISTRY schema extension · generator script · telemetry counters
- **Group B (after A):** per-repo pack generation + `CLAUDE.local.md` pointers · GitHubWriteGuard
  extension (T2) · LocalContextFirst domain-match branch fix (T3)
- **Group C (after B):** drift gate + failing test · self-feeding capture path · delegation-prompt
  injection for subagents

## Deferred (phase 2 — NOT in the first cut)

- **T4 — Operational / environment state** (device locations, "why isn't the home router
  connected"): this is the user's *first* example but it is **operational STATE** (lives in
  `~/.config/yourcompany-mcp/devices.json` + live router-mcp health), not repo-domain knowledge — so
  ADA's T1-T3 do not cover it. Deferred to phase 2 per explicit decision (2026-06-19): "limit our
  initial impact and see how well it does." At scoping, decide whether it reuses ADA's
  REGISTRY/generator/push machinery or is a separate item. Tracked in the roadmap backlog.
- **Self-feeding write-back loop** is phase 1b (above) — read path proves out first.

## Risks / premortem

- **Stale packs are worse than none** — confidently-wrong ambient context is harder to catch than
  absence ([[feedback_empty_output_inconclusive]]). Mitigated by the drift gate (3) + telemetry.
- **Pack token budget (NEW, WARP):** packs are always-on context against the documented <200-line
  CLAUDE.md target. Conventions + gotchas + procedures across 7+ repos could each balloon. Mitigation:
  enforce a **per-pack line/token budget in the generator** (hard cap, e.g. ≤120 lines/pack), put
  only the high-frequency essentials in the pack, and push long-tail detail to T3 on-demand retrieval.
  The generator fails the build if a pack exceeds budget (same gate philosophy).
- **REGISTRY scalability (NEW, WARP):** single-source means REGISTRY grows with every repo,
  convention, and procedure — "editing REGISTRY becomes the bottleneck" is a real failure mode.
  Mitigation: if REGISTRY exceeds a maintainable size, split per-repo sections into
  `PAI/USER/PROJECTS/repos/<repo>.md` with REGISTRY as the index — but defer the split until size
  actually demands it (don't pre-optimize).
- **Auto-procedure must surface steps, never auto-execute destructive ones** — T2 injects/guides
  and can block; it never runs steps unprompted.
- **Hook hygiene (WARP known-issue #2):** the T2 extension must NOT reintroduce the `main()`-without-
  `.catch()` pattern flagged across ~20 existing hooks — a UserPromptSubmit/PreToolUse hook that
  throws uncaught can disrupt the turn. Wrap `main().catch(...)` and exit 0 on error.
- **Context-noise regression:** the UserPromptSubmit chain is already 13 hooks deep with 16
  additionalContext emitters. T3 adds per-turn injection. Mitigation: T3 stays gated (domain-match
  only) and shares the budget; telemetry watches total injected-context size.
- **Subagent reach** — Agent subagents get packs natively via CLAUDE.local.md; only Explore/Plan +
  SDK/background need the (narrower) 7.5.0 delegation injection.

## Relationship to existing roadmap items

- **7.4.0 §1 Observability** — ADA's measurement substrate (must land alongside).
- **7.4.0 §3 SF-3 (semantic MemoryRecall)** — complements T3 (semantic retrieval of memory vs wiki).
- **7.5.0 subagent context inheritance** — ADA's subagent-reach dependency.
- **7.7.0 Knowledge Cascade / Cross-repo coherence** — ADA is the *activation* layer; Cascade is
  the *sync* layer. They compose: Cascade keeps sources coherent, ADA pushes them on demand.
- **Single-source doctrine** — [[reference_sync_anchored_excludes]], PII single-source, count gates.
