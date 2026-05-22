---
id: PAI-601
type: feature
status: shipped
priority: high
---

# Input Classification

## Problem

Users currently interact with Claude Code through a single text box, but must mentally route their input: is this a shell command I should prefix with `!`, or is this an AI query? The cognitive overhead of mode-switching fragments the experience.

## Requirements

- [ ] REQ-1: Shell commands classified with `p_shell > 0.85` accuracy threshold
- [ ] REQ-2: AI queries classified with `p_ai > 0.9` for clear natural-language input
- [ ] REQ-3: Skill invocations (/ prefix) detected with `p_skill = 1.0` deterministically
- [ ] REQ-4: `!command` prefix preserves existing Claude Code shell-exec behavior
- [ ] REQ-5: Ambiguous input defaults to AI classification (safe default)
- [ ] REQ-6: ModeClassifier NATIVE/ALGORITHM/MINIMAL routing preserved downstream
- [ ] REQ-7: PATH binary database cached to `/tmp/pai-hooks/path-cache.json`

## Design

Two-stage ModeClassifier:

1. **Input classification** (`hooks/lib/input-classifier.ts`): probabilistic scoring
   - Deterministic layer: `/` → skill, `!` → shell (bypasses heuristics)
   - Heuristic layer: PATH scan, metachar density, alpha-word ratio, question words
   - Threshold: `p_shell > 0.85` → shell hint injected; else → Stage 2

2. **Mode classification** (existing `hooks/lib/classify.ts`): MINIMAL/ALGORITHM/NATIVE

## Files Affected

- `hooks/lib/input-classifier.ts` — NEW
- `hooks/lib/command-database.ts` — NEW
- `hooks/ModeClassifier.hook.ts` — UPDATED (Stage 1 added)
- `tests/InputClassifier.test.ts` — NEW

## Acceptance Criteria

- `git status` → shell (p_shell > 0.9)
- `fix the authentication bug in auth.ts` → ai (p_ai > 0.9)
- `/research Warp terminal` → skill (p_skill = 1.0)
- Ambiguous words (e.g., `docker` alone) → ai (safe default)
- All 24 InputClassifier tests pass
