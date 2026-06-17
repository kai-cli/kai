# MemCarry — Briefing (communication-ready)

> **What this is:** a plain-language explanation of the MemCarry architecture and why it improves on the
> PAI memory system. Ready to grab for explaining MemCarry to others (teammates, docs, a talk).
> **Written 2026-06-15.** This is itself an instance of the deferred `synthesis`/`briefing` atom type
> (NEXT-STEPS.md §3) — saved as a doc for now since that type isn't built yet.

## One-sentence version
**PAI memory is a pile of notes you have to remember to read; MemCarry is an assistant that hands you the
right note at the right moment — and checks it's still true before you trust it.**

## The core problem both systems face
You learn something in one project ("never hand-edit patch files — it broke the build"). Later, in a
different project, you hit the same situation. Did the system remind you? With PAI: usually no — the note
existed, but nothing surfaced it. You re-learned the lesson the hard way. The whole game is **getting
stored knowledge to show up when it's relevant.**

## How PAI memory works (and where it strains)
A big library of markdown notes — 255+ files across projects, loaded at session start (a guess at what's
relevant), compressed into ~7 domain summaries to fit. Three strains:
1. **All-or-nothing loading** — loads a guess up front; guess wrong → the note is invisible until you ask.
2. **Lossy compression** — 255 files squeezed to 7 summaries blurs specifics; you get the gist, not the fact.
3. **No freshness check** — a 3-month-old note is presented as confidently as today's, even if reality moved.

It's a *library*: everything's there, but finding the right book at the right second is on you.

## How MemCarry works (the improvements)

**1. Small structured "atoms" instead of big notes.** Each memory is one tiny unit with a fixed shape:
`WHEN editing a .patch file → DO regenerate via quilt → BECAUSE hand-editing broke build #62`. The WHEN
tells the system *when it applies*, so it can decide relevance instead of guessing.

**2. Surfaces memory every turn, automatically (retrieval, not loading).** Instead of one guess at session
start, MemCarry checks every message and injects relevant atoms then. **Hybrid matching:** keyword (exact
terms like `M62CF-EU`) + semantic (catches "fix a broken diff" → the patch lesson, no shared words), fused.
This is the fix for the #1 pain — "memory absent until I prompt for it."

**3. Verifies before you trust it (the novel part).** On resume it doesn't just *tell* you where you left
off — it *checks* via live git/gh probes and reports **verified / changed / can't-tell** (never collapses
"couldn't check" into false confidence). E.g. "resume said PR #72 awaiting merge — ✅ now MERGED; next step
updated." PAI had no equivalent; it'd confidently hand you stale state.

**4. Trust tiers — earned authority.** Every atom is tagged: human-confirmed > outcome-proven >
model-asserted > auto-captured. Only top tiers drive decisions or promote globally. PAI treated all notes
as equally authoritative, so a wrong inference carried the weight of a confirmed fact.

**5. Cross-project transfer by design.** A `global` atom is eligible in every project automatically — the
patch lesson learned in feed-bbf surfaces in Du-tracking with no copy-paste. PAI duplicated the same lesson
as separate files per project (we found the literal proof).

## Side-by-side

| | PAI memory | MemCarry |
|---|---|---|
| Shape | Big freeform notes | Tiny structured atoms (WHEN→DO→BECAUSE) |
| Surfacing | Loaded once at start (a guess) | Retrieved **every turn** by relevance |
| Matching | Keyword *or* compressed summary | Keyword **+** semantic, fused (RRF) |
| Freshness | None — stale = trusted | **Verified at load** (live git/gh, 3-state) |
| Trust | All notes equal | **Tiered** — only confirmed facts gain authority |
| Cross-project | Manual copy / blunt global file | **Automatic** global atoms |
| Cold start | Re-explain where you were | **Warm** — resume cursor + verified next step |
| Portability | Tied to PAI | **Model-agnostic** ("beside any AI") |

## Why it's actually better (not just different)
PAI tried to solve memory with **more storage and better compression**. MemCarry reframes it as a
**retrieval + trust** problem:
- More notes don't help if the right one doesn't surface → surface by relevance, every turn.
- A note doesn't help if you can't trust it's current → verify before presenting.
- A lesson doesn't help if it's trapped in one project → transfer globally by default.

The difference between *"I have all my notes somewhere"* and *"the right note, confirmed accurate, appears
exactly when I need it."* MemCarry keeps what PAI got right (plain markdown, git-tracked, human-readable)
and fixes the three things that made PAI memory feel unreliable: **surfaces, verifies, transfers** — with
trust tiers so confirmed facts outrank guesses.

## Implementation status (2026-06-15)
Live + committed in kai: B2 hybrid recall, A2 every-prompt MemRecall hook, B1 PRD-aware resume,
H2 compaction recovery. Runs alongside PAI memory (not a replacement yet). Value loop + schema expansion
(incl. the synthesis atom type) are deferred pending daily-use signal. Full detail: PROGRAM.md, NEXT-STEPS.md.
