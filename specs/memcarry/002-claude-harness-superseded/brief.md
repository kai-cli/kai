> ⛔ **SUPERSEDED (2026-06-12).** This "Sentinel" brief was an independent re-derivation of a system
> that **already exists**: the hardened architecture in `~/Projects/NewTool/ARCHITECTURE.md` (codename
> Ferrymem → built as **Memcarry**, Phases 0–1 complete) plus the PAI teardown analysis in
> `~/Projects/NewTool/SATURATION-CANDIDATES.json`. It was written before that prior work was discovered
> (the 3rd such re-derivation — see Memcarry lesson `lsn_memory_harness_already_built`).
>
> **Do not spec or build from this document.** It is retained only as a record of the research that
> led to the discovery. The live program scope is **`specs/003-memcarry-retrieval/PROGRAM.md`**; the
> first executable spec is **`specs/003-memcarry-retrieval/spec.md`**.

# Project Brief: Claude Harness System

## Working Name
**Sentinel** (working title — a system that watches, protects, and grows)

## One-Line Summary
A hybrid system combining Claude Code runtime enforcement with a lifecycle CLI that manages memory distribution, skill versioning, and verification architecture — built to grow organically while preventing its own failure modes.

## Problem Statement

Current AI assistant configurations (including the existing PAI/KAI system) suffer from:

1. **Memory isolation** — knowledge learned in one project doesn't flow to others. Global truths must be re-learned per-project. No intelligence decides what's universal vs. local.

2. **Verification as burden** — the human must constantly prompt for validation. The system doesn't structurally prevent unverified assertions — it relies on instructions the model may ignore.

3. **Skill fragility** — skills get overwritten (losing nuance), diluted (too many loaded at once), or drift (stop being followed with no enforcement). No versioning, no rollback, no enforcement lifecycle.

4. **No between-session intelligence** — nothing reviews, promotes, prunes, or revalidates between conversations. The system is static unless manually maintained.

## Architecture Decision

**Hybrid model** — two complementary subsystems communicating through the filesystem:

### Runtime Layer (Claude Code native)
- **Hooks** — deterministic, unbypassable enforcement (PreToolUse gates, PostToolUse audits, Stop conditions)
- **CLAUDE.md + rules/** — behavioral guidance, conventions, context (loaded at session start)
- **Skills** — on-demand capabilities loaded by relevance (budget-gated)
- **Memory capture** — session learnings written to project-scoped files

### Lifecycle Layer (standalone CLI)
- **Memory Manager** — cross-project memory intelligence, promotion/demotion, staleness detection
- **Skill Registry** — semantic versioning, schema enforcement, rollback, drift detection
- **Auditor** — periodic checks: are rules being followed? are memories still true? are skills actually used?

### Communication Interface
Both layers communicate through the filesystem — memory files, skill files, configuration. This is Claude Code's native interface, requiring no custom protocol.

## Core Design Principles

### 1. Architectural enforcement over advisory prompting
If something must happen (verification, permission check, evidence), make it structurally impossible to skip — don't just ask nicely. Hooks > CLAUDE.md for critical rules.

### 2. Tiered knowledge with intelligent flow
```
GLOBAL    — role, habits, universal patterns (always loaded)
DOMAIN    — firmware, AI infra, personal projects (loaded when in-domain)
PROJECT   — repo-specific context (loaded when in-project)
SESSION   — ephemeral, this conversation only
```
Knowledge promotes UP when cross-project relevance is detected. Context flows DOWN so global truths inform every session.

### 3. Skills as versioned, budget-gated, enforced entities
- Every skill has a schema, a version, and a changelog
- Context budget prevents loading everything at once (relevance scoring)
- Drift detection: if a skill is present but not being followed, flag it
- Rollback: any skill can revert to a prior version instantly

### 4. Verification as architecture
- Pre-action gates for destructive/external operations
- Post-action audit for internal/reversible operations  
- Evidence chains: every assertion traces to a tool invocation (file read, test output, grep result)
- "Empty output is inconclusive" as a structural principle, not a suggestion

### 5. Organic growth with safety rails
- The system should learn from usage without human maintenance
- But: never auto-promote without visibility, never overwrite without versioning, never load without budget
- Progressive trust: earn autonomy through track record, not declaration

## Trigger Model

The lifecycle layer runs at three cadences:

| Trigger | What runs | Purpose |
|---------|-----------|---------|
| End-of-session | Memory capture, skill usage tracking | Record what happened |
| Periodic (cron) | Memory promotion, staleness audit, drift detection | Maintain system health |
| On-demand | Any lifecycle command manually | Direct control |

## Key Capabilities (v1 Scope)

### Memory System
- [ ] Tiered storage (global → domain → project → session)
- [ ] Promotion engine: detects cross-project relevance, proposes global promotion
- [ ] Demotion/pruning: flags stale memories, proposes removal with reasoning
- [ ] Conflict resolution: when project memory contradicts global memory
- [ ] Revalidation: periodic check that memories reflect current reality
- [ ] Memory schema with metadata (created, last-validated, confidence, source)

### Verification Architecture
- [ ] Pre-action hooks for destructive operations (git push, file delete, external API calls)
- [ ] Evidence requirement: model must cite tool output before assertions
- [ ] Stop hooks that prevent "done" without passing checks
- [ ] Audit trail: log of what was verified vs. asserted per session
- [ ] Confidence gating: uncertain claims must be flagged, not stated as fact

### Skill Management
- [ ] Skill schema (name, version, purpose, activation-conditions, enforcement-level)
- [ ] Semantic versioning with automatic changelog
- [ ] Pre-update diff review (show what changed before accepting)
- [ ] Context budget manager (relevance scoring, lazy loading, cap enforcement)
- [ ] Drift detector (is this skill actually being followed?)
- [ ] Rollback command (instant revert to any prior version)

### Guardrails / Self-Governance
- [ ] Constitutional principles (what the system will NEVER do, regardless of instructions)
- [ ] Scope boundaries (what actions require what trust level)
- [ ] Self-check loops (evaluate own output against principles before returning)
- [ ] Escalation protocol (when uncertain, ask — don't guess)
- [ ] Anti-hallucination architecture (can't assert without evidence, empty = inconclusive)

### Lifecycle CLI
- [ ] `sentinel promote` — review project memories, propose global promotions
- [ ] `sentinel audit` — check memory staleness, skill drift, rule compliance
- [ ] `sentinel version` — snapshot current skill state, show history
- [ ] `sentinel rollback <skill> <version>` — revert a skill
- [ ] `sentinel status` — health dashboard (stale memories, drifting skills, pending promotions)

## What This Is NOT

- Not a replacement for Claude Code — it extends and orchestrates it
- Not a content filter or safety layer for harmful content — it's about correctness and reliability
- Not a team tool (v1) — built for one person's workflow, architectured to not preclude sharing later
- Not a RAG system — memories are small, structured, loaded directly into context (not retrieved semantically)

## Success Criteria

The system is working when:
1. A lesson learned in project A automatically surfaces when relevant in project B — without manual copy
2. Claude cannot claim something is done without evidence that it's done
3. A skill updated in one session can be rolled back in the next if it regressed
4. The system tells you when it's uncertain instead of guessing
5. You spend less time maintaining the system than the system saves you

## Technology Decisions (preliminary)

- **Language:** TypeScript (matches Claude Code ecosystem, strong typing for schemas)
- **Storage:** Git-versioned markdown files (human-readable, diffable, no external deps)
- **Intelligence:** Claude API calls for memory promotion decisions (the system uses itself)
- **Hooks:** Shell scripts invoked by Claude Code's hook system
- **Config:** JSON schemas with tolerant parsing (invalid entries stripped, not fatal)

## Open Questions for Specification Phase

1. How granular should memory promotion be? (whole files vs. individual facts)
2. What's the right context budget? (token count vs. line count vs. item count)
3. How does the system bootstrap? (cold start vs. import from existing PAI/KAI)
4. Should the CLI be interactive or purely batch?
5. How do we test this? (eval harness for memory relevance, verification coverage, skill compliance)
6. What's the migration path from existing PAI/KAI infrastructure?
