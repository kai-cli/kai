# SpecKit Workspace Constitution

> **Scope:** This constitution is SHARED across every spec in this workspace (firmware features,
> TypeScript tools, future work). It encodes **universal principles** — how YourName wants ANY spec
> designed and ANY build executed — not domain rules. Domain-specific constraints (device state,
> language, perf targets) live in each feature's own spec/plan, never here. Sourced from PAI AI
> Steering Rules + MemCarry's hardened-review discipline (ARCHITECTURE.md §11).

## Core Principles

### I. Verification Before Assertion (NON-NEGOTIABLE)

Never claim state without checking it with tools first. Never report a step "done" without evidence it
is done — the test output, the command run and what it returned, a diff, a screenshot. Specs express
acceptance as **observable, runnable checks**, not adjectives. "Works" / "robust" / "fast" are not
acceptance criteria; a command with an expected result is. Every spec MUST have at least one check the
implementer can run to prove each requirement.

### II. Inconclusive Is Not Confirmation (NON-NEGOTIABLE)

Empty, null, missing, or unexpected output is **inconclusive** — say so and try another method. Absence
of evidence is never evidence of the prior state. Carry uncertainty explicitly: where state can drift or
a probe can fail, model **three** outcomes (confirmed / changed / indeterminate), never collapse
"couldn't tell" into "unchanged" or "failed." Designs must not anchor on an unverified belief as if it
were a fact.

### III. First Principles, Surgical Change

Understand → simplify → reduce → add (last resort). Fix the specific problem with the smallest change
that solves it; never gut, rearchitect, or delete intentionally-built components as a "fix" without
explaining the reasoning and asking first. Prefer reusing/extending what exists over re-implementing it.
New complexity must be justified against a simpler rejected alternative (recorded in the plan's
Complexity Tracking).

### IV. Prove New Before Retiring Old (Reversibility)

A replacement runs **alongside** what it replaces until it earns its place in real use; nothing
established is migrated away or retired until the new path is proven. Caches and derived data are
rebuildable and disposable; the human-readable source remains the single source of truth. Before any
destructive or hard-to-reverse action (deletes, force-push, production deploy, data migration), ask
first and state the consequence.

### V. Provenance & Earned Authority

Distinguish what was human-confirmed or outcome-vindicated from what was merely asserted or
auto-derived. Only confirmed/vindicated information may gain authority (drive decisions, promote,
block). Lower-trust material may inform but must be labeled as such. Surface the basis of a claim
(where it came from, when it was last verified) so its trust can be judged.

### VI. No False Precision; Defer the Unjustified

Do not build tuning, scoring, automation, or generalization ahead of the data that would justify it.
When the evidence to make a choice well does not yet exist, **defer** with the design captured, rather
than shipping a confident-looking guess. Match the solution's sophistication to the actual scale and
signal available.

## Quality Gates

Applied at `/speckit-plan` (Constitution Check) and `/speckit-analyze`:

- **Evidence gate (I):** every functional requirement maps to a runnable check / measurable outcome.
- **Uncertainty gate (II):** any state that can drift has a defined check + a 3-state handling, not a
  silent assumption.
- **Simplicity gate (III):** added components/dependencies are justified vs a named simpler alternative;
  unjustified complexity blocks the plan.
- **Reversibility gate (IV):** anything that retires/overwrites existing behavior has a run-alongside or
  rollback path; destructive steps are flagged for explicit approval.
- **Deferral gate (VI):** features requiring data that does not yet exist are explicitly deferred, not
  speculatively built.

A plan with an unjustified gate violation is an ERROR — fix the design or record the justification.

## Development Workflow

- Specs are written for a **technical internal audience**; be precise about real vs assumed state.
- Clarify ambiguities (`/speckit-clarify`) before planning; record answers in the spec.
- Plans cite their source of truth and reuse existing, proven components by reference.
- Acceptance is validated by running the checks (the quickstart scenarios), not by assertion.
- This workspace is a **design studio**: specs are authored here, implementation lands in each
  target project's own repo — the plan must name the real target paths.

## Governance

This constitution supersedes ad-hoc practice for spec and plan authoring in this workspace. Amendments
are made by editing this file with a version bump and a dated note below; principles are expected to be
stable and few. All `/speckit-*` flows verify compliance via the Quality Gates. Domain-specific rules
never belong here — they belong in the feature's spec. When a gate and a domain need genuinely conflict,
the conflict is surfaced and resolved explicitly in the plan, not silently waived.

**Version**: 1.0.0 | **Ratified**: 2026-06-12 | **Last Amended**: 2026-06-12

<!-- Amendment log:
1.0.0 (2026-06-12) — Initial ratification. Universal principles distilled from PAI AI Steering Rules
  + MemCarry hardened-review discipline (ARCHITECTURE.md §11). Replaces the unfilled template.
-->
