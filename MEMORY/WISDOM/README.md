# MEMORY/WISDOM — Persistent Wisdom Store

Distilled, high-confidence behavioral principles that survive across sessions.
Distinct from `TELOS/WISDOM.md` (the user's manually-curated personal wisdom).
This tier is AI-maintained: principles are promoted here from `STAGING/` after
curation, and the highest-confidence entries are auto-injected at session start.

## Structure

| Path | Purpose |
|------|---------|
| `FRAMES/<domain>.md` | Domain-grouped principle files. Read by `loadWisdomFrames()` and injected into every session start. |

One file per domain (e.g. `FRAMES/algorithm.md`, `FRAMES/communication.md`).
File contents are concatenated principle blocks; there is no overall ordering
guarantee — each `### ... [CRYSTAL: N%]` block is read independently.

## File Format

Each principle is a level-3 heading with an inline confidence marker, followed
by explanatory body text:

```
### <principle name> [CRYSTAL: <N>%]
<one-paragraph explanation, ideally <300 chars>
```

The regex `loadWisdomFrames()` matches is:
`^### (.+?) \[CRYSTAL: (\d+)%\]`

## CRYSTAL% Semantics

| Range | Meaning | Behavior |
|-------|---------|----------|
| ≥ 85% | High-confidence principle | Auto-injected at session start by `loadWisdomFrames()` |
| 70–84% | Approved candidate, not yet trusted enough to inject | Lives in FRAMES file, ignored by readback. Promote by editing the % up. |
| < 70% | Should not be in WISDOM/ | Either keep in STAGING or reject |

CRYSTAL% is set at promotion time. Conventions used so far:
- 90% — Independently corroborated by ≥2 harvest cycles, broad applicability
- 85% — Single corroboration, clear actionability
- 80% — Specific or narrow applicability
- 75% — Single-incident origin; awaiting recurrence

## Promotion Path

```
ReflectionHarvester (auto)
        ↓
    STAGING/*.md  (drafts, 14d expiry, confidence 0.8)
        ↓
    pai curate  →  manual review  →  edit into FRAMES/<domain>.md
        ↓
    WISDOM/FRAMES/<domain>.md  (CRYSTAL% set by curator)
        ↓
    loadWisdomFrames()  →  injected at session start (if ≥85%)
```

Approvals are logged to `STATE/curation-log.jsonl`.
Approved drafts move to `STAGING/.archive/` for audit; rejected drafts move to
`STAGING/.rejections.jsonl` so the synthesizer can avoid resurfacing them.

## Relationship to Other Memory Tiers

- `LEARNING/REFLECTIONS/` — Raw algorithm reflections (jsonl, append-only)
- `LEARNING/SIGNALS/ratings.jsonl` — Session ratings, source for synthesis
- `STAGING/` — Draft principles awaiting curation (14d expiry)
- `WISDOM/FRAMES/` — Curated, durable principles (this tier)
- `KNOWLEDGE/` — Cross-project domain knowledge (separate pipeline)
- `TELOS/WISDOM.md` — User's manually-curated personal wisdom
